// Advanced GPS Hardening Engine for SBS Travels Meter
// Pipeline: RAW GPS -> Accuracy Filter -> Timestamp Validation -> Jump Rejection -> Kalman Smoothing -> Motion Detection -> Validated Fix

export interface RawGpsPoint {
  latitude: number;
  longitude: number;
  accuracy: number;
  speed: number | null; // meters per second
  heading?: number | null;
  timestamp: number; // epoch ms
}

export type GpsSignalState = 'GOOD' | 'FAIR' | 'SEARCHING' | 'GPS_LOST';

export interface ValidatedGpsFix {
  latitude: number;
  longitude: number;
  accuracy: number;
  speedKmh: number;
  signalState: GpsSignalState;
  isStationary: boolean;
  distanceDeltaKm: number; // Validated distance to add to meter
  timestamp: number;
}

// 1D Kalman Filter for Lat / Lng coordinate smoothing
class CoordinateKalmanFilter {
  private variance: number = -1; // P: estimate error covariance
  private estimate: number = 0; // x: current estimate
  private readonly processNoise: number; // Q: process noise variance

  constructor(processNoise: number = 0.000003) {
    this.processNoise = processNoise;
  }

  public filter(measurement: number, accuracyMeters: number): number {
    // Convert accuracy to variance in degrees (~111,000m per degree)
    const measurementVariance = Math.pow(Math.max(accuracyMeters, 2) / 111000, 2);

    if (this.variance < 0) {
      // First measurement
      this.estimate = measurement;
      this.variance = measurementVariance;
      return measurement;
    }

    // Prediction update
    this.variance += this.processNoise;

    // Kalman gain K = P / (P + R)
    const kalmanGain = this.variance / (this.variance + measurementVariance);

    // Measurement update
    this.estimate = this.estimate + kalmanGain * (measurement - this.estimate);
    this.variance = (1 - kalmanGain) * this.variance;

    return this.estimate;
  }

  public reset(val: number) {
    this.estimate = val;
    this.variance = -1;
  }
}

// Haversine Distance helper (in kilometers)
export const calculateHaversineKm = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const R = 6371; // Earth radius km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

export class GpsHardeningEngine {
  private lastValidatedPoint: { lat: number; lng: number; time: number } | null = null;
  private consecutiveJumpCount: number = 0;
  private consecutiveStationaryCount: number = 0;
  private lastFixReceivedTime: number = 0;
  private latKalman = new CoordinateKalmanFilter();
  private lngKalman = new CoordinateKalmanFilter();

