// Advanced GPS Hardening Engine for SBS Travels Meter
// Pipeline: RAW GPS -> Location Validation -> Mock Detection -> Impossible Jump Protection -> Kalman Smoothing -> Movement Hysteresis / Waiting Detector -> Validated Fix

export interface RawGpsPoint {
  latitude: number;
  longitude: number;
  accuracy: number;
  speed: number | null; // meters per second from device
  heading?: number | null;
  timestamp: number; // epoch ms
  isMock?: boolean; // Mock location indicator from Android
}

export type GpsSignalState = 'GOOD' | 'FAIR' | 'SEARCHING' | 'GPS_LOST' | 'GPS_GOOD' | 'GPS_DEGRADED' | 'GPS_RECOVERING';
export type GpsHealthState = 'GPS_GOOD' | 'GPS_DEGRADED' | 'GPS_LOST' | 'GPS_RECOVERING';

export interface ValidatedGpsFix {
  latitude: number;
  longitude: number;
  accuracy: number;
  speedKmh: number; // Effective/filtered speed (for backward compatibility)
  deviceSpeedKmh: number; // Speed reported by device GPS hardware
  calculatedSegmentSpeedKmh: number; // Speed derived from raw distance / time delta
  filteredSpeedKmh: number; // Speed derived from smoothed distance / time delta
  signalState: GpsSignalState; // Signal quality badge for UI
  healthState: GpsHealthState; // Detailed health state
  isStationary: boolean;
  isWaitingConfirmed: boolean;
  distanceDeltaKm: number; // Validated distance to add to meter
  timestamp: number;
  rejectionReason: string | null;
  isValid: boolean;
}

// Adaptive 1D Kalman Filter for Lat / Lng coordinate smoothing
class CoordinateKalmanFilter {
  private variance: number = -1; // P: estimate error covariance
  private estimate: number = 0; // x: current estimate
  private readonly processNoise: number; // Q: process noise variance

  constructor(processNoise: number = 0.000003) {
    this.processNoise = processNoise;
  }

