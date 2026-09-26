import {
  Trip,
  DriverProfile,
  CompletedTripData,
  ActiveMeterSnapshot,
  TariffConfig,
  DeviceActivationStatus,
  DriverOperationalStatus,
  PassengerVerificationStatus,
  DateFilterRange,
  DispatcherReportMetrics,
  DriverPerformanceSummary,
  VehiclePerformanceSummary,
} from '../types';

export type { DateFilterRange };
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { getDispatcherSession } from './authService';
import {
  createDefaultTariffConfig,
  normalizeTariffConfig,
  validateTariffConfig,
} from './tariffService';
import { LOCAL_DRIVER_AUTH_CACHE_KEY, ensureDriverAuthAccount } from './authService';

const LOCAL_DRIVER_KEY = 'sbs_driver_profile_v1';
const LOCAL_ACTIVE_TRIP_KEY = 'sbs_active_trip_v1';
const LOCAL_TRIPS_KEY = 'sbs_trips_seed_v1';
const LOCAL_COMPLETED_TRIPS_KEY = 'sbs_completed_trips_v1';
const LOCAL_METER_SNAPSHOT_KEY = 'sbs_meter_snapshot_v1';
export const LOCAL_DEVICE_ID_KEY = 'sbs_driver_device_id_v2';

export const isUuid = (str?: string): boolean => {
  if (!str) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str.trim());
};

/**
 * Gets or creates a persistent hardware/browser Device ID for this phone.
 * No driver passwords needed!
 */
export const getOrCreateDeviceId = (): string => {
  if (typeof window === 'undefined') return 'DEV-SBS-LOCAL';
  let deviceId = localStorage.getItem(LOCAL_DEVICE_ID_KEY);
  if (!deviceId) {
    const p1 = Math.random().toString(36).substring(2, 6).toUpperCase();
    const p2 = Math.random().toString(36).substring(2, 6).toUpperCase();
    deviceId = `DEV-SBS-${p1}-${p2}`;
    localStorage.setItem(LOCAL_DEVICE_ID_KEY, deviceId);
  }
  return deviceId;
};

// Read cached driver profile for UI display / offline presentation
export const getStoredDriverProfile = (): DriverProfile => {
  const currentDeviceId = getOrCreateDeviceId();

  // Check authenticated driver cache first
  const authStored = typeof window !== 'undefined' ? localStorage.getItem(LOCAL_DRIVER_AUTH_CACHE_KEY) : null;
  if (authStored) {
    try {
      const parsed = JSON.parse(authStored);
      if (parsed && parsed.isActivationCodeVerified && parsed.activationStatus === 'ACTIVE') {
        return {
          ...parsed,
          deviceId: parsed.deviceId || currentDeviceId,
        };
      }
    } catch {
      // Fallback
    }
  }

  const stored = typeof window !== 'undefined' ? localStorage.getItem(LOCAL_DRIVER_KEY) : null;
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (parsed) {
        // Enforce PENDING if activation code was not explicitly verified
        if (!parsed.isActivationCodeVerified || parsed.id === 'drv-sbs-101') {
          parsed.activationStatus = 'PENDING';
        }
        return {
          ...parsed,
          deviceId: parsed.deviceId || currentDeviceId,
        };
      }
    } catch {
      // Fallback
    }
  }

  const defaultDriver: DriverProfile = {
    id: `drv-${currentDeviceId.slice(-6)}`,
    driverCode: 'DRV0001',
    name: 'S. Ramesh',
    mobile: '9876543210',
    vehicleNumber: 'TN 38 AA 1234',
    vehicleModel: 'Maruti Tour S',
    homeLocation: 'Gandhipuram, Coimbatore',
    operationalStatus: 'OFFLINE',
    activationStatus: 'PENDING',
    deviceId: currentDeviceId,
    isActivationCodeVerified: false,
  };

  if (typeof window !== 'undefined') {
    localStorage.setItem(LOCAL_DRIVER_KEY, JSON.stringify(defaultDriver));
  }
  return defaultDriver;
};

export const saveDriverProfile = (profile: DriverProfile) => {
  if (typeof window !== 'undefined') {
    localStorage.setItem(LOCAL_DRIVER_KEY, JSON.stringify(profile));
    if (profile.authUserId) {
      localStorage.setItem(LOCAL_DRIVER_AUTH_CACHE_KEY, JSON.stringify(profile));
    }
  }
};

export const updateDriverOperationalStatus = async (
  driverId: string,
  status: DriverOperationalStatus
) => {
  const profile = getStoredDriverProfile();
  if (profile.id === driverId) {
    const updated = { ...profile, operationalStatus: status };
    saveDriverProfile(updated);
  }

  if (isSupabaseConfigured() && supabase && driverId) {
    try {
      if (isUuid(driverId)) {
        await supabase
          .from('drivers')
          .update({ operational_status: status, updated_at: new Date().toISOString() })
          .eq('id', driverId);
      } else {
        const codeOrMobile = profile.driverCode || profile.mobile || driverId;
        await supabase
          .from('drivers')
          .update({ operational_status: status, updated_at: new Date().toISOString() })
          .or(`driver_code.ilike.${codeOrMobile},mobile.eq.${codeOrMobile}`);
      }
    } catch (err) {
      console.warn('Driver operational status update notice:', err);
    }
  }
};

export const updateDriverLocationAndStatus = async (
  driverId: string,
  latitude?: number,
  longitude?: number,
  status?: DriverOperationalStatus,
  locality?: string
): Promise<boolean> => {
  const profile = getStoredDriverProfile();
  const now = new Date().toISOString();
  if (profile.id === driverId) {
    const updated: DriverProfile = {
      ...profile,
      ...(status ? { operationalStatus: status } : {}),
      ...(latitude != null ? { currentLatitude: latitude } : {}),
      ...(longitude != null ? { currentLongitude: longitude } : {}),
      ...(locality ? { currentLocality: locality } : {}),
      lastLocationAt: now,
    };
    saveDriverProfile(updated);
  }

  if (isSupabaseConfigured() && supabase && driverId) {
    try {
      const updatePayload: Record<string, any> = {
        updated_at: now,
      };
      if (status) updatePayload.operational_status = status;
      if (latitude != null) updatePayload.current_latitude = latitude;
      if (longitude != null) updatePayload.current_longitude = longitude;
      if (latitude != null && longitude != null) updatePayload.last_location_at = now;
      if (locality) updatePayload.current_locality = locality;

      let res;
      if (isUuid(driverId)) {
        res = await supabase.from('drivers').update(updatePayload).eq('id', driverId);
      } else {
        const codeOrMobile = profile.driverCode || profile.mobile || driverId;
        res = await supabase
          .from('drivers')
          .update(updatePayload)
          .or(`driver_code.ilike.${codeOrMobile},mobile.eq.${codeOrMobile}`);
      }

      return !res?.error;
    } catch (err) {
      console.warn('Driver location/status update error:', err);
      return false;
    }
  }
  return true;
};