  /**
   * Ingests a raw GPS fix and applies the hardening pipeline.
   * Returns a ValidatedGpsFix or null if the point is invalid/discarded.
   */
  public processRawGps(raw: RawGpsPoint): ValidatedGpsFix {
    const now = Date.now();
    this.lastFixReceivedTime = now;

    // 1. Signal Accuracy Evaluation
    let signalState: GpsSignalState = 'SEARCHING';
    if (raw.accuracy <= 30) {
      signalState = 'GOOD';
    } else if (raw.accuracy <= 75) {
      signalState = 'FAIR';
    } else {
      signalState = 'SEARCHING';
    }

    // 2. Timestamp Validation (reject stale or out-of-order readings)
    if (this.lastValidatedPoint && raw.timestamp < this.lastValidatedPoint.time - 500) {
      return {
        latitude: this.lastValidatedPoint.lat,
        longitude: this.lastValidatedPoint.lng,
        accuracy: raw.accuracy,
        speedKmh: 0,
        signalState: 'SEARCHING',
        isStationary: true,
        distanceDeltaKm: 0,
        timestamp: now,
      };
    }

    // Convert raw speed to km/h
    const rawSpeedKmh = raw.speed != null && raw.speed >= 0 ? raw.speed * 3.6 : 0;

    // 3. Initial Baseline Fix
    if (!this.lastValidatedPoint) {
      this.latKalman.reset(raw.latitude);
      this.lngKalman.reset(raw.longitude);
      this.lastValidatedPoint = { lat: raw.latitude, lng: raw.longitude, time: raw.timestamp };
      return {
        latitude: raw.latitude,
        longitude: raw.longitude,
        accuracy: raw.accuracy,
        speedKmh: Math.round(rawSpeedKmh),
        signalState,
        isStationary: rawSpeedKmh < 3,
        distanceDeltaKm: 0,
        timestamp: raw.timestamp,
      };
    }

    // 4. Accuracy-Aware Gate: Discard erratic readings with accuracy > 85m
    if (raw.accuracy > 85) {
      return {
        latitude: this.lastValidatedPoint.lat,
        longitude: this.lastValidatedPoint.lng,
        accuracy: raw.accuracy,
        speedKmh: 0,
        signalState: 'SEARCHING',
        isStationary: true,
        distanceDeltaKm: 0,
        timestamp: raw.timestamp,
      };
    }

    // Calculate delta and implied speed
    const timeDeltaHours = Math.max((raw.timestamp - this.lastValidatedPoint.time) / 3600000, 0.0001);
    const rawDistanceDeltaKm = calculateHaversineKm(
      this.lastValidatedPoint.lat,
      this.lastValidatedPoint.lng,
      raw.latitude,
      raw.longitude
    );
    const impliedSpeedKmh = rawDistanceDeltaKm / timeDeltaHours;

    // 5. Impossible-Speed & GPS Jump Rejection
    // Reject speed > 140 km/h or sudden teleport jumps > 500m in < 3s
    if (impliedSpeedKmh > 140 || (rawDistanceDeltaKm > 0.5 && timeDeltaHours < 0.001)) {
      this.consecutiveJumpCount += 1;

      // GPS Recovery: If 4 consecutive readings are consistently at the new location, accept recovery
      if (this.consecutiveJumpCount >= 4) {
        this.consecutiveJumpCount = 0;
        this.latKalman.reset(raw.latitude);
        this.lngKalman.reset(raw.longitude);
        this.lastValidatedPoint = { lat: raw.latitude, lng: raw.longitude, time: raw.timestamp };
        return {
          latitude: raw.latitude,
          longitude: raw.longitude,
          accuracy: raw.accuracy,
          speedKmh: Math.round(rawSpeedKmh),
          signalState,
          isStationary: rawSpeedKmh < 3,
          distanceDeltaKm: 0, // Do NOT charge passenger for the teleport recovery jump!
          timestamp: raw.timestamp,
        };
      }

      // Reject jump reading
      return {
        latitude: this.lastValidatedPoint.lat,
        longitude: this.lastValidatedPoint.lng,
        accuracy: raw.accuracy,
        speedKmh: Math.min(Math.round(rawSpeedKmh), 40),
        signalState: 'FAIR',
        isStationary: true,
        distanceDeltaKm: 0,
        timestamp: raw.timestamp,
      };
    }

    // Valid reading: reset jump counter
    this.consecutiveJumpCount = 0;

    // 6. Stationary & Drift Suppression
    // If vehicle speed is < 3 km/h and distance delta is < 6 meters, confirm stationary
    const isStationaryCandidate = (rawSpeedKmh < 3 && rawDistanceDeltaKm < 0.008) || rawDistanceDeltaKm < 0.004;

    if (isStationaryCandidate) {
      this.consecutiveStationaryCount += 1;
      const isConfirmedStationary = this.consecutiveStationaryCount >= 2;

      return {
        latitude: this.lastValidatedPoint.lat,
        longitude: this.lastValidatedPoint.lng,
        accuracy: raw.accuracy,
        speedKmh: 0,
        signalState,
        isStationary: isConfirmedStationary,
        distanceDeltaKm: 0, // Suppress GPS jitter drift from adding false distance
        timestamp: raw.timestamp,
      };
    }

    // 7. Motion Confirmed: Apply Kalman Smoothing
    this.consecutiveStationaryCount = 0;
    const smoothedLat = this.latKalman.filter(raw.latitude, raw.accuracy);
    const smoothedLng = this.lngKalman.filter(raw.longitude, raw.accuracy);

    const validatedDistanceKm = calculateHaversineKm(
      this.lastValidatedPoint.lat,
      this.lastValidatedPoint.lng,
      smoothedLat,
      smoothedLng
    );

    // Update baseline
    this.lastValidatedPoint = { lat: smoothedLat, lng: smoothedLng, time: raw.timestamp };

    const effectiveSpeedKmh = Math.max(Math.round(rawSpeedKmh), Math.round(validatedDistanceKm / timeDeltaHours));

    return {
      latitude: smoothedLat,
      longitude: smoothedLng,
      accuracy: raw.accuracy,
      speedKmh: Math.min(effectiveSpeedKmh, 140),
      signalState,
      isStationary: false,
      distanceDeltaKm: validatedDistanceKm,
      timestamp: raw.timestamp,
    };
  }

  /**
   * Checks if GPS signal has been lost (no fix in 7 seconds)
   */
  public checkSignalLiveness(): GpsSignalState {
    if (this.lastFixReceivedTime === 0) return 'SEARCHING';
    const elapsed = Date.now() - this.lastFixReceivedTime;
    if (elapsed > 7000) {
      return 'GPS_LOST';
    }
    return 'GOOD';
  }

  public reset() {
    this.lastValidatedPoint = null;
    this.consecutiveJumpCount = 0;
    this.consecutiveStationaryCount = 0;
    this.lastFixReceivedTime = 0;
  }
}