  public filter(measurement: number, accuracyMeters: number): number {
    // Convert accuracy to variance in degrees (~111,000m per degree)
    const measurementVariance = Math.pow(Math.max(accuracyMeters, 1) / 111000, 2);

    if (this.variance < 0) {
      // First measurement initialization
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
  if (lat1 === lat2 && lon1 === lon2) return 0;
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

// Movement & Stationary Detector (Hysteresis state machine)
type MotionDetectorState = 'MOVING' | 'POTENTIAL_STATIONARY' | 'WAITING' | 'POTENTIAL_MOVING';

export class GpsHardeningEngine {
  private lastValidatedPoint: { lat: number; lng: number; time: number } | null = null;
  private consecutiveJumpCount: number = 0;
  private consecutiveStationaryCount: number = 0;
  private consecutiveMotionCount: number = 0;
  private motionState: MotionDetectorState = 'POTENTIAL_STATIONARY';
  private lastFixReceivedTime: number = 0;
  private isRecoveringFromJump: boolean = false;
  private latKalman = new CoordinateKalmanFilter();
  private lngKalman = new CoordinateKalmanFilter();

  // Configurable thresholds
  public readonly MAX_ACCEPTABLE_ACCURACY_METERS = 85;
  public readonly IMPOSSIBLE_SPEED_KMH = 150;
  public readonly JUMP_DISTANCE_KM = 0.4;
  public readonly JUMP_TIME_SECONDS = 3;
  public readonly REQUIRED_JUMP_RECOVERY_SAMPLES = 3;
  public readonly REQUIRED_STATIONARY_SAMPLES = 2;

  /**
   * Ingests a raw GPS fix and applies the complete validation & hardening pipeline.
   * Always returns a ValidatedGpsFix with explicit validity flag and rejection reason if any.
   */
  public processRawGps(raw: RawGpsPoint): ValidatedGpsFix {
    const fixTime = raw.timestamp || Date.now();
    this.lastFixReceivedTime = fixTime;

    const deviceSpeedKmh = raw.speed != null && raw.speed >= 0 ? Math.round(raw.speed * 3.6) : 0;

    // -------------------------------------------------------------
    // STEP 1: Strict Location & Coordinate Range Validation
    // -------------------------------------------------------------
    if (
      typeof raw.latitude !== 'number' ||
      typeof raw.longitude !== 'number' ||
      typeof raw.accuracy !== 'number' ||
      isNaN(raw.latitude) ||
      isNaN(raw.longitude) ||
      isNaN(raw.accuracy)
    ) {
      return this.buildRejectedFix(raw, deviceSpeedKmh, 'INVALID_COORDINATES');
    }

    // Null Island check (0,0) and coordinate boundary check
    if (
      (raw.latitude === 0 && raw.longitude === 0) ||
      raw.latitude < -90 ||
      raw.latitude > 90 ||
      raw.longitude < -180 ||
      raw.longitude > 180
    ) {
      return this.buildRejectedFix(raw, deviceSpeedKmh, 'INVALID_COORDINATES');
    }

    // -------------------------------------------------------------
    // STEP 2: Suspicious & Mock Location Check
    // -------------------------------------------------------------
    if (raw.isMock === true || (raw as any).mockLocation === true || (raw as any).isMocked === true) {
      return this.buildRejectedFix(raw, deviceSpeedKmh, 'MOCK_LOCATION');
    }

    // -------------------------------------------------------------
    // STEP 3: Accuracy Gate
    // -------------------------------------------------------------
    if (raw.accuracy <= 0 || raw.accuracy > this.MAX_ACCEPTABLE_ACCURACY_METERS) {
      return this.buildRejectedFix(raw, deviceSpeedKmh, 'POOR_ACCURACY');
    }

    // Determine Health & Signal Quality
    let signalState: GpsSignalState = 'GOOD';
    let healthState: GpsHealthState = 'GPS_GOOD';
    if (raw.accuracy <= 30) {
      signalState = 'GOOD';
      healthState = 'GPS_GOOD';
    } else if (raw.accuracy <= this.MAX_ACCEPTABLE_ACCURACY_METERS) {
      signalState = 'FAIR';
      healthState = 'GPS_DEGRADED';
    }

    // -------------------------------------------------------------
    // STEP 4: Timestamp Validation & Out-Of-Order / Duplicate Protection
    // -------------------------------------------------------------
    if (this.lastValidatedPoint) {
      if (raw.timestamp <= this.lastValidatedPoint.time) {
        return this.buildRejectedFix(raw, deviceSpeedKmh, 'STALE_TIMESTAMP');
      }
    }

    // -------------------------------------------------------------
    // STEP 5: Baseline Fix Initialization (First valid point)
    // -------------------------------------------------------------
    if (!this.lastValidatedPoint) {
      this.latKalman.reset(raw.latitude);
      this.lngKalman.reset(raw.longitude);
      this.lastValidatedPoint = { lat: raw.latitude, lng: raw.longitude, time: raw.timestamp };
      this.motionState = deviceSpeedKmh >= 3 ? 'MOVING' : 'WAITING';

      return {
        latitude: raw.latitude,
        longitude: raw.longitude,
        accuracy: raw.accuracy,
        speedKmh: deviceSpeedKmh,
        deviceSpeedKmh,
        calculatedSegmentSpeedKmh: 0,
        filteredSpeedKmh: deviceSpeedKmh,
        signalState,
        healthState,
        isStationary: deviceSpeedKmh < 3,
        isWaitingConfirmed: deviceSpeedKmh < 3,
        distanceDeltaKm: 0,
        timestamp: raw.timestamp,
        rejectionReason: null,
        isValid: true,
      };
    }

    // Calculate time delta in hours
    const timeDeltaMs = raw.timestamp - this.lastValidatedPoint.time;
    const timeDeltaHours = Math.max(timeDeltaMs / 3600000, 0.0001); // min 0.36 sec
    const rawDistanceDeltaKm = calculateHaversineKm(
      this.lastValidatedPoint.lat,
      this.lastValidatedPoint.lng,
      raw.latitude,
      raw.longitude
    );
    const calculatedSegmentSpeedKmh = Math.round(rawDistanceDeltaKm / timeDeltaHours);

    // -------------------------------------------------------------
    // STEP 6: Impossible Speed & Teleport Jump Protection
    // -------------------------------------------------------------
    const isSpeedImpossible = calculatedSegmentSpeedKmh > this.IMPOSSIBLE_SPEED_KMH;
    const isTeleportJump = rawDistanceDeltaKm > this.JUMP_DISTANCE_KM && timeDeltaMs < this.JUMP_TIME_SECONDS * 1000;

    if (isSpeedImpossible || isTeleportJump) {
      this.consecutiveJumpCount += 1;
      this.isRecoveringFromJump = true;

      // Safe Jump Recovery: If N consecutive readings remain consistent at the new position,
      // recover position baseline without charging the jump distance gap!
      if (this.consecutiveJumpCount >= this.REQUIRED_JUMP_RECOVERY_SAMPLES) {
        this.consecutiveJumpCount = 0;
        this.isRecoveringFromJump = false;
        this.latKalman.reset(raw.latitude);
        this.lngKalman.reset(raw.longitude);
        this.lastValidatedPoint = { lat: raw.latitude, lng: raw.longitude, time: raw.timestamp };

        return {
          latitude: raw.latitude,
          longitude: raw.longitude,
          accuracy: raw.accuracy,
          speedKmh: deviceSpeedKmh,
          deviceSpeedKmh,
          calculatedSegmentSpeedKmh: 0,
          filteredSpeedKmh: deviceSpeedKmh,
          signalState: 'GOOD',
          healthState: 'GPS_RECOVERING',
          isStationary: deviceSpeedKmh < 3,
          isWaitingConfirmed: deviceSpeedKmh < 3,
          distanceDeltaKm: 0, // CRITICAL: 0 distance added during teleport recovery!
          timestamp: raw.timestamp,
          rejectionReason: null,
          isValid: true,
        };
      }

      // Reject the impossible jump
      return this.buildRejectedFix(raw, deviceSpeedKmh, 'IMPOSSIBLE_JUMP', calculatedSegmentSpeedKmh);
    }

    // Reset jump counter on valid reading
    this.consecutiveJumpCount = 0;
    this.isRecoveringFromJump = false;

    // -------------------------------------------------------------
    // STEP 7: Stationary & Movement Hysteresis (WaitingDetector)
    // -------------------------------------------------------------
    // A point is candidate stationary if device speed is low and distance delta is small (< 4m or < 2.5km/h)
    const isStationaryCandidate =
      (deviceSpeedKmh < 2.5 && rawDistanceDeltaKm < 0.006) || (rawDistanceDeltaKm < 0.003 && deviceSpeedKmh < 3);

    if (isStationaryCandidate) {
      this.consecutiveStationaryCount += 1;
      this.consecutiveMotionCount = 0;

      if (this.consecutiveStationaryCount >= this.REQUIRED_STATIONARY_SAMPLES) {
        this.motionState = 'WAITING';
      } else {
        this.motionState = 'POTENTIAL_STATIONARY';
      }
    } else {
      this.consecutiveMotionCount += 1;
      this.consecutiveStationaryCount = 0;
      this.motionState = 'MOVING';
    }

    // If confirmed stationary, suppress micro-jitter distance
    if (this.motionState === 'WAITING' || (this.motionState === 'POTENTIAL_STATIONARY' && rawDistanceDeltaKm < 0.004)) {
      return {
        latitude: this.lastValidatedPoint.lat,
        longitude: this.lastValidatedPoint.lng,
        accuracy: raw.accuracy,
        speedKmh: 0,
        deviceSpeedKmh,
        calculatedSegmentSpeedKmh,
        filteredSpeedKmh: 0,
        signalState,
        healthState: this.isRecoveringFromJump ? 'GPS_RECOVERING' : healthState,
        isStationary: true,
        isWaitingConfirmed: this.motionState === 'WAITING',
        distanceDeltaKm: 0, // Suppress GPS noise/drift from adding false distance
        timestamp: raw.timestamp,
        rejectionReason: null,
        isValid: true,
      };
    }

    // -------------------------------------------------------------
    // STEP 8: Kalman Filter Coordinate Smoothing & Distance Accumulation
    // -------------------------------------------------------------
    const smoothedLat = this.latKalman.filter(raw.latitude, raw.accuracy);
    const smoothedLng = this.lngKalman.filter(raw.longitude, raw.accuracy);

    const validatedDistanceKm = calculateHaversineKm(
      this.lastValidatedPoint.lat,
      this.lastValidatedPoint.lng,
      smoothedLat,
      smoothedLng
    );

    const filteredSpeedKmh = Math.round(validatedDistanceKm / timeDeltaHours);

    // Update baseline to smoothed coordinate
    this.lastValidatedPoint = { lat: smoothedLat, lng: smoothedLng, time: raw.timestamp };

    const effectiveSpeedKmh = Math.min(
      Math.max(deviceSpeedKmh, filteredSpeedKmh),
      this.IMPOSSIBLE_SPEED_KMH
    );

    return {
      latitude: smoothedLat,
      longitude: smoothedLng,
      accuracy: raw.accuracy,
      speedKmh: effectiveSpeedKmh,
      deviceSpeedKmh,
      calculatedSegmentSpeedKmh,
      filteredSpeedKmh,
      signalState,
      healthState,
      isStationary: false,
      isWaitingConfirmed: false,
      distanceDeltaKm: validatedDistanceKm,
      timestamp: raw.timestamp,
      rejectionReason: null,
      isValid: true,
    };
  }

  /**
   * Helper to construct a rejected fix response that preserves last validated position.
   */
  private buildRejectedFix(
    raw: RawGpsPoint,
    deviceSpeedKmh: number,
    reason: string,
    calculatedSegmentSpeedKmh: number = 0
  ): ValidatedGpsFix {
    const lat = this.lastValidatedPoint ? this.lastValidatedPoint.lat : raw.latitude || 0;
    const lng = this.lastValidatedPoint ? this.lastValidatedPoint.lng : raw.longitude || 0;

    return {
      latitude: lat,
      longitude: lng,
      accuracy: raw.accuracy || 999,
      speedKmh: 0,
      deviceSpeedKmh,
      calculatedSegmentSpeedKmh,
      filteredSpeedKmh: 0,
      signalState: 'SEARCHING',
      healthState: 'GPS_DEGRADED',
      isStationary: true,
      isWaitingConfirmed: this.motionState === 'WAITING',
      distanceDeltaKm: 0, // MUST NOT add distance for rejected points
      timestamp: raw.timestamp || Date.now(),
      rejectionReason: reason,
      isValid: false,
    };
  }

  /**
   * Checks if GPS signal has been lost (no fix in 7 seconds).
   */
  public checkSignalLiveness(currentTimestamp: number = Date.now()): GpsSignalState {
    if (this.lastFixReceivedTime === 0) return 'SEARCHING';
    const elapsed = currentTimestamp - this.lastFixReceivedTime;
    if (elapsed > 7000) {
      return 'GPS_LOST';
    }
    return this.isRecoveringFromJump ? 'GPS_RECOVERING' : 'GOOD';
  }

  /**
   * Gets current detailed health state.
   */
  public getHealthState(currentTimestamp: number = Date.now()): GpsHealthState {
    if (this.lastFixReceivedTime === 0) return 'GPS_LOST';
    const elapsed = currentTimestamp - this.lastFixReceivedTime;
    if (elapsed > 7000) return 'GPS_LOST';
    if (this.isRecoveringFromJump) return 'GPS_RECOVERING';
    return 'GPS_GOOD';
  }

  public reset() {
    this.lastValidatedPoint = null;
    this.consecutiveJumpCount = 0;
    this.consecutiveStationaryCount = 0;
    this.consecutiveMotionCount = 0;
    this.motionState = 'POTENTIAL_STATIONARY';
    this.lastFixReceivedTime = 0;
    this.isRecoveringFromJump = false;
  }
}
