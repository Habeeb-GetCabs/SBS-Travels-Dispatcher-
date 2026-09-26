// Core Domain Types for SBS Travels (Powered by Get Taxi Basheer)

export type DriverOperationalStatus = 
  | 'OFFLINE' 
  | 'READY' 
  | 'HAS_TRIP' 
  | 'TRIP_CLAIMED' 
  | 'ARRIVED' 
  | 'ON_TRIP' 
  | 'COMPLETING' 
  | 'AVAILABLE' 
  | 'SUSPENDED';

export type DeviceActivationStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
export type TripStatus = 'OPEN' | 'CLAIMED' | 'ARRIVED' | 'STARTED' | 'COMPLETED' | 'CANCELLED';
export type TripType = 'LOCAL' | 'OUTSTATION' | 'ONE_WAY' | 'ROUND_TRIP' | 'HOURLY' | 'AIRPORT';

export type PassengerVerificationStatus = 'NOT_REQUIRED' | 'PENDING' | 'VERIFIED' | 'FAILED_BLOCKED';

export type AdminRole = 'MASTER_ADMIN' | 'ADMIN' | 'DISPATCHER';

export interface AdminUserProfile {
  id: string; // matches auth.users.id
  email: string;
  fullName: string;
  role: AdminRole;
  createdAt?: string;
}

export interface DriverProfile {
  id: string; // Authoritative UUID in public.drivers table
  authUserId?: string; // Supabase auth.users.id (auth.uid())
  driverCode: string;
  name: string;
  mobile: string;
  vehicleNumber: string;
  vehicleModel: string;
  operationalStatus: DriverOperationalStatus;
  activationStatus: DeviceActivationStatus;
  deviceId: string;
  currentLatitude?: number;
  currentLongitude?: number;
  lastLocationAt?: string;
  currentLocality?: string;
  photoUrl?: string;
  homeLocation?: string;
  activationCode?: string;
  isActivationCodeVerified?: boolean;
}

// Per-Trip Server-Authoritative Tariff Configuration
export interface TariffConfig {
  pricingType: 'PER_KM' | 'FLAT' | 'PACKAGE' | 'CUSTOM' | string;
  baseFare: number;
  includedKm: number;
  minimumKm: number;
  ratePerKm: number;
  waitingRatePerMinute: number;
  waitingGraceMinutes: number;
  driverBata: number;
  toll: number;
  parking: number;
  interstateTax: number;
  additionalCharges: number;
  commissionCharge?: number;
  discount: number;
  roundingRule: 'ROUND_NEAREST' | 'CEIL' | 'FLOOR' | 'NONE';
  quotedAmount: number;
}

export interface Trip {
  id: string;
  tripNumber: string;
  customerName: string;
  customerMobile: string;
  pickupAddress: string;
  dropAddress: string;
  pickupLatitude?: number;
  pickupLongitude?: number;
  pickupPlaceId?: string;
  dropLatitude?: number;
  dropLongitude?: number;
  dropPlaceId?: string;
  tripType: TripType | string;
  estimatedFare: number;
  estimatedDistanceKm?: number;
  estimatedDurationMinutes?: number;
  notes?: string;
  status: TripStatus;
  tripAccessOtp: string;
  isOtpConsumed: boolean;
  claimedByDriverId?: string;
  claimedAt?: string;
  arrivedAt?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  createdBy?: string;
  tariffConfig: TariffConfig;
  // Passenger / Customer Verification OTP (Credential 4)
  passengerOtpRequired?: boolean;
  passengerVerificationOtp?: string;
  passengerVerifiedAt?: string;
  passengerVerificationAttempts?: number;
  passengerVerificationStatus?: PassengerVerificationStatus;
}

export interface CompletedTripData {
  id: string;
  tripId: string;
  tripNumber: string;
  driverId: string;
  deviceId: string;
  customerName: string;
  customerMobile: string;
  pickupAddress: string;
  dropAddress: string;
  distanceKm: number;
  durationSeconds: number;
  waitingSeconds: number;
  baseFare: number;
  distanceFare: number;
  waitingFare: number;
  driverBata: number;
  toll: number;
  parking: number;
  interstateTax: number;
  additionalCharges: number;
  discount: number;
  totalFare: number;
  completedAt: string;
  isSynced: boolean;
  tariffConfig?: TariffConfig;
  passengerVerifiedAt?: string;
  passengerVerificationStatus?: PassengerVerificationStatus;
}

// Active Meter Local Snapshot for Crash / Background Recovery
export interface ActiveMeterSnapshot {
  tripId: string;
  tripNumber: string;
  status: TripStatus;
  startTime: number;
  distanceKm: number;
  durationSeconds: number;
  waitingSeconds: number;
  currentFare: number;
  extraTolls: number;
  extraParking: number;
  lastKnownLocation?: {
    latitude: number;
    longitude: number;
  };
  lastLocationTimestamp: number;
  tariffConfig: TariffConfig;
}

export type DateFilterRange = 'TODAY' | 'YESTERDAY' | 'THIS_WEEK' | 'THIS_MONTH' | 'ALL' | 'CUSTOM';

export interface DriverPerformanceSummary {
  driverId: string;
  driverName: string;
  vehicleNumber: string;
  tripCount: number;
  totalFare: number;
  totalDistanceKm: number;
}

export interface VehiclePerformanceSummary {
  vehicleNumber: string;
  tripCount: number;
  totalFare: number;
  totalDistanceKm: number;
}

export interface DispatcherReportMetrics {
  totalTrips: number;
  totalDistanceKm: number;
  totalFare: number;
  totalWaitingMinutes: number;
  estimatedFareTotal: number;
  actualFareTotal: number;
  fareVariance: number;
  estimatedDistanceTotal: number;
  actualDistanceTotal: number;
  distanceVariance: number;
  driverTotals: DriverPerformanceSummary[];
  vehicleTotals: VehiclePerformanceSummary[];
}