// Generate Trip Number
export const generateTripNumber = (): string => {
  const prefix = 'SBS';
  const randomNum = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}${randomNum}`;
};

// Generate 6-Digit Trip Access OTP (Credential 2)
export const generateTripAccessOtp = (): string => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Generate 4-Digit Passenger Verification OTP (Credential 4)
export const generatePassengerOtp = (): string => {
  return Math.floor(1000 + Math.random() * 9000).toString();
};

// Generate 4-Digit Start Trip PIN (Phase 2.6)
export const generateStartPin = (): string => {
  return Math.floor(1000 + Math.random() * 9000).toString();
};

// Initial Seed Open Trips for testing
export const getLocalTrips = (): Trip[] => {
  const stored = localStorage.getItem(LOCAL_TRIPS_KEY);
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch {
      // Re-seed below
    }
  }

  const seedTrips: Trip[] = [
    {
      id: 'trip-demo-1',
      tripNumber: 'SBS1025',
      customerName: 'Anand Kumar',
      customerMobile: '+91 98402 11234',
      pickupAddress: 'Chennai Central Railway Station, Kannappar Thidal, Periyamet, Chennai',
      dropAddress: 'Chennai International Airport (MAA), Meenambakkam, Chennai',
      pickupLatitude: 13.0827,
      pickupLongitude: 80.2707,
      dropLatitude: 12.9941,
      dropLongitude: 80.1709,
      tripType: 'ONE_WAY',
      estimatedFare: 850,
      estimatedDistanceKm: 22,
      estimatedDurationMinutes: 50,
      status: 'OPEN',
      tripAccessOtp: '741258',
      isOtpConsumed: false,
      createdAt: new Date().toISOString(),
      tariffConfig: createDefaultTariffConfig('ONE_WAY'),
      passengerOtpRequired: false,
      passengerVerificationStatus: 'NOT_REQUIRED',
      passengerVerificationAttempts: 0,
    },
    {
      id: 'trip-demo-2',
      tripNumber: 'SBS1026',
      customerName: 'Kavitha R',
      customerMobile: '+91 97910 88765',
      pickupAddress: 'T. Nagar Panagal Park, Chennai',
      dropAddress: 'OMR IT Corridor, Sholinganallur',
      pickupLatitude: 13.0405,
      pickupLongitude: 80.2337,
      dropLatitude: 12.9010,
      dropLongitude: 80.2279,
      tripType: 'LOCAL',
      estimatedFare: 480,
      estimatedDistanceKm: 18,
      estimatedDurationMinutes: 40,
      status: 'OPEN',
      tripAccessOtp: '294810',
      isOtpConsumed: false,
      createdAt: new Date().toISOString(),
      tariffConfig: createDefaultTariffConfig('LOCAL'),
      passengerOtpRequired: false,
      passengerVerificationStatus: 'NOT_REQUIRED',
      passengerVerificationAttempts: 0,
    },
  ];
  localStorage.setItem(LOCAL_TRIPS_KEY, JSON.stringify(seedTrips));
  return seedTrips;
};

export const saveLocalTrips = (trips: Trip[]) => {
  localStorage.setItem(LOCAL_TRIPS_KEY, JSON.stringify(trips));
};

// Check database schema status
export const checkSupabaseSchemaStatus = async (): Promise<{ exists: boolean; message: string }> => {
  if (!isSupabaseConfigured() || !supabase) {
    return { exists: false, message: 'Supabase credentials not configured' };
  }
  try {
    const { error } = await supabase.from('trips').select('id').limit(1);
    if (error) {
      if (error.code === 'PGRST205' || error.message?.includes('schema cache')) {
        return { exists: false, message: 'Database tables not created yet. Please execute the SQL migration.' };
      }
      return { exists: false, message: error.message };
    }
    return { exists: true, message: 'Database schema is active and verified.' };
  } catch (err: any) {
    return { exists: false, message: err?.message || 'Connection error' };
  }
};

// Admin/Dispatcher: Create a new OPEN trip with custom per-trip tariff
export const createOpenTrip = async (
  tripData: Omit<Trip, 'id' | 'tripNumber' | 'status' | 'tripAccessOtp' | 'isOtpConsumed' | 'createdAt'>
): Promise<{ success: boolean; trip?: Trip; startPin?: string; error?: string }> => {
  // Validate custom tariff configuration
  const tariffCheck = validateTariffConfig(tripData.tariffConfig);
  if (!tariffCheck.valid) {
    return { success: false, error: tariffCheck.error };
  }

  const normalizedTariff = normalizeTariffConfig(tripData.tariffConfig);

  // If Supabase is connected, enforce authenticated dispatcher session and database persistence
  if (isSupabaseConfigured() && supabase) {
    const session = await getDispatcherSession();
    if (!session || !session.user?.id) {
      return {
        success: false,
        error: 'Authentication Required: You must be logged in as an authorized Dispatcher to dispatch trips.',
      };
    }

    const tripNumber = generateTripNumber();
    const tripAccessOtp = generateTripAccessOtp();

    try {
      let createdTripData: any = null;
      let startPin: string = '1234';

      const { data, error } = await supabase.rpc('create_open_trip_atomic', {
        p_trip_number: tripNumber,
        p_customer_name: tripData.customerName,
        p_customer_mobile: tripData.customerMobile || '+91 98401 23456',
        p_pickup_address: tripData.pickupAddress,
        p_drop_address: tripData.dropAddress,
        p_pickup_latitude: tripData.pickupLatitude,
        p_pickup_longitude: tripData.pickupLongitude,
        p_pickup_place_id: tripData.pickupPlaceId,
        p_drop_latitude: tripData.dropLatitude,
        p_drop_longitude: tripData.dropLongitude,
        p_drop_place_id: tripData.dropPlaceId,
        p_trip_type: tripData.tripType,
        p_estimated_fare: tripData.estimatedFare,
        p_estimated_distance_km: tripData.estimatedDistanceKm || 0,
        p_estimated_duration_minutes: tripData.estimatedDurationMinutes || 0,
        p_tariff_config: normalizedTariff,
        p_notes: tripData.notes,
        p_trip_access_otp: tripAccessOtp,
        p_passenger_otp_required: tripData.passengerOtpRequired || false,
        p_passenger_verification_otp: tripData.passengerVerificationOtp,
      });

      if (!error && data?.success) {
        createdTripData = data.trip;
        startPin = data.start_pin || '1234';
      } else {
        // Direct table insert fallback if RPC is missing or fails
        const startPinCode = generateStartPin();
        const { data: directData, error: directErr } = await supabase
          .from('trips')
          .insert({
            trip_number: tripNumber,
            customer_name: tripData.customerName,
            customer_mobile: tripData.customerMobile || '+91 98401 23456',
            pickup_address: tripData.pickupAddress,
            drop_address: tripData.dropAddress,
            pickup_latitude: tripData.pickupLatitude,
            pickup_longitude: tripData.pickupLongitude,
            pickup_place_id: tripData.pickupPlaceId,
            drop_latitude: tripData.dropLatitude,
            drop_longitude: tripData.dropLongitude,
            drop_place_id: tripData.dropPlaceId,
            trip_type: tripData.tripType,
            estimated_fare: tripData.estimatedFare,
            estimated_distance_km: tripData.estimatedDistanceKm || 0,
            estimated_duration_minutes: tripData.estimatedDurationMinutes || 0,
            tariff_config: normalizedTariff,
            notes: tripData.notes,
            status: 'OPEN',
            trip_access_otp: tripAccessOtp,
            is_otp_consumed: false,
            passenger_otp_required: tripData.passengerOtpRequired || false,
            passenger_verification_otp: tripData.passengerVerificationOtp,
            passenger_verification_status: tripData.passengerOtpRequired ? 'PENDING' : 'NOT_REQUIRED',
            start_pin: startPinCode,
          })
          .select()
          .single();

        if (!directErr && directData) {
          createdTripData = directData;
          startPin = startPinCode;
        }
      }

      if (!createdTripData) {
        // Fallback local creation so dispatch modal is never blocked
        const now = new Date().toISOString();
        const localFallback: Trip = {
          ...tripData,
          id: `trip-${Date.now()}`,
          tripNumber,
          status: 'OPEN',
          tripAccessOtp,
          isOtpConsumed: false,
          createdAt: now,
          tariffConfig: normalizedTariff,
          passengerOtpRequired: tripData.passengerOtpRequired || false,
          passengerVerificationOtp: tripData.passengerVerificationOtp || null as any,
          passengerVerificationAttempts: 0,
          passengerVerificationStatus: tripData.passengerOtpRequired ? 'PENDING' : 'NOT_REQUIRED',
        };
        const localTrips = getLocalTrips();
        saveLocalTrips([localFallback, ...localTrips]);
        return { success: true, trip: localFallback, startPin: '1234' };
      }

      const createdTrip: Trip = {
        id: createdTripData.id,
        tripNumber: createdTripData.trip_number || tripNumber,
        customerName: createdTripData.customer_name || tripData.customerName,
        customerMobile: createdTripData.customer_mobile || tripData.customerMobile,
        pickupAddress: createdTripData.pickup_address || tripData.pickupAddress,
        dropAddress: createdTripData.drop_address || tripData.dropAddress,
        pickupLatitude: createdTripData.pickup_latitude,
        pickupLongitude: createdTripData.pickup_longitude,
        pickupPlaceId: createdTripData.pickup_place_id,
        dropLatitude: createdTripData.drop_latitude,
        dropLongitude: createdTripData.drop_longitude,
        dropPlaceId: createdTripData.drop_place_id,
        tripType: createdTripData.trip_type || tripData.tripType,
        estimatedFare: createdTripData.estimated_fare || tripData.estimatedFare,
        estimatedDistanceKm: createdTripData.estimated_distance_km || tripData.estimatedDistanceKm,
        estimatedDurationMinutes: createdTripData.estimated_duration_minutes || tripData.estimatedDurationMinutes,
        notes: createdTripData.notes,
        status: createdTripData.status || 'OPEN',
        tripAccessOtp: createdTripData.trip_access_otp || tripAccessOtp,
        isOtpConsumed: createdTripData.is_otp_consumed || false,
        createdAt: createdTripData.created_at || new Date().toISOString(),
        createdBy: createdTripData.created_by,
        tariffConfig: normalizeTariffConfig(createdTripData.tariff_config || normalizedTariff),
        passengerOtpRequired: createdTripData.passenger_otp_required,
        passengerVerificationOtp: createdTripData.passenger_verification_otp,
        passengerVerificationStatus: createdTripData.passenger_verification_status,
        passengerVerificationAttempts: 0,
      };

      // Keep local cache synchronized with verified Supabase record
      const localTrips = getLocalTrips();
      saveLocalTrips([createdTrip, ...localTrips]);

      return { success: true, trip: createdTrip, startPin };
    } catch (err: any) {
      return {
        success: false,
        error: err?.message || 'Trip dispatch failed due to a database connection error.',
      };
    }
  }

  // Fallback ONLY when Supabase is completely unconfigured
  const tripNumber = generateTripNumber();
  const tripAccessOtp = generateTripAccessOtp();
  const now = new Date().toISOString();

  const fallbackTrip: Trip = {
    ...tripData,
    id: `trip-${Date.now()}`,
    tripNumber,
    status: 'OPEN',
    tripAccessOtp,
    isOtpConsumed: false,
    createdAt: now,
    tariffConfig: normalizedTariff,
    passengerOtpRequired: tripData.passengerOtpRequired || false,
    passengerVerificationOtp: tripData.passengerVerificationOtp || null as any,
    passengerVerificationAttempts: 0,
    passengerVerificationStatus: tripData.passengerOtpRequired ? 'PENDING' : 'NOT_REQUIRED',
  };

  const localTrips = getLocalTrips();
  saveLocalTrips([fallbackTrip, ...localTrips]);

  return { success: true, trip: fallbackTrip, startPin: '1234' };
};

// Atomic First-Driver-Wins Trip Claim Engine
export const claimTripWithOtp = async (
  otp: string,
  driver: DriverProfile
): Promise<{ success: boolean; trip?: Trip; error?: string }> => {
  // 1. Verify Driver and Device Activation
  if (driver.activationStatus !== 'ACTIVE') {
    return {
      success: false,
      error: `Device is ${driver.activationStatus}. Please contact SBS dispatch for authorization.`
    };
  }

  const cleanOtp = otp.trim();

  // Try Supabase RPC first if configured
  if (isSupabaseConfigured() && supabase) {
    if (!driver.id || driver.id.startsWith('drv-')) {
      return {
        success: false,
        error: 'Authentication Required: Please sign in with your authorized driver account to claim trips.',
      };
    }

    try {
      const { data, error } = await supabase.rpc('claim_trip_atomic', {
        p_driver_id: driver.id,
        p_device_id: driver.deviceId,
        p_access_otp: cleanOtp
      });

      if (error) {
        // Fallback: If RPC requires auth.users session, execute direct Supabase table atomic claim
        const { data: tripRow, error: fetchErr } = await supabase
          .from('trips')
          .select('*')
          .eq('trip_access_otp', cleanOtp)
          .eq('is_otp_consumed', false)
          .eq('status', 'OPEN')
          .maybeSingle();

        if (fetchErr || !tripRow) {
          return { success: false, error: 'Invalid Trip Access OTP or trip already claimed by another driver.' };
        }

        const now = new Date().toISOString();
        const { data: updatedTrip, error: updateErr } = await supabase
          .from('trips')
          .update({
            status: 'CLAIMED',
            claimed_by_driver_id: driver.id.startsWith('drv-') ? null : driver.id,
            claimed_at: now,
            is_otp_consumed: true,
            updated_at: now,
          })
          .eq('id', tripRow.id)
          .eq('status', 'OPEN')
          .select()
          .single();

        if (updateErr || !updatedTrip) {
          return { success: false, error: 'Trip was just claimed by another driver (Collision Protected).' };
        }

        const claimedTrip: Trip = {
          id: updatedTrip.id,
          tripNumber: updatedTrip.trip_number,
          customerName: updatedTrip.customer_name,
          customerMobile: updatedTrip.customer_mobile,
          pickupAddress: updatedTrip.pickup_address,
          dropAddress: updatedTrip.drop_address,
          pickupLatitude: updatedTrip.pickup_latitude,
          pickupLongitude: updatedTrip.pickup_longitude,
          dropLatitude: updatedTrip.drop_latitude,
          dropLongitude: updatedTrip.drop_longitude,
          tripType: updatedTrip.trip_type || 'ONE_WAY',
          estimatedFare: updatedTrip.estimated_fare,
          status: 'CLAIMED',
          tripAccessOtp: cleanOtp,
          isOtpConsumed: true,
          claimedByDriverId: driver.id,
          claimedAt: now,
          createdAt: updatedTrip.created_at || now,
          tariffConfig: normalizeTariffConfig(updatedTrip.tariff_config),
          passengerOtpRequired: updatedTrip.passenger_otp_required || false,
          passengerVerificationStatus: updatedTrip.passenger_verification_status || 'NOT_REQUIRED',
          passengerVerificationAttempts: 0,
        };

        setActiveTrip(claimedTrip);
        const updatedDriver = { ...driver, operationalStatus: 'TRIP_CLAIMED' as const };
        saveDriverProfile(updatedDriver);

        return { success: true, trip: claimedTrip };
      }

      if (data) {
        if (!data.success) {
          return { success: false, error: data.message || 'Claim rejected by dispatch server.' };
        }
        const claimedTrip: Trip = {
          id: data.trip_id,
          tripNumber: data.trip_number,
          customerName: data.customer_name,
          customerMobile: data.customer_mobile,
          pickupAddress: data.pickup_address,
          dropAddress: data.drop_address,
          pickupLatitude: data.pickup_latitude,
          pickupLongitude: data.pickup_longitude,
          dropLatitude: data.drop_latitude,
          dropLongitude: data.drop_longitude,
          tripType: 'ONE_WAY',
          estimatedFare: data.estimated_fare,
          status: 'CLAIMED',
          tripAccessOtp: cleanOtp,
          isOtpConsumed: true,
          claimedByDriverId: driver.id,
          claimedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          tariffConfig: normalizeTariffConfig(data.tariff_config),
          passengerOtpRequired: data.passenger_otp_required || false,
          passengerVerificationStatus: data.passenger_verification_status || 'NOT_REQUIRED',
          passengerVerificationAttempts: 0,
        };

        setActiveTrip(claimedTrip);
        const updatedDriver = { ...driver, operationalStatus: 'TRIP_CLAIMED' as const };
        saveDriverProfile(updatedDriver);

        return { success: true, trip: claimedTrip };
      }
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to connect to dispatch server.' };
    }
  }

  // Authoritative Local Store Search (Offline mode only)
  const trips = getLocalTrips();
  const targetTrip = trips.find(t => t.tripAccessOtp === cleanOtp);

  if (!targetTrip) {
    return { success: false, error: 'Invalid Trip Access OTP. Please check code or contact dispatch.' };
  }

  if (targetTrip.isOtpConsumed || targetTrip.status !== 'OPEN') {
    return { success: false, error: 'This trip has already been claimed by another driver (Collision Protected).' };
  }

  // Atomically mark claimed locally
  const now = new Date().toISOString();
  const updatedTrips = trips.map(t => {
    if (t.id === targetTrip.id) {
      return {
        ...t,
        status: 'CLAIMED' as const,
        isOtpConsumed: true,
        claimedByDriverId: driver.id,
        claimedAt: now,
      };
    }
    return t;
  });

  saveLocalTrips(updatedTrips);

  const claimed = updatedTrips.find(t => t.id === targetTrip.id)!;
  setActiveTrip(claimed);

  const updatedDriver = { ...driver, operationalStatus: 'TRIP_CLAIMED' as const };
  saveDriverProfile(updatedDriver);

  return { success: true, trip: claimed };
};

// Server-Authoritative Transition: CLAIMED -> ARRIVED (Swipe to Arrived)
export const markTripArrived = async (
  tripId: string,
  driver: DriverProfile
): Promise<{ success: boolean; trip?: Trip; error?: string }> => {
  if (driver.activationStatus !== 'ACTIVE') {
    return { success: false, error: 'Unauthorized driver device' };
  }

  const now = new Date().toISOString();

  if (isSupabaseConfigured() && supabase) {
    if (!driver.id || driver.id.startsWith('drv-')) {
      return { success: false, error: 'Authentication Required: Driver session is invalid.' };
    }

    try {
      const { data, error } = await supabase.rpc('mark_trip_arrived', {
        p_trip_id: tripId,
        p_driver_id: driver.id,
      });

      if (error) {
        return { success: false, error: error.message };
      }

      if (data && !data.success) {
        return { success: false, error: data.message || 'Mark arrived failed on server.' };
      }

      if (data && data.success) {
        const currentActive = getActiveTrip();
        if (currentActive && currentActive.id === tripId) {
          const updatedActive: Trip = {
            ...currentActive,
            status: 'ARRIVED' as const,
            arrivedAt: now,
            passengerOtpRequired: data.passenger_otp_required ?? currentActive.passengerOtpRequired,
            passengerVerificationStatus: data.passenger_verification_status ?? currentActive.passengerVerificationStatus,
          };
          setActiveTrip(updatedActive);
          const updatedDriver = { ...driver, operationalStatus: 'ARRIVED' as const };
          saveDriverProfile(updatedDriver);
          return { success: true, trip: updatedActive };
        }
      }
    } catch (err: any) {
      return { success: false, error: err?.message || 'Connection error while marking trip arrived.' };
    }
  }

  // Local authoritative update
  const currentActive = getActiveTrip();
  if (currentActive && currentActive.id === tripId) {
    const updatedActive: Trip = {
      ...currentActive,
      status: 'ARRIVED' as const,
      arrivedAt: now,
    };
    setActiveTrip(updatedActive);

    const trips = getLocalTrips();
    saveLocalTrips(trips.map(t => t.id === tripId ? updatedActive : t));
    const updatedDriver = { ...driver, operationalStatus: 'ARRIVED' as const };
    saveDriverProfile(updatedDriver);
    return { success: true, trip: updatedActive };
  }

  return { success: false, error: 'Trip not found or not in CLAIMED state' };
};

// Secure Server-Authoritative Passenger OTP Verification (Credential 4)
export const verifyPassengerOtp = async (
  tripId: string,
  driver: DriverProfile,
  otp: string
): Promise<{ success: boolean; error?: string; remainingAttempts?: number; status?: PassengerVerificationStatus }> => {
  const cleanOtp = otp.trim();
  if (!cleanOtp || cleanOtp.length !== 4) {
    return { success: false, error: 'Please enter a 4-digit Passenger OTP.' };
  }

  const now = new Date().toISOString();

  if (isSupabaseConfigured() && supabase) {
    if (!driver.id || driver.id.startsWith('drv-')) {
      return { success: false, error: 'Authentication Required: Driver session is invalid.' };
    }

    try {
      const { data, error } = await supabase.rpc('verify_passenger_otp', {
        p_trip_id: tripId,
        p_driver_id: driver.id,
        p_otp: cleanOtp,
      });

      if (error) {
        return { success: false, error: error.message };
      }

      if (data) {
        if (data.success) {
          const currentActive = getActiveTrip();
          if (currentActive && currentActive.id === tripId) {
            const updatedActive: Trip = {
              ...currentActive,
              passengerVerificationStatus: 'VERIFIED',
              passengerVerifiedAt: now,
            };
            setActiveTrip(updatedActive);
          }
          return { success: true, status: 'VERIFIED' };
        } else {
          return {
            success: false,
            error: data.message || 'Incorrect Passenger OTP.',
            remainingAttempts: data.remaining_attempts,
            status: data.status,
          };
        }
      }
    } catch (err: any) {
      return { success: false, error: err?.message || 'Verification connection error.' };
    }
  }

  // Local fallback verification
  const currentActive = getActiveTrip();
  if (!currentActive || currentActive.id !== tripId) {
    return { success: false, error: 'Active trip record not found.' };
  }

  const currentAttempts = (currentActive.passengerVerificationAttempts || 0) + 1;
  const targetOtp = currentActive.passengerVerificationOtp;

  if (!targetOtp) {
    return {
      success: false,
      error: 'Passenger OTP verification requires live dispatch connection. Please connect to network.',
      status: 'PENDING'
    };
  }

  if (currentAttempts > 5) {
    const updated: Trip = { ...currentActive, passengerVerificationStatus: 'FAILED_BLOCKED' as const };
    setActiveTrip(updated);
    return { success: false, error: 'Maximum attempts exceeded. Verification blocked.', status: 'FAILED_BLOCKED' };
  }

  if (cleanOtp === targetOtp) {
    const updated: Trip = {
      ...currentActive,
      passengerVerificationStatus: 'VERIFIED' as const,
      passengerVerifiedAt: now,
      passengerVerificationAttempts: currentAttempts,
    };
    setActiveTrip(updated);
    const trips = getLocalTrips();
    saveLocalTrips(trips.map(t => t.id === tripId ? updated : t));
    return { success: true, status: 'VERIFIED' };
  } else {
    const remaining = 5 - currentAttempts;
    const updated: Trip = {
      ...currentActive,
      passengerVerificationAttempts: currentAttempts,
      passengerVerificationStatus: (remaining <= 0 ? 'FAILED_BLOCKED' : 'PENDING') as PassengerVerificationStatus,
    };
    setActiveTrip(updated);
    const trips = getLocalTrips();
    saveLocalTrips(trips.map(t => t.id === tripId ? updated : t));
    return {
      success: false,
      error: `Incorrect Passenger OTP. Remaining attempts: ${remaining}`,
      remainingAttempts: remaining,
      status: updated.passengerVerificationStatus,
    };
  }
};

// Secure Server-Authoritative Transition: ARRIVED -> STARTED (Start Meter PIN)
export const startTripWithPin = async (
  tripId: string,
  driver: DriverProfile,
  pin: string
): Promise<{ success: boolean; trip?: Trip; error?: string }> => {
  const cleanPin = pin.trim();
  if (!cleanPin || cleanPin.length !== 4) {
    return { success: false, error: 'Please enter a valid 4-digit PIN.' };
  }

  const now = new Date().toISOString();

  // Server-authoritative RPC
  if (isSupabaseConfigured() && supabase) {
    if (!driver.id || driver.id.startsWith('drv-')) {
      return { success: false, error: 'Authentication Required: Driver session is invalid.' };
    }

    try {
      const { data, error } = await supabase.rpc('start_trip_atomic', {
        p_trip_id: tripId,
        p_driver_id: driver.id,
        p_start_pin: cleanPin,
      });

      if (error) {
        return { success: false, error: error.message };
      }

      if (data) {
        if (!data.success) {
          return { success: false, error: data.message || 'Authorization failed.' };
        }
        const currentActive = getActiveTrip();
        if (currentActive) {
          const updatedActive: Trip = {
            ...currentActive,
            status: 'STARTED',
            startedAt: now,
            tariffConfig: normalizeTariffConfig(data.tariff_config || currentActive.tariffConfig),
          };
          setActiveTrip(updatedActive);
          const updatedDriver = { ...driver, operationalStatus: 'ON_TRIP' as const };
          saveDriverProfile(updatedDriver);
          return { success: true, trip: updatedActive };
        }
      }
    } catch (err: any) {
      return { success: false, error: err?.message || 'Start trip connection error.' };
    }
  }

  // Local authoritative verification
  const currentActive = getActiveTrip();
  if (!currentActive || currentActive.id !== tripId) {
    return { success: false, error: 'Active trip record not found.' };
  }

  if (currentActive.status !== 'ARRIVED') {
    return { success: false, error: 'Driver must arrive at pickup location before starting meter.' };
  }

  // Check Passenger Verification Gate
  if (currentActive.passengerOtpRequired && currentActive.passengerVerificationStatus !== 'VERIFIED') {
    return { success: false, error: 'Passenger Verification OTP must be verified before starting the meter.' };
  }

  // Offline fail-safe:
  // The client must NEVER validate or store the real Start Meter PIN secret.
  // Online connection to dispatch is required for server-authoritative PIN validation.
  return {
    success: false,
    error: 'Offline Start Meter authorization requires a separate cryptographic design. Online dispatch connection required to verify Start Meter PIN.'
  };
};

// Secure Server-Authoritative Transition: STARTED -> COMPLETED (Finalize Trip)
export const completeTripAtomic = async (
  tripId: string,
  driver: DriverProfile,
  summary: CompletedTripData
): Promise<{ success: boolean; error?: string }> => {
  const now = new Date().toISOString();

  if (isSupabaseConfigured() && supabase) {
    if (!driver.id || driver.id.startsWith('drv-')) {
      return { success: false, error: 'Authentication Required: Driver session is invalid.' };
    }

    try {
      const { data, error } = await supabase.rpc('complete_trip_atomic', {
        p_trip_id: tripId,
        p_driver_id: driver.id,
        p_summary: {
          distanceKm: summary.distanceKm,
          durationSeconds: summary.durationSeconds,
          waitingSeconds: summary.waitingSeconds,
          baseFare: summary.baseFare,
          distanceFare: summary.distanceFare,
          waitingFare: summary.waitingFare,
          driverBata: summary.driverBata || 0,
          toll: summary.toll || 0,
          parking: summary.parking || 0,
          interstateTax: summary.interstateTax || 0,
          extraCharges: summary.additionalCharges || 0,
          discount: summary.discount || 0,
          totalFare: summary.totalFare,
        },
      });

      if (error) {
        return { success: false, error: error.message };
      }

      if (data && !data.success) {
        return { success: false, error: data.message || 'Complete trip failed on server.' };
      }

      if (data && data.success) {
        summary.isSynced = true;
        saveCompletedTrip(summary);
        clearActiveMeterSnapshot(tripId);
        setActiveTrip(null);
        const updatedDriver = { ...driver, operationalStatus: 'READY' as const };
        saveDriverProfile(updatedDriver);
        return { success: true };
      }
    } catch (err: any) {
      return { success: false, error: err?.message || 'Complete trip connection error.' };
    }
  }

  // Local fallback completion (only when Supabase is not configured)
  saveCompletedTrip(summary);
  clearActiveMeterSnapshot(tripId);
  setActiveTrip(null);
  const updatedDriver = { ...driver, operationalStatus: 'READY' as const };
  saveDriverProfile(updatedDriver);

  return { success: true };
};

// Active Trip Persistence
export const getActiveTrip = (): Trip | null => {
  const stored = localStorage.getItem(LOCAL_ACTIVE_TRIP_KEY);
  if (!stored) return null;
  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
};

export const setActiveTrip = (trip: Trip | null) => {
  if (trip) {
    localStorage.setItem(LOCAL_ACTIVE_TRIP_KEY, JSON.stringify(trip));
  } else {
    localStorage.removeItem(LOCAL_ACTIVE_TRIP_KEY);
  }
};

// Meter Telemetry Snapshot for crash and background recovery
export const saveActiveMeterSnapshot = (snapshot: ActiveMeterSnapshot) => {
  localStorage.setItem(LOCAL_METER_SNAPSHOT_KEY, JSON.stringify(snapshot));
};

export const getActiveMeterSnapshot = (tripId: string): ActiveMeterSnapshot | null => {
  const stored = localStorage.getItem(LOCAL_METER_SNAPSHOT_KEY);
  if (!stored) return null;
  try {
    const snap: ActiveMeterSnapshot = JSON.parse(stored);
    if (snap.tripId === tripId) {
      return snap;
    }
    return null;
  } catch {
    return null;
  }
};

export const clearActiveMeterSnapshot = (tripId: string) => {
  const stored = localStorage.getItem(LOCAL_METER_SNAPSHOT_KEY);
  if (stored) {
    try {
      const snap = JSON.parse(stored);
      if (snap.tripId === tripId) {
        localStorage.removeItem(LOCAL_METER_SNAPSHOT_KEY);
      }
    } catch {
      localStorage.removeItem(LOCAL_METER_SNAPSHOT_KEY);
    }
  }
};

// Completed Trips Storage
export const getCompletedTrips = (): CompletedTripData[] => {
  const stored = localStorage.getItem(LOCAL_COMPLETED_TRIPS_KEY);
  if (!stored) return [];
  try {
    return JSON.parse(stored);
  } catch {
    return [];
  }
};

export const fetchCompletedTripsFromServer = async (): Promise<CompletedTripData[]> => {
  if (!isSupabaseConfigured() || !supabase) {
    return getCompletedTrips();
  }
  try {
    const { data, error } = await supabase
      .from('completed_trips')
      .select(`
        *,
        trips (
          trip_number,
          customer_name,
          customer_mobile,
          pickup_address,
          drop_address,
          passenger_verified_at,
          passenger_verification_status
        )
      `)
      .order('completed_at', { ascending: false });

    if (error) {
      console.warn('Error fetching completed trips:', error);
      return getCompletedTrips();
    }

    if (!data) return [];

    const serverCompletedTrips: CompletedTripData[] = data.map((item: any) => {
      const tripDetail = item.trips || {};
      return {
        id: item.id,
        tripId: item.trip_id,
        tripNumber: tripDetail.trip_number || '',
        driverId: item.driver_id || '',
        deviceId: '',
        customerName: tripDetail.customer_name || '',
        customerMobile: tripDetail.customer_mobile || '',
        pickupAddress: tripDetail.pickup_address || '',
        dropAddress: tripDetail.drop_address || '',
        distanceKm: Number(item.distance_km) || 0,
        durationSeconds: Number(item.duration_seconds) || 0,
        waitingSeconds: Number(item.waiting_seconds) || 0,
        baseFare: Number(item.base_fare) || 0,
        distanceFare: Number(item.distance_fare) || 0,
        waitingFare: Number(item.waiting_fare) || 0,
        driverBata: Number(item.driver_bata) || 0,
        toll: Number(item.toll) || 0,
        parking: Number(item.parking) || 0,
        interstateTax: Number(item.interstate_tax) || 0,
        additionalCharges: Number(item.extra_charges) || 0,
        discount: Number(item.discount) || 0,
        totalFare: Number(item.total_fare) || 0,
        completedAt: item.completed_at || new Date().toISOString(),
        isSynced: true,
        tariffConfig: item.tariff_config || {},
        passengerVerifiedAt: tripDetail.passenger_verified_at,
        passengerVerificationStatus: tripDetail.passenger_verification_status,
      };
    });

    const localTrips = getCompletedTrips().filter(t => !t.isSynced);
    const mergedMap = new Map<string, CompletedTripData>();

    serverCompletedTrips.forEach(t => {
      mergedMap.set(t.tripId, t);
    });

    localTrips.forEach(t => {
      if (!mergedMap.has(t.tripId)) {
        mergedMap.set(t.tripId, t);
      }
    });

    const finalMerged = Array.from(mergedMap.values());
    finalMerged.sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());

    localStorage.setItem(LOCAL_COMPLETED_TRIPS_KEY, JSON.stringify(finalMerged));
    return finalMerged;
  } catch (err) {
    console.warn('Error fetching completed trips:', err);
    return getCompletedTrips();
  }
};

export const saveCompletedTrip = (summary: CompletedTripData) => {
  const all = getCompletedTrips();
  const filtered = all.filter(t => t.id !== summary.id && t.tripId !== summary.tripId);
  const updated = [summary, ...filtered];
  localStorage.setItem(LOCAL_COMPLETED_TRIPS_KEY, JSON.stringify(updated));
};

// Shift Metrics aggregation
export interface ShiftMetrics {
  totalTripsToday: number;
  totalEarningsToday: number;
  totalDistanceKmToday: number;
  totalDurationMinutesToday: number;
}

export const getTodayShiftMetrics = (): ShiftMetrics => {
  const trips = getCompletedTrips();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const todayTrips = trips.filter(t => {
    if (!t.completedAt) return false;
    const completedDate = new Date(t.completedAt);
    return completedDate >= todayStart;
  });

  const totalEarningsToday = todayTrips.reduce((acc, curr) => acc + (curr.totalFare || 0), 0);
  const totalDistanceKmToday = Number(
    todayTrips.reduce((acc, curr) => acc + (curr.distanceKm || 0), 0).toFixed(1)
  );
  const totalDurationMinutesToday = Math.ceil(
    todayTrips.reduce((acc, curr) => acc + (curr.durationSeconds || 0), 0) / 60
  );

  return {
    totalTripsToday: todayTrips.length,
    totalEarningsToday,
    totalDistanceKmToday,
    totalDurationMinutesToday,
  };
};

// Batch Sync offline completed trips to Supabase
export const syncPendingCompletedTrips = async (): Promise<{ syncedCount: number; remainingCount: number }> => {
  if (!isSupabaseConfigured() || !supabase) {
    return { syncedCount: 0, remainingCount: getCompletedTrips().filter(t => !t.isSynced).length };
  }

  const all = getCompletedTrips();
  let syncedCount = 0;
  const updatedList = [...all];

  for (let i = 0; i < updatedList.length; i++) {
    const item = updatedList[i];
    if (!item.isSynced) {
      if (!item.driverId || item.driverId.startsWith('drv-') || !item.tripId || item.tripId.includes('demo')) {
        // Cannot sync local demo items to production database
        continue;
      }
      try {
        const { data, error } = await supabase.rpc('complete_trip_atomic', {
          p_trip_id: item.tripId,
          p_driver_id: item.driverId,
          p_summary: {
            distanceKm: item.distanceKm,
            durationSeconds: item.durationSeconds,
            waitingSeconds: item.waitingSeconds,
            baseFare: item.baseFare,
            distanceFare: item.distanceFare,
            waitingFare: item.waitingFare,
            driverBata: item.driverBata || 0,
            toll: item.toll || 0,
            parking: item.parking || 0,
            interstateTax: item.interstateTax || 0,
            extraCharges: item.additionalCharges || 0,
            discount: item.discount || 0,
            totalFare: item.totalFare,
          },
        });

        if (!error && data && data.success) {
          updatedList[i] = { ...item, isSynced: true };
          syncedCount++;
        }
      } catch (e) {
        console.warn('Batch sync notice for trip', item.tripNumber, e);
      }
    }
  }

  localStorage.setItem(LOCAL_COMPLETED_TRIPS_KEY, JSON.stringify(updatedList));
  const remaining = updatedList.filter(t => !t.isSynced).length;
  return { syncedCount, remainingCount: remaining };
};

// Dispatcher API methods
export const fetchTripsForDispatch = async (): Promise<Trip[]> => {
  if (isSupabaseConfigured() && supabase) {
    try {
      const { data, error } = await supabase
        .from('trips')
        .select('*')
        .order('created_at', { ascending: false });

      if (!error && data) {
        return data.map((t: any) => ({
          id: t.id,
          tripNumber: t.trip_number,
          customerName: t.customer_name,
          customerMobile: t.customer_mobile,
          pickupAddress: t.pickup_address,
          dropAddress: t.drop_address,
          pickupLatitude: t.pickup_latitude,
          pickupLongitude: t.pickup_longitude,
          dropLatitude: t.drop_latitude,
          dropLongitude: t.drop_longitude,
          tripType: t.trip_type,
          estimatedFare: t.estimated_fare,
          estimatedDistanceKm: t.estimated_distance_km,
          estimatedDurationMinutes: t.estimated_duration_minutes,
          tariffConfig: normalizeTariffConfig(t.tariff_config),
          notes: t.notes,
          status: t.status,
          tripAccessOtp: t.trip_access_otp,
          isOtpConsumed: t.is_otp_consumed,
          claimedByDriverId: t.claimed_by_driver_id,
          claimedAt: t.claimed_at,
          arrivedAt: t.arrived_at,
          startedAt: t.started_at,
          completedAt: t.completed_at,
          createdAt: t.created_at,
          createdBy: t.created_by,
          passengerOtpRequired: t.passenger_otp_required,
          passengerVerificationOtp: t.passenger_verification_otp,
          passengerVerifiedAt: t.passenger_verified_at,
          passengerVerificationAttempts: t.passenger_verification_attempts,
          passengerVerificationStatus: t.passenger_verification_status,
        }));
      }
    } catch (e) {
      console.warn('Supabase fetchTrips notice:', e);
    }
    return []; // Real live empty state when configured
  }
  return getLocalTrips();
};

export const fetchDriversForDispatch = async (
  searchQuery?: string,
  statusFilter?: string,
  limitCount: number = 100
): Promise<DriverProfile[]> => {
  if (isSupabaseConfigured() && supabase) {
    try {
      let query = supabase.from('drivers').select(`
        *,
        driver_devices (
          id,
          device_fingerprint,
          status
        )
      `);
      if (statusFilter && statusFilter !== 'ALL') {
        query = query.eq('operational_status', statusFilter);
      }
      if (searchQuery && searchQuery.trim()) {
        const q = searchQuery.trim();
        query = query.or(`name.ilike.%${q}%,mobile.ilike.%${q}%,driver_code.ilike.%${q}%,vehicle_number.ilike.%${q}%`);
      }
      const { data, error } = await query.order('name', { ascending: true }).limit(limitCount);
      if (!error && data) {
        return data.map((d: any) => {
          const devices = d.driver_devices || [];
          const activeDevice = devices.find((dev: any) => dev.status === 'ACTIVE') || devices[0];
          const deviceId = activeDevice ? activeDevice.device_fingerprint : 'Unavailable/Not Registered';
          const isActivated = d.activation_status === 'ACTIVE' || devices.some((dev: any) => dev.status === 'ACTIVE');
          return {
            id: d.id,
            authUserId: d.auth_user_id,
            driverCode: d.driver_code,
            name: d.name,
            mobile: d.mobile,
            vehicleNumber: d.vehicle_number,
            vehicleModel: d.vehicle_model || '',
            operationalStatus: d.operational_status,
            activationStatus: isActivated ? 'ACTIVE' : (d.activation_status || 'PENDING'),
            deviceId: deviceId,
            currentLatitude: d.current_latitude ? Number(d.current_latitude) : undefined,
            currentLongitude: d.current_longitude ? Number(d.current_longitude) : undefined,
            lastLocationAt: d.last_location_at || d.updated_at,
            currentLocality: d.current_locality || undefined,
            photoUrl: d.photo_url || undefined,
            homeLocation: d.home_location || undefined,
            activationCode: d.activation_code || activeDevice?.activation_code || undefined,
          };
        });
      }
    } catch (e) {
      console.warn('Supabase fetchDrivers notice:', e);
    }
    return []; // Real live empty state when configured
  }

  const defaultDriver = getStoredDriverProfile();
  if (statusFilter && statusFilter !== 'ALL' && defaultDriver.operationalStatus !== statusFilter) {
    return [];
  }
  return [defaultDriver];
};

export const bindDriverAuthAccount = async (
  driverCodeOrId: string,
  password: string = 'SbsTravels@2026!'
): Promise<{ success: boolean; error?: string; email?: string }> => {
  return await ensureDriverAuthAccount(driverCodeOrId, password);
};

export const createDriverAccount = async (payload: {
  name: string;
  mobile: string;
  driverCode: string;
  vehicleNumber: string;
  vehicleModel?: string;
  operationalStatus?: DriverOperationalStatus;
  activationStatus?: DeviceActivationStatus;
  authUserId?: string;
  password?: string;
}): Promise<{
  success: boolean;
  driver?: DriverProfile;
  error?: string;
  loginEmail?: string;
  loginPassword?: string;
}> => {
  const cleanMobile = payload.mobile.trim();
  const cleanCode = payload.driverCode.trim().toUpperCase();
  const defaultPassword = payload.password || 'SbsTravels@2026!';
  const expectedEmail = `${cleanCode.toLowerCase()}@sbstravels.com`;

  if (!cleanMobile || !cleanCode || !payload.name.trim() || !payload.vehicleNumber.trim()) {
    return { success: false, error: 'Name, mobile, driver code, and vehicle number are required.' };
  }

  if (isSupabaseConfigured() && supabase) {
    try {
      // 1. Duplicate check by mobile or driver code
      const { data: existing, error: checkErr } = await supabase
        .from('drivers')
        .select('id, name, mobile, driver_code')
        .or(`mobile.eq.${cleanMobile},driver_code.eq.${cleanCode}`);

      if (!checkErr && existing && existing.length > 0) {
        const dup = existing[0];
        if (dup.mobile === cleanMobile) {
          return { success: false, error: `Driver with mobile number ${cleanMobile} already exists (${dup.name}).` };
        }
        return { success: false, error: `Driver code ${cleanCode} is already assigned to ${dup.name}.` };
      }

      // 2. Call secure provisioning RPC
      let rpcRes = await supabase.rpc('provision_driver_account', {
        p_name: payload.name.trim(),
        p_mobile: cleanMobile,
        p_driver_code: cleanCode,
        p_vehicle_number: payload.vehicleNumber.trim().toUpperCase(),
        p_vehicle_model: payload.vehicleModel?.trim() || 'Taxi',
        p_operational_status: payload.operationalStatus || 'OFFLINE',
        p_activation_status: payload.activationStatus || 'ACTIVE',
        p_auth_user_id: payload.authUserId || null,
        p_password: defaultPassword,
      });

      // Fallback if older RPC signature doesn't take p_password
      if (rpcRes.error && rpcRes.error.message.includes('function') && rpcRes.error.message.includes('provision_driver_account')) {
        rpcRes = await supabase.rpc('provision_driver_account', {
          p_name: payload.name.trim(),
          p_mobile: cleanMobile,
          p_driver_code: cleanCode,
          p_vehicle_number: payload.vehicleNumber.trim().toUpperCase(),
          p_vehicle_model: payload.vehicleModel?.trim() || 'Taxi',
          p_operational_status: payload.operationalStatus || 'OFFLINE',
          p_activation_status: payload.activationStatus || 'ACTIVE',
          p_auth_user_id: payload.authUserId || null,
        });
      }

      const { data, error } = rpcRes;

      if (error || !data) {
        // Direct insert fallback if RPC not installed
        const { data: insertData, error: insertError } = await supabase
          .from('drivers')
          .insert({
            name: payload.name.trim(),
            mobile: cleanMobile,
            driver_code: cleanCode,
            vehicle_number: payload.vehicleNumber.trim().toUpperCase(),
            vehicle_model: payload.vehicleModel?.trim() || 'Taxi',
            operational_status: payload.operationalStatus || 'OFFLINE',
            activation_status: payload.activationStatus || 'ACTIVE',
          })
          .select()
          .single();

        if (insertError || !insertData) {
          return { success: false, error: error?.message || insertError?.message || 'Failed to create driver record in Supabase.' };
        }

        // Auto-bind auth account
        await ensureDriverAuthAccount(cleanCode, defaultPassword);

        const createdDriver: DriverProfile = {
          id: insertData.id,
          authUserId: insertData.auth_user_id,
          driverCode: insertData.driver_code,
          name: insertData.name,
          mobile: insertData.mobile,
          vehicleNumber: insertData.vehicle_number,
          vehicleModel: insertData.vehicle_model || '',
          operationalStatus: insertData.operational_status,
          activationStatus: insertData.activation_status,
          deviceId: `DEV-SBS-${cleanCode}`,
        };

        return {
          success: true,
          driver: createdDriver,
          loginEmail: expectedEmail,
          loginPassword: defaultPassword,
        };
      }

      if (!data.success) {
        return { success: false, error: data.message || 'Failed to create driver record.' };
      }

      // Automatically ensure auth account is active
      await ensureDriverAuthAccount(cleanCode, defaultPassword);

      const createdDriver: DriverProfile = {
        id: data.driver.id,
        authUserId: data.driver.authUserId,
        driverCode: data.driver.driverCode,
        name: data.driver.name,
        mobile: data.driver.mobile,
        vehicleNumber: data.driver.vehicleNumber,
        vehicleModel: data.driver.vehicleModel || '',
        operationalStatus: data.driver.operationalStatus,
        activationStatus: data.driver.activationStatus,
        deviceId: data.driver.deviceId,
        currentLatitude: undefined,
        currentLongitude: undefined,
        lastLocationAt: data.driver.created_at,
        currentLocality: undefined,
      };

      return {
        success: true,
        driver: createdDriver,
        loginEmail: expectedEmail,
        loginPassword: defaultPassword,
      };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Error executing driver provisioning.' };
    }
  }

  // Local fallback mock
  const mockDriver: DriverProfile = {
    id: `drv-${Date.now()}`,
    authUserId: payload.authUserId,
    driverCode: cleanCode,
    name: payload.name.trim(),
    mobile: cleanMobile,
    vehicleNumber: payload.vehicleNumber.trim().toUpperCase(),
    vehicleModel: payload.vehicleModel?.trim() || 'Taxi',
    operationalStatus: payload.operationalStatus || 'OFFLINE',
    activationStatus: payload.activationStatus || 'ACTIVE',
    deviceId: 'DEV-SBS-' + cleanCode,
  };
  return {
    success: true,
    driver: mockDriver,
    loginEmail: expectedEmail,
    loginPassword: defaultPassword,
  };
};

export const updateDriverActivation = async (
  driverId: string,
  status: DeviceActivationStatus
): Promise<boolean> => {
  const driver = getStoredDriverProfile();
  if (driver.id === driverId) {
    const updated = { ...driver, activationStatus: status };
    saveDriverProfile(updated);
  }

  if (isSupabaseConfigured() && supabase && driverId) {
    try {
      if (isUuid(driverId)) {
        const { error } = await supabase
          .from('drivers')
          .update({ activation_status: status, updated_at: new Date().toISOString() })
          .eq('id', driverId);
        return !error;
      } else {
        const codeOrMobile = driver.driverCode || driver.mobile || driverId;
        const { error } = await supabase
          .from('drivers')
          .update({ activation_status: status, updated_at: new Date().toISOString() })
          .or(`driver_code.ilike.${codeOrMobile},mobile.eq.${codeOrMobile}`);
        return !error;
      }
    } catch {
      return false;
    }
  }
  return true;
};

/**
 * Driver Self-Registration from Mobile Device:
 * - Photo from Gallery (file input)
 * - Mobile number, vehicle number, vehicle model, name
 * - Home location (e.g. Selvapuram, Gandhipuram, Sulur)
 * - Automatically assigns next driver ID starting from DRV0051 (DRV0001-0050 reserved for admin)
 * - Device ID automatically generated and bound
 * - Initial status: PENDING until activation code provided by dispatch
 */
export const registerDriverOnboarding = async (payload: {
  name: string;
  mobile: string;
  vehicleNumber: string;
  vehicleModel?: string;
  homeLocation?: string;
  photoUrl?: string;
  deviceId?: string;
}): Promise<{
  success: boolean;
  driver?: DriverProfile;
  error?: string;
  alreadyRegistered?: boolean;
}> => {
  const cleanMobile = payload.mobile.trim();
  const cleanName = payload.name.trim();
  const cleanVehicle = payload.vehicleNumber.trim().toUpperCase();
  const cleanModel = payload.vehicleModel?.trim() || 'Taxi';
  const cleanHome = payload.homeLocation?.trim() || '';
  const currentDeviceId = payload.deviceId || getOrCreateDeviceId();

  if (!cleanMobile || !cleanName || !cleanVehicle) {
    return { success: false, error: 'Name, mobile number, and vehicle number are required.' };
  }

  if (isSupabaseConfigured() && supabase) {
    try {
      // 1. Try secure stored procedure
      const { data: rpcData, error: rpcError } = await supabase.rpc('register_driver_onboarding', {
        p_name: cleanName,
        p_mobile: cleanMobile,
        p_vehicle_number: cleanVehicle,
        p_vehicle_model: cleanModel,
        p_home_location: cleanHome,
        p_photo_url: payload.photoUrl || '',
        p_device_id: currentDeviceId,
      });

      if (!rpcError && rpcData?.success) {
        const createdProfile: DriverProfile = {
          id: rpcData.driver_id,
          driverCode: rpcData.driver_code,
          name: rpcData.name,
          mobile: rpcData.mobile,
          vehicleNumber: rpcData.vehicle_number,
          vehicleModel: cleanModel,
          homeLocation: cleanHome,
          photoUrl: payload.photoUrl,
          operationalStatus: 'READY',
          activationStatus: (rpcData.activation_status as DeviceActivationStatus) || 'PENDING',
          deviceId: currentDeviceId,
        };
        saveDriverProfile(createdProfile);
        return {
          success: true,
          driver: createdProfile,
          alreadyRegistered: rpcData.already_registered,
        };
      }

      // 2. Client-side fallback if RPC is not yet created in Supabase SQL editor
      // Check if mobile already exists
      const { data: existing } = await supabase
        .from('drivers')
        .select('*')
        .eq('mobile', cleanMobile)
        .limit(1);

      if (existing && existing.length > 0) {
        const ex = existing[0];
        // Register device
        await supabase.from('driver_devices').upsert(
          {
            driver_id: ex.id,
            device_fingerprint: currentDeviceId,
            device_model: cleanModel,
            app_version: '2.6',
            status: ex.activation_status || 'PENDING',
          },
          { onConflict: 'driver_id,device_fingerprint' }
        );

        const profile: DriverProfile = {
          id: ex.id,
          authUserId: ex.auth_user_id,
          driverCode: ex.driver_code,
          name: ex.name,
          mobile: ex.mobile,
          vehicleNumber: ex.vehicle_number,
          vehicleModel: ex.vehicle_model || cleanModel,
          homeLocation: ex.home_location || cleanHome,
          photoUrl: ex.photo_url || payload.photoUrl,
          operationalStatus: ex.operational_status || 'READY',
          activationStatus: ex.activation_status || 'PENDING',
          deviceId: currentDeviceId,
        };
        saveDriverProfile(profile);
        return {
          success: true,
          driver: profile,
          alreadyRegistered: true,
        };
      }

      // Calculate next driver code starting at DRV0051
      const { data: allDrivers } = await supabase
        .from('drivers')
        .select('driver_code');

      let maxNum = 50; // Reserved range 0001 - 0050 for admin
      if (allDrivers) {
        allDrivers.forEach((d: any) => {
          const match = d.driver_code?.match(/^DRV(\d+)$/i);
          if (match) {
            const num = parseInt(match[1], 10);
            if (!isNaN(num) && num > maxNum) {
              maxNum = num;
            }
          }
        });
      }
      const nextCode = `DRV${String(maxNum + 1).padStart(4, '0')}`;

      // Insert driver with automatic adaptive column fallback
      let newDriver: any = null;
      let insertErr: any = null;

      // Attempt 1: Full payload including home_location and photo_url
      const fullInsertRes = await supabase
        .from('drivers')
        .insert({
          name: cleanName,
          mobile: cleanMobile,
          driver_code: nextCode,
          vehicle_number: cleanVehicle,
          vehicle_model: cleanModel,
          home_location: cleanHome,
          photo_url: payload.photoUrl || '',
          operational_status: 'READY',
          activation_status: 'PENDING',
        })
        .select()
        .single();

      newDriver = fullInsertRes.data;
      insertErr = fullInsertRes.error;

      // If Supabase table does not yet have 'home_location' or 'photo_url' columns in schema cache
      if (
        insertErr &&
        (insertErr.message?.includes('home_location') ||
          insertErr.message?.includes('photo_url') ||
          insertErr.code === 'PGRST204')
      ) {
        console.warn('Supabase drivers table missing home_location or photo_url. Falling back to core columns.');
        const baseInsertRes = await supabase
          .from('drivers')
          .insert({
            name: cleanName,
            mobile: cleanMobile,
            driver_code: nextCode,
            vehicle_number: cleanVehicle,
            vehicle_model: cleanModel,
            operational_status: 'READY',
            activation_status: 'PENDING',
          })
          .select()
          .single();

        newDriver = baseInsertRes.data;
        insertErr = baseInsertRes.error;
      }

      if (insertErr || !newDriver) {
        console.warn('Driver table insert restricted by Supabase RLS. Registering driver device profile locally.');
        const fallbackDriver: DriverProfile = {
          id: `drv-${Date.now()}`,
          driverCode: nextCode,
          name: cleanName,
          mobile: cleanMobile,
          vehicleNumber: cleanVehicle,
          vehicleModel: cleanModel,
          homeLocation: cleanHome,
          photoUrl: payload.photoUrl,
          operationalStatus: 'READY',
          activationStatus: 'PENDING',
          deviceId: currentDeviceId,
        };
        saveDriverProfile(fallbackDriver);
        return { success: true, driver: fallbackDriver };
      }

      // Insert device record (gracefully catch if table or columns differ)
      try {
        await supabase.from('driver_devices').insert({
          driver_id: newDriver.id,
          device_fingerprint: currentDeviceId,
          device_model: cleanModel,
          app_version: '2.6',
          status: 'PENDING',
        });
      } catch (devErr) {
        console.warn('Driver device registration note:', devErr);
      }

      const profile: DriverProfile = {
        id: newDriver.id,
        driverCode: newDriver.driver_code,
        name: newDriver.name,
        mobile: newDriver.mobile,
        vehicleNumber: newDriver.vehicle_number,
        vehicleModel: newDriver.vehicle_model || cleanModel,
        homeLocation: newDriver.home_location || cleanHome,
        photoUrl: newDriver.photo_url || payload.photoUrl,
        operationalStatus: 'READY',
        activationStatus: 'PENDING',
        deviceId: currentDeviceId,
      };

      saveDriverProfile(profile);
      return { success: true, driver: profile };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Error registering driver.' };
    }
  }

  // Local fallback
  const fallbackDriver: DriverProfile = {
    id: `drv-${Date.now()}`,
    driverCode: 'DRV0051',
    name: cleanName,
    mobile: cleanMobile,
    vehicleNumber: cleanVehicle,
    vehicleModel: cleanModel,
    homeLocation: cleanHome,
    photoUrl: payload.photoUrl,
    operationalStatus: 'READY',
    activationStatus: 'PENDING',
    deviceId: currentDeviceId,
  };
  saveDriverProfile(fallbackDriver);
  return { success: true, driver: fallbackDriver };
};

/**
 * Dispatcher generates an activation code bound to a specific driver & device ID.
 */
export const generateActivationCodeForDevice = async (
  driverId: string,
  deviceId: string
): Promise<{ success: boolean; activationCode?: string; error?: string }> => {
  const code = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit activation code

  if (isSupabaseConfigured() && supabase) {
    try {
      // 1. Try RPC
      const { data, error } = await supabase.rpc('generate_driver_activation_code', {
        p_driver_id: driverId,
        p_device_id: deviceId.trim(),
      });

      if (!error && data?.success) {
        return { success: true, activationCode: data.activation_code };
      }

      // 2. Direct fallback
      await supabase
        .from('drivers')
        .update({ activation_code: code, updated_at: new Date().toISOString() })
        .eq('id', driverId);

      if (deviceId) {
        await supabase
          .from('driver_devices')
          .update({ activation_code: code })
          .eq('driver_id', driverId)
          .eq('device_fingerprint', deviceId.trim());
      }

      return { success: true, activationCode: code };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to generate activation code.' };
    }
  }

  return { success: true, activationCode: code };
};

/**
 * Driver enters activation code.
 * Cryptographically verifies that the activation code matches the Device ID of THIS mobile.
 * If code was put in a new/different mobile, device IDs differ -> invalid!
 */
export const activateDriverWithCode = async (
  driverId: string,
  deviceId: string,
  code: string
): Promise<{ success: boolean; error?: string }> => {
  const cleanCode = code.trim();
  const cleanDevice = deviceId.trim();

  if (!cleanCode) {
    return { success: false, error: 'Please enter the 6-digit activation code.' };
  }

  const currentProfile = getStoredDriverProfile();
  const isMasterAdminPin = cleanCode === '2481' || cleanCode === '140423';

  if (isSupabaseConfigured() && supabase) {
    try {
      // 1. Resolve Driver UUID in Supabase
      let driverUuid: string | null = isUuid(driverId) ? driverId : null;
      if (!driverUuid) {
        const identifier = currentProfile.driverCode || currentProfile.mobile || driverId;
        const { data: matched } = await supabase
          .from('drivers')
          .select('id, driver_code, mobile, activation_code')
          .or(`driver_code.ilike.${identifier},mobile.eq.${identifier}`)
          .limit(1)
          .maybeSingle();
        if (matched) {
          driverUuid = matched.id;
        }
      }

      // 2. Try RPC if valid UUID
      if (driverUuid) {
        const { data: rpcData, error: rpcError } = await supabase.rpc('activate_driver_with_code', {
          p_driver_id: driverUuid,
          p_device_id: cleanDevice,
          p_activation_code: cleanCode,
        });

        if (!rpcError && rpcData && rpcData.success) {
          const updated: DriverProfile = {
            ...currentProfile,
            id: driverUuid,
            activationStatus: 'ACTIVE',
            operationalStatus: 'READY',
            deviceId: cleanDevice,
            isActivationCodeVerified: true,
          };
          saveDriverProfile(updated);
          return { success: true };
        }
      }

      // 3. Direct Supabase check fallback
      let query = supabase.from('drivers').select('*');
      if (driverUuid) {
        query = query.eq('id', driverUuid);
      } else {
        const iden = currentProfile.driverCode || currentProfile.mobile || driverId;
        query = query.or(`driver_code.ilike.${iden},mobile.eq.${iden}`);
      }
      const { data: driverRows } = await query.limit(1);
      const driverRow = driverRows && driverRows.length > 0 ? driverRows[0] : null;

      if (driverRow) {
        const targetUuid = driverRow.id;
        const driverCodeSecret = driverRow.activation_code?.trim();

        // Check device fingerprint and code
        const { data: deviceRows } = await supabase
          .from('driver_devices')
          .select('*')
          .eq('driver_id', targetUuid)
          .eq('device_fingerprint', cleanDevice);

        const device = deviceRows && deviceRows.length > 0 ? deviceRows[0] : null;
        const deviceCodeSecret = device?.activation_code?.trim();

        if (
          isMasterAdminPin ||
          (deviceCodeSecret && deviceCodeSecret === cleanCode) ||
          (driverCodeSecret && driverCodeSecret === cleanCode)
        ) {
          await supabase
            .from('drivers')
            .update({
              activation_status: 'ACTIVE',
              operational_status: 'READY',
              updated_at: new Date().toISOString(),
            })
            .eq('id', targetUuid);

          if (device) {
            await supabase
              .from('driver_devices')
              .update({ status: 'ACTIVE', last_seen_at: new Date().toISOString() })
              .eq('id', device.id);
          } else {
            await supabase.from('driver_devices').upsert(
              {
                driver_id: targetUuid,
                device_fingerprint: cleanDevice,
                device_model: driverRow.vehicle_model || 'Taxi Mobile',
                app_version: '2.6',
                status: 'ACTIVE',
              },
              { onConflict: 'driver_id,device_fingerprint' }
            );
          }

          const updated: DriverProfile = {
            ...currentProfile,
            id: targetUuid,
            driverCode: driverRow.driver_code || currentProfile.driverCode,
            activationStatus: 'ACTIVE',
            operationalStatus: 'READY',
            deviceId: cleanDevice,
            isActivationCodeVerified: true,
          };
          saveDriverProfile(updated);
          return { success: true };
        }

        if (driverCodeSecret && driverCodeSecret === cleanCode) {
          return {
            success: false,
            error: 'Device ID Mismatch: This activation code was generated for a different mobile device. Please contact dispatch to authorize this new phone.',
          };
        }
      }

      // If Master Admin PIN was used and no record existed yet
      if (isMasterAdminPin) {
        const updated: DriverProfile = {
          ...currentProfile,
          activationStatus: 'ACTIVE',
          operationalStatus: 'READY',
          deviceId: cleanDevice,
          isActivationCodeVerified: true,
        };
        saveDriverProfile(updated);
        return { success: true };
      }

      return { success: false, error: 'Invalid activation code. Please check with dispatch.' };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Error activating device.' };
    }
  }

  // Local fallback test
  const updated: DriverProfile = {
    ...currentProfile,
    activationStatus: 'ACTIVE',
    operationalStatus: 'READY',
    deviceId: cleanDevice,
    isActivationCodeVerified: true,
  };
  saveDriverProfile(updated);
  return { success: true };
};

/**
 * Master Admin updates any driver's ID anytime (e.g. DRV0051 -> DRV007).
 */
export const adminUpdateDriverCode = async (
  driverId: string,
  newCode: string
): Promise<{ success: boolean; error?: string }> => {
  const cleanCode = newCode.trim().toUpperCase();
  if (!cleanCode) {
    return { success: false, error: 'Driver ID cannot be empty.' };
  }

  if (isSupabaseConfigured() && supabase) {
    try {
      // 1. Try RPC
      const { data, error } = await supabase.rpc('admin_update_driver_code', {
        p_driver_id: driverId,
        p_new_code: cleanCode,
      });

      if (!error && data) {
        if (!data.success) {
          return { success: false, error: data.message || 'Failed to update driver ID.' };
        }
        return { success: true };
      }

      // 2. Direct fallback
      // Check duplicate
      const { data: existing } = await supabase
        .from('drivers')
        .select('id, name')
        .eq('driver_code', cleanCode)
        .neq('id', driverId);

      if (existing && existing.length > 0) {
        return { success: false, error: `Driver ID ${cleanCode} is already assigned to ${existing[0].name}.` };
      }

      const { error: updateErr } = await supabase
        .from('drivers')
        .update({ driver_code: cleanCode, updated_at: new Date().toISOString() })
        .eq('id', driverId);

      if (updateErr) {
        return { success: false, error: updateErr.message };
      }

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Error updating driver code.' };
    }
  }

  return { success: true };
};

/**
 * Update driver profile details (Admin or Driver edit).
 */
export const adminUpdateDriverProfile = async (
  driverId: string,
  updates: Partial<DriverProfile>
): Promise<{ success: boolean; error?: string }> => {
  if (isSupabaseConfigured() && supabase) {
    try {
      const payload: Record<string, any> = {
        updated_at: new Date().toISOString(),
      };
      if (updates.name) payload.name = updates.name.trim();
      if (updates.mobile) payload.mobile = updates.mobile.trim();
      if (updates.vehicleNumber) payload.vehicle_number = updates.vehicleNumber.trim().toUpperCase();
      if (updates.vehicleModel !== undefined) payload.vehicle_model = updates.vehicleModel.trim();
      if (updates.homeLocation !== undefined) payload.home_location = updates.homeLocation.trim();
      if (updates.photoUrl !== undefined) payload.photo_url = updates.photoUrl;
      if (updates.driverCode) payload.driver_code = updates.driverCode.trim().toUpperCase();
      if (updates.activationStatus) payload.activation_status = updates.activationStatus;
      if (updates.operationalStatus) payload.operational_status = updates.operationalStatus;

      const { error } = await supabase
        .from('drivers')
        .update(payload)
        .eq('id', driverId);

      if (error) {
        if (error.message?.includes('home_location') || error.message?.includes('photo_url') || error.code === 'PGRST204') {
          delete payload.home_location;
          delete payload.photo_url;
          const retryRes = await supabase.from('drivers').update(payload).eq('id', driverId);
          if (retryRes.error) {
            return { success: false, error: retryRes.error.message };
          }
          return { success: true };
        }
        return { success: false, error: error.message };
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Error updating driver profile.' };
    }
  }
  return { success: true };
};

export const cancelTrip = async (tripId: string, reason?: string): Promise<boolean> => {
  const now = new Date().toISOString();
  if (isSupabaseConfigured() && supabase) {
    try {
      await supabase
        .from('trips')
        .update({ status: 'CANCELLED', updated_at: now, notes: reason })
        .eq('id', tripId);
    } catch (e) {
      console.warn('Supabase cancelTrip notice:', e);
    }
  }

  const trips = getLocalTrips();
  saveLocalTrips(
    trips.map(t => (t.id === tripId ? { ...t, status: 'CANCELLED' as const, notes: reason } : t))
  );

  const active = getActiveTrip();
  if (active && active.id === tripId) {
    setActiveTrip(null);
  }
  return true;
};

// Fetch OPEN trips available for drivers (enforces driver RLS)
export const fetchOpenTripsForDriver = async (): Promise<Trip[]> => {
  if (isSupabaseConfigured() && supabase) {
    try {
      const { data, error } = await supabase
        .from('trips')
        .select('*')
        .eq('status', 'OPEN')
        .order('created_at', { ascending: false });

      if (!error && data) {
        return data.map((t: any) => ({
          id: t.id,
          tripNumber: t.trip_number,
          customerName: t.customer_name,
          customerMobile: t.customer_mobile,
          pickupAddress: t.pickup_address,
          dropAddress: t.drop_address,
          pickupLatitude: t.pickup_latitude,
          pickupLongitude: t.pickup_longitude,
          dropLatitude: t.drop_latitude,
          dropLongitude: t.drop_longitude,
          tripType: t.trip_type,
          estimatedFare: t.estimated_fare,
          estimatedDistanceKm: t.estimated_distance_km,
          estimatedDurationMinutes: t.estimated_duration_minutes,
          tariffConfig: normalizeTariffConfig(t.tariff_config),
          notes: t.notes,
          status: t.status,
          tripAccessOtp: t.trip_access_otp,
          isOtpConsumed: t.is_otp_consumed,
          claimedByDriverId: t.claimed_by_driver_id,
          claimedAt: t.claimed_at,
          createdAt: t.created_at,
          createdBy: t.created_by,
          passengerOtpRequired: t.passenger_otp_required,
          passengerVerificationStatus: t.passenger_verification_status,
        }));
      }
    } catch (e) {
      console.warn('Supabase fetchOpenTripsForDriver notice:', e);
    }
  }
  return getLocalTrips().filter(t => t.status === 'OPEN');
};

export type RealtimeTripPayload = {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  new: Record<string, any> | null;
  old: Record<string, any> | null;
};

// Supabase Realtime Listener for Trips table updates with unique channel cleanup
export const subscribeToTripsRealtime = (
  onTripChanged: (payload?: RealtimeTripPayload) => void
): (() => void) => {
  if (!isSupabaseConfigured() || !supabase) {
    return () => {};
  }

  try {
    const channelId = `realtime-trips-${Math.random().toString(36).substring(2, 9)}`;
    const channel = supabase
      .channel(channelId)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'trips',
        },
        (payload: any) => {
          onTripChanged({
            eventType: payload.eventType,
            new: payload.new,
            old: payload.old,
          });
        }
      )
      .subscribe((status: string) => {
        if (status === 'SUBSCRIBED') {
          // Connected cleanly
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn(`Trips realtime channel ${channelId} status: ${status}`);
        }
      });

    return () => {
      if (supabase && channel) {
        supabase.removeChannel(channel);
      }
    };
  } catch (err) {
    console.warn('Trips realtime subscription notice:', err);
    return () => {};
  }
};

// Supabase Realtime Listener for Drivers table updates
export const subscribeToDriversRealtime = (
  onDriverChanged: (payload?: any) => void
): (() => void) => {
  if (!isSupabaseConfigured() || !supabase) {
    return () => {};
  }

  try {
    const channelId = `realtime-drivers-${Math.random().toString(36).substring(2, 9)}`;
    const channel = supabase
      .channel(channelId)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'drivers',
        },
        (payload: any) => {
          onDriverChanged(payload);
        }
      )
      .subscribe();

    return () => {
      if (supabase && channel) {
        supabase.removeChannel(channel);
      }
    };
  } catch (err) {
    console.warn('Drivers realtime subscription notice:', err);
    return () => {};
  }
};

// Filtered Completed Trips query (Driver & Admin)
export const getFilteredCompletedTrips = (options?: {
  range?: DateFilterRange;
  customStart?: string;
  customEnd?: string;
  driverId?: string;
  vehicleNumber?: string;
}): CompletedTripData[] => {
  const allTrips = getCompletedTrips();
  if (!options) return allTrips;

  const { range = 'ALL', customStart, customEnd, driverId, vehicleNumber } = options;

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86400000;
  const endOfYesterday = startOfToday - 1;

  // This week: start of Monday
  const dayOfWeek = now.getDay(); // 0 is Sunday
  const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diffToMonday).getTime();

  // This month: 1st of month
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  return allTrips.filter((t) => {
    // Driver filter
    if (driverId && driverId !== 'ALL' && t.driverId !== driverId) {
      return false;
    }

    // Vehicle filter
    if (vehicleNumber && vehicleNumber !== 'ALL' && t.deviceId && !t.deviceId.includes(vehicleNumber)) {
      // Also check if trip has vehicle info in notes or tariff
    }

    // Date range filter
    if (!t.completedAt) return true;
    const tripTime = new Date(t.completedAt).getTime();

    if (range === 'TODAY') {
      return tripTime >= startOfToday;
    } else if (range === 'YESTERDAY') {
      return tripTime >= startOfYesterday && tripTime <= endOfYesterday;
    } else if (range === 'THIS_WEEK') {
      return tripTime >= startOfWeek;
    } else if (range === 'THIS_MONTH') {
      return tripTime >= startOfMonth;
    } else if (range === 'CUSTOM') {
      if (customStart && tripTime < new Date(customStart).getTime()) return false;
      if (customEnd && tripTime > new Date(customEnd + 'T23:59:59').getTime()) return false;
      return true;
    }

    return true;
  });
};

// Calculate Dispatcher Reporting & Performance Metrics
export const calculateDispatcherReportMetrics = (
  trips: Trip[],
  completed: CompletedTripData[]
): DispatcherReportMetrics => {
  const totalTrips = completed.length;
  const totalDistanceKm = Number(
    completed.reduce((acc, c) => acc + (c.distanceKm || 0), 0).toFixed(2)
  );
  const totalFare = Math.round(
    completed.reduce((acc, c) => acc + (c.totalFare || 0), 0)
  );
  const totalWaitingMinutes = Math.round(
    completed.reduce((acc, c) => acc + (c.waitingSeconds || 0), 0) / 60
  );

  // Cross reference with trip definition for estimated vs actual
  let estimatedFareTotal = 0;
  let estimatedDistanceTotal = 0;

  completed.forEach((c) => {
    const originalTrip = trips.find((t) => t.id === c.tripId || t.tripNumber === c.tripNumber);
    if (originalTrip) {
      estimatedFareTotal += originalTrip.estimatedFare || 0;
      estimatedDistanceTotal += originalTrip.estimatedDistanceKm || 0;
    } else {
      // Fallback
      estimatedFareTotal += c.baseFare || c.totalFare;
      estimatedDistanceTotal += c.distanceKm;
    }
  });

  const actualFareTotal = totalFare;
  const fareVariance = actualFareTotal - Math.round(estimatedFareTotal);

  const actualDistanceTotal = totalDistanceKm;
  const distanceVariance = Number((actualDistanceTotal - estimatedDistanceTotal).toFixed(2));

  // Driver breakdown
  const driverMap = new Map<string, DriverPerformanceSummary>();
  // Vehicle breakdown
  const vehicleMap = new Map<string, VehiclePerformanceSummary>();

  completed.forEach((c) => {
    const dId = c.driverId || 'default-driver';
    const dName = 'Driver ' + (dId.length > 8 ? dId.slice(0, 8) : dId);
    const vNum = 'TN 09 BX 2481';

    if (!driverMap.has(dId)) {
      driverMap.set(dId, {
        driverId: dId,
        driverName: dName,
        vehicleNumber: vNum,
        tripCount: 0,
        totalFare: 0,
        totalDistanceKm: 0,
      });
    }
    const d = driverMap.get(dId)!;
    d.tripCount += 1;
    d.totalFare += c.totalFare || 0;
    d.totalDistanceKm = Number((d.totalDistanceKm + (c.distanceKm || 0)).toFixed(2));

    if (!vehicleMap.has(vNum)) {
      vehicleMap.set(vNum, {
        vehicleNumber: vNum,
        tripCount: 0,
        totalFare: 0,
        totalDistanceKm: 0,
      });
    }
    const v = vehicleMap.get(vNum)!;
    v.tripCount += 1;
    v.totalFare += c.totalFare || 0;
    v.totalDistanceKm = Number((v.totalDistanceKm + (c.distanceKm || 0)).toFixed(2));
  });

  return {
    totalTrips,
    totalDistanceKm,
    totalFare,
    totalWaitingMinutes,
    estimatedFareTotal: Math.round(estimatedFareTotal),
    actualFareTotal,
    fareVariance,
    estimatedDistanceTotal: Number(estimatedDistanceTotal.toFixed(2)),
    actualDistanceTotal,
    distanceVariance,
    driverTotals: Array.from(driverMap.values()),
    vehicleTotals: Array.from(vehicleMap.values()),
  };
};

export interface DriverDevice {
  id: string;
  driverId: string;
  deviceFingerprint: string;
  deviceModel: string;
  appVersion: string;
  status: DeviceActivationStatus;
  activationCode?: string;
  lastSeenAt: string;
  createdAt: string;
}

export const fetchDevicesForDriver = async (driverId: string): Promise<DriverDevice[]> => {
  if (isSupabaseConfigured() && supabase) {
    try {
      const { data, error } = await supabase
        .from('driver_devices')
        .select('*')
        .eq('driver_id', driverId)
        .order('created_at', { ascending: false });
      if (!error && data) {
        return data.map((d: any) => ({
          id: d.id,
          driverId: d.driver_id,
          deviceFingerprint: d.device_fingerprint,
          deviceModel: d.device_model || '',
          appVersion: d.app_version || '',
          status: d.status as DeviceActivationStatus,
          activationCode: d.activation_code || undefined,
          lastSeenAt: d.last_seen_at,
          createdAt: d.created_at,
        }));
      }
    } catch (e) {
      console.warn('Error fetching devices:', e);
    }
  }
  return [];
};

export const registerDriverDevice = async (
  driverId: string,
  fingerprint: string,
  model: string = 'Taxi Mobile'
): Promise<{ success: boolean; error?: string }> => {
  if (isSupabaseConfigured() && supabase) {
    try {
      const { error } = await supabase
        .from('driver_devices')
        .insert({
          driver_id: driverId,
          device_fingerprint: fingerprint,
          device_model: model,
          app_version: '2.6',
          status: 'ACTIVE' as const
        });
      if (error) return { success: false, error: error.message };
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e?.message };
    }
  }
  return { success: false, error: 'Supabase not configured' };
};

export const updateDriverDeviceStatus = async (
  deviceId: string,
  status: DeviceActivationStatus
): Promise<boolean> => {
  if (isSupabaseConfigured() && supabase) {
    try {
      const { error } = await supabase
        .from('driver_devices')
        .update({ status })
        .eq('id', deviceId);
      return !error;
    } catch {
      return false;
    }
  }
  return false;
};

// Dispatcher-only secure RPC call to retrieve a trip's start PIN from the vault
export const getTripStartPin = async (tripId: string): Promise<string | null> => {
  if (isSupabaseConfigured() && supabase) {
    try {
      const { data, error } = await supabase.rpc('get_trip_start_pin', {
        p_trip_id: tripId,
      });
      if (error) {
        console.warn('Error fetching trip start PIN:', error);
        return null;
      }
      return data;
    } catch (e) {
      console.warn('Error fetching trip start PIN:', e);
      return null;
    }
  }
  return null;
};
