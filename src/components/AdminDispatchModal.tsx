import React, { useState, useEffect, useRef } from 'react';
import {
  Trip,
  TripType,
  DriverProfile,
  DeviceActivationStatus,
  TariffConfig,
  DateFilterRange,
  DriverOperationalStatus,
} from '../types';
import {
  getLocalTrips,
  createOpenTrip,
  getTripStartPin,
  saveDriverProfile,
  getFilteredCompletedTrips,
  fetchCompletedTripsFromServer,
  calculateDispatcherReportMetrics,
  subscribeToTripsRealtime,
  subscribeToDriversRealtime,
  updateDriverOperationalStatus,
  fetchDriversForDispatch,
  createDriverAccount,
  bindDriverAuthAccount,
  updateDriverActivation,
  fetchDevicesForDriver,
  registerDriverDevice,
  updateDriverDeviceStatus,
  generateActivationCodeForDevice,
  adminUpdateDriverCode,
  adminUpdateDriverProfile,
} from '../services/tripService';
import { calculateHaversineKm } from '../services/gpsFilter';
import { SBS_TRAVELS_SQL_SCHEMA, SBS_DRIVER_AUTH_FIX_SQL } from '../services/schemaSql';
import { createDefaultTariffConfig, calculateCustomTripFare } from '../services/tariffService';
import {
  fetchPlacePredictions,
  fetchPlaceDetails,
  calculateDrivingRoute,
  createPlacesSessionToken,
  PlaceSuggestion,
} from '../services/googleMapsService';
import {
  PlusCircle,
  Key,
  Copy,
  Check,
  Share2,
  Shield,
  AlertTriangle,
  Car,
  User,
  MapPin,
  Database,
  Download,
  Calculator,
  Navigation,
  Clock,
  Sparkles,
  Search,
  BarChart3,
  Users,
  Activity,
  Calendar,
  RefreshCw,
  SlidersHorizontal,
  ChevronDown,
  CheckCircle2,
  LogOut,
  Lock,
  Phone,
  Compass,
  MessageSquare,
  UserPlus,
} from 'lucide-react';
import {
  openWhatsApp,
  generateDriverDispatchMessage,
  generateCustomerBookingMessage,
} from '../services/whatsappService';
import { AdminUserProfile } from '../types';
import {
  signInDispatcher,
  signOutDispatcher,
  verifyDispatcherSession,
  onDispatcherAuthStateChange,
} from '../services/authService';
import { fetchTripsForDispatch } from '../services/tripService';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  driver: DriverProfile;
  onDriverUpdated: (driver: DriverProfile) => void;
  onTripCreated: (trip: Trip) => void;
}

export const AdminDispatchModal: React.FC<Props> = ({
  isOpen,
  onClose,
  driver,
  onDriverUpdated,
  onTripCreated,
}) => {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [activeTab, setActiveTab] = useState<'create' | 'list' | 'drivers' | 'reports' | 'devices' | 'sql'>('create');
  const [tripStatusFilter, setTripStatusFilter] = useState<'ALL' | 'OPEN' | 'CLAIMED' | 'ARRIVED' | 'STARTED' | 'COMPLETED' | 'CANCELLED'>('ALL');
  const [dateFilter, setDateFilter] = useState<DateFilterRange>('TODAY');
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');
  const [filterDriverId, setFilterDriverId] = useState<string>('ALL');
  const [filterVehicle, setFilterVehicle] = useState<string>('ALL');
  const [copiedOtp, setCopiedOtp] = useState<string | null>(null);
  const [copiedSql, setCopiedSql] = useState<boolean>(false);

  // States for secure Start PIN retrieval
  const [revealedPins, setRevealedPins] = useState<Record<string, string>>({});
  const [loadingPins, setLoadingPins] = useState<Record<string, boolean>>({});

  // New Trip form state
  const [customerName, setCustomerName] = useState('');
  const [customerMobile, setCustomerMobile] = useState('');
  const [pickupAddress, setPickupAddress] = useState('');
  const [pickupPlaceId, setPickupPlaceId] = useState<string | undefined>();
  const [pickupLat, setPickupLat] = useState<number | undefined>();
  const [pickupLng, setPickupLng] = useState<number | undefined>();

  const [dropAddress, setDropAddress] = useState('');
  const [dropPlaceId, setDropPlaceId] = useState<string | undefined>();
  const [dropLat, setDropLat] = useState<number | undefined>();
  const [dropLng, setDropLng] = useState<number | undefined>();

  const [tripType, setTripType] = useState<string>('ONE_WAY');
  const [notes, setNotes] = useState('');
  const [createdTrip, setCreatedTrip] = useState<Trip | null>(null);
  const [createdStartPin, setCreatedStartPin] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Dispatcher Authentication State (Phase 2.2A)
  const [adminProfile, setAdminProfile] = useState<AdminUserProfile | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(true);
  const [loginEmail, setLoginEmail] = useState<string>('');
  const [loginPassword, setLoginPassword] = useState<string>('');
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Credential 4: Passenger Verification OTP
  const [passengerOtpRequired, setPassengerOtpRequired] = useState(false);
  const [passengerOtp, setPassengerOtp] = useState(() => Math.floor(1000 + Math.random() * 9000).toString());

  // Driving Route Estimation via Google Routes API
  const [routeDistanceKm, setRouteDistanceKm] = useState<number>(25);
  const [routeDurationMin, setRouteDurationMin] = useState<number>(45);
  const [isCalculatingRoute, setIsCalculatingRoute] = useState<boolean>(false);

  // Custom Per-Trip Tariff Configuration
  const [tariff, setTariff] = useState<TariffConfig>(createDefaultTariffConfig('ONE_WAY'));

  // Autocomplete state
  const [pickupSuggestions, setPickupSuggestions] = useState<PlaceSuggestion[]>([]);
  const [dropSuggestions, setDropSuggestions] = useState<PlaceSuggestion[]>([]);
  const [isSearchingPickup, setIsSearchingPickup] = useState(false);
  const [isSearchingDrop, setIsSearchingDrop] = useState(false);
  const [showPickupDropdown, setShowPickupDropdown] = useState(false);
  const [showDropDropdown, setShowDropDropdown] = useState(false);

  // Fleet Driver Monitoring State (Phase 2.3.2)
  const [fleetDrivers, setFleetDrivers] = useState<DriverProfile[]>([]);
  const [driverSearchQuery, setDriverSearchQuery] = useState<string>('');
  const [driverStatusFilter, setDriverStatusFilter] = useState<string>('ALL');
  const [selectedPickupTripId, setSelectedPickupTripId] = useState<string>('AUTO');

  // Driver Provisioning State (Phase 2.3.4)
  const [showProvisionModal, setShowProvisionModal] = useState<boolean>(false);
  const [newDriverName, setNewDriverName] = useState<string>('');
  const [newDriverMobile, setNewDriverMobile] = useState<string>('');
  const [newDriverCode, setNewDriverCode] = useState<string>('');
  const [newDriverVehNo, setNewDriverVehNo] = useState<string>('');
  const [newDriverVehModel, setNewDriverVehModel] = useState<string>('Sedan');
  const [isProvisioning, setIsProvisioning] = useState<boolean>(false);
  const [provisionError, setProvisionError] = useState<string | null>(null);
  const [provisionSuccess, setProvisionSuccess] = useState<string | null>(null);

  // Tab 5: Device security states
  const [selectedDriverId, setSelectedDriverId] = useState<string>(driver.id);
  const [driverDevicesList, setDriverDevicesList] = useState<any[]>([]);
  const [newFingerprint, setNewFingerprint] = useState<string>('');
  const [newDeviceModel, setNewDeviceModel] = useState<string>('');
  const [isRegisteringDevice, setIsRegisteringDevice] = useState<boolean>(false);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [deviceSuccess, setDeviceSuccess] = useState<string | null>(null);
  const [isBindingDriverCode, setIsBindingDriverCode] = useState<string | null>(null);
  const [copiedFixSql, setCopiedFixSql] = useState<boolean>(false);

  // Phase 2.4: Device ID & Activation Code States
  const [editingDriverCodeId, setEditingDriverCodeId] = useState<string | null>(null);
  const [tempDriverCodeValue, setTempDriverCodeValue] = useState<string>('');
  const [generatedActivationCodes, setGeneratedActivationCodes] = useState<Record<string, string>>({});
  const [isGeneratingCode, setIsGeneratingCode] = useState<Record<string, boolean>>({});
  const [copiedCodeNotice, setCopiedCodeNotice] = useState<string | null>(null);

  const handleGenerateActivationCode = async (dId: string, devId: string) => {
    setIsGeneratingCode((prev) => ({ ...prev, [dId]: true }));
    try {
      const res = await generateActivationCodeForDevice(dId, devId);
      if (res.success && res.activationCode) {
        setGeneratedActivationCodes((prev) => ({ ...prev, [dId]: res.activationCode! }));
        const updatedList = await fetchDriversForDispatch();
        if (updatedList) setFleetDrivers(updatedList);
      } else {
        alert(res.error || 'Failed to generate activation code.');
      }
    } catch (e: any) {
      alert(e?.message || 'Error generating activation code.');
    } finally {
      setIsGeneratingCode((prev) => ({ ...prev, [dId]: false }));
    }
  };

  const handleSaveDriverCode = async (driverId: string) => {
    if (!tempDriverCodeValue.trim()) return;
    try {
      const res = await adminUpdateDriverCode(driverId, tempDriverCodeValue.trim());
      if (res.success) {
        setEditingDriverCodeId(null);
        setTempDriverCodeValue('');
        const updatedList = await fetchDriversForDispatch();
        if (updatedList) setFleetDrivers(updatedList);
      } else {
        alert(res.error || 'Failed to update Driver ID.');
      }
    } catch (e: any) {
      alert(e?.message || 'Error updating Driver ID.');
    }
  };

  useEffect(() => {
    if (activeTab === 'devices' && selectedDriverId) {
      setDeviceError(null);
      setDeviceSuccess(null);
      fetchDevicesForDriver(selectedDriverId).then(setDriverDevicesList);
    }
  }, [activeTab, selectedDriverId]);

  const handleBindDriverAuth = async (driverCode: string) => {
    setIsBindingDriverCode(driverCode);
    setProvisionError(null);
    setProvisionSuccess(null);
    try {
      const res = await bindDriverAuthAccount(driverCode, 'SbsTravels@2026!');
      if (res.success) {
        setProvisionSuccess(
          `Driver ${driverCode} successfully linked! Login: ${res.email || `${driverCode.toLowerCase()}@sbstravels.com`} | Password: SbsTravels@2026!`
        );
        const updatedList = await fetchDriversForDispatch();
        if (updatedList) setFleetDrivers(updatedList);
      } else {
        setProvisionError(res.error || `Failed to bind auth for ${driverCode}.`);
      }
    } catch (err: any) {
      setProvisionError(err?.message || `Error binding auth for ${driverCode}.`);
    } finally {
      setIsBindingDriverCode(null);
    }
  };

  const handleProvisionDriverSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setProvisionError(null);
    setProvisionSuccess(null);
    setIsProvisioning(true);

    const res = await createDriverAccount({
      name: newDriverName,
      mobile: newDriverMobile,
      driverCode: newDriverCode,
      vehicleNumber: newDriverVehNo,
      vehicleModel: newDriverVehModel,
      operationalStatus: 'OFFLINE',
      activationStatus: 'ACTIVE',
    });

    setIsProvisioning(false);
    if (!res.success) {
      setProvisionError(res.error || 'Failed to provision driver account.');
    } else {
      const loginEmail = res.loginEmail || `${res.driver?.driverCode.toLowerCase()}@sbstravels.com`;
      const loginPassword = res.loginPassword || 'SbsTravels@2026!';
      setProvisionSuccess(
        `Driver ${res.driver?.name} (${res.driver?.driverCode}) provisioned & linked successfully! Login: ${loginEmail} | Password: ${loginPassword}`
      );
      setNewDriverName('');
      setNewDriverMobile('');
      setNewDriverCode('');
      setNewDriverVehNo('');
      setNewDriverVehModel('Sedan');
      fetchDriversForDispatch().then((list) => {
        if (list) setFleetDrivers(list);
      });
    }
  };

  const placesSessionToken = useRef<string>(createPlacesSessionToken());
  const debounceTimer = useRef<any>(null);

  // Authoritative Session Verification & Supabase Realtime Subscription
  useEffect(() => {
    let unsubTrips: (() => void) | null = null;
    let unsubDrivers: (() => void) | null = null;

    if (isOpen) {
      setAuthLoading(true);
      verifyDispatcherSession().then(({ session, profile }) => {
        setAuthLoading(false);
        if (profile && session) {
          setAdminProfile(profile);
          // Initial trips load
          setTrips(getLocalTrips());
          fetchTripsForDispatch().then((serverTrips) => {
            if (serverTrips && serverTrips.length > 0) {
              setTrips(serverTrips);
            }
          });

          // Initial drivers load
          const loadFleet = () => {
            fetchDriversForDispatch().then((list) => {
              if (list) setFleetDrivers(list);
            });
          };
          loadFleet();

          // Live completed trips load
          fetchCompletedTripsFromServer().catch(() => {});

          unsubTrips = subscribeToTripsRealtime(() => {
            fetchTripsForDispatch().then((updated) => {
              if (updated) setTrips(updated);
            });
          });
          unsubDrivers = subscribeToDriversRealtime(() => {
            loadFleet();
          });
        } else {
          setAdminProfile(null);
        }
      });
    }

    const unsubAuth = onDispatcherAuthStateChange((session, profile) => {
      if (!profile) {
        setAdminProfile(null);
        if (unsubTrips) unsubTrips();
        if (unsubDrivers) unsubDrivers();
      } else {
        setAdminProfile(profile);
      }
    });

    return () => {
      unsubAuth();
      if (unsubTrips) unsubTrips();
      if (unsubDrivers) unsubDrivers();
    };
  }, [isOpen]);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setIsLoggingIn(true);
    const res = await signInDispatcher(loginEmail, loginPassword);
    setIsLoggingIn(false);
    if (res.success && res.profile) {
      setAdminProfile(res.profile);
      setLoginPassword('');
      const serverTrips = await fetchTripsForDispatch();
      if (serverTrips) setTrips(serverTrips);
    } else {
      setAuthError(res.error || 'Authentication failed. Please verify credentials.');
    }
  };

  const handleSignOut = async () => {
    await signOutDispatcher();
    setAdminProfile(null);
    setTrips([]);
    setCreatedTrip(null);
    setAuthError(null);
  };

  // Recalculate route whenever locations change
  useEffect(() => {
    if ((pickupLat && dropLat) || (pickupAddress.length > 5 && dropAddress.length > 5)) {
      setIsCalculatingRoute(true);
      calculateDrivingRoute(
        { latitude: pickupLat, longitude: pickupLng, address: pickupAddress },
        { latitude: dropLat, longitude: dropLng, address: dropAddress }
      )
        .then((res) => {
          setRouteDistanceKm(res.distanceKm);
          setRouteDurationMin(res.durationMinutes);
          setIsCalculatingRoute(false);
        })
        .catch(() => setIsCalculatingRoute(false));
    }
  }, [pickupLat, pickupLng, dropLat, dropLng, pickupAddress, dropAddress]);

  if (!isOpen) return null;

  // Live estimated fare from custom tariff
  const calculatedEstimate = calculateCustomTripFare({
    tariff,
    distanceKm: routeDistanceKm,
    durationSeconds: routeDurationMin * 60,
    waitingSeconds: 0,
    extraTolls: 0,
    extraParking: 0,
  });

  // Handle Pickup input with Google Places autocomplete
  const handlePickupChange = (value: string) => {
    setPickupAddress(value);
    setPickupPlaceId(undefined);
    setShowPickupDropdown(true);

    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    if (value.trim().length >= 2) {
      setIsSearchingPickup(true);
      debounceTimer.current = setTimeout(async () => {
        const results = await fetchPlacePredictions(value, placesSessionToken.current);
        setPickupSuggestions(results);
        setIsSearchingPickup(false);
      }, 300);
    } else {
      setPickupSuggestions([]);
      setIsSearchingPickup(false);
    }
  };

  const selectPickupSuggestion = async (s: PlaceSuggestion) => {
    setPickupAddress(s.fullAddress || s.primaryText);
    setPickupPlaceId(s.placeId);
    setShowPickupDropdown(false);

    if (s.latitude && s.longitude) {
      setPickupLat(s.latitude);
      setPickupLng(s.longitude);
    } else {
      const details = await fetchPlaceDetails(s.placeId, placesSessionToken.current);
      if (details) {
        setPickupLat(details.latitude);
        setPickupLng(details.longitude);
      }
    }
  };

  // Handle Drop input with Google Places autocomplete
  const handleDropChange = (value: string) => {
    setDropAddress(value);
    setDropPlaceId(undefined);
    setShowDropDropdown(true);

    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    if (value.trim().length >= 2) {
      setIsSearchingDrop(true);
      debounceTimer.current = setTimeout(async () => {
        const results = await fetchPlacePredictions(value, placesSessionToken.current);
        setDropSuggestions(results);
        setIsSearchingDrop(false);
      }, 300);
    } else {
      setDropSuggestions([]);
      setIsSearchingDrop(false);
    }
  };

  const selectDropSuggestion = async (s: PlaceSuggestion) => {
    setDropAddress(s.fullAddress || s.primaryText);
    setDropPlaceId(s.placeId);
    setShowDropDropdown(false);

    if (s.latitude && s.longitude) {
      setDropLat(s.latitude);
      setDropLng(s.longitude);
    } else {
      const details = await fetchPlaceDetails(s.placeId, placesSessionToken.current);
      if (details) {
        setDropLat(details.latitude);
        setDropLng(details.longitude);
      }
    }
  };

  const handlePresetSelect = (presetKey: string) => {
    setTripType(presetKey);
    const newConfig = createDefaultTariffConfig(presetKey);
    setTariff(newConfig);
  };

  const handleCreateTrip = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!customerName || !pickupAddress || !dropAddress) {
      setFormError('Please enter Customer Name, Pickup Address, and Drop Address.');
      return;
    }

    setIsSubmitting(true);

    const tripTariff: TariffConfig = {
      ...tariff,
      quotedAmount: Number(tariff.quotedAmount) || calculatedEstimate.totalFare,
    };

    const res = await createOpenTrip({
      customerName,
      customerMobile: customerMobile || '+91 98401 23456',
      pickupAddress,
      dropAddress,
      pickupLatitude: pickupLat,
      pickupLongitude: pickupLng,
      pickupPlaceId,
      dropLatitude: dropLat,
      dropLongitude: dropLng,
      dropPlaceId,
      tripType,
      estimatedFare: tripTariff.quotedAmount || calculatedEstimate.totalFare,
      estimatedDistanceKm: routeDistanceKm,
      estimatedDurationMinutes: routeDurationMin,
      tariffConfig: tripTariff,
      notes,
      passengerOtpRequired,
      passengerVerificationOtp: passengerOtpRequired ? passengerOtp : undefined,
    });

    setIsSubmitting(false);

    if (res.success && res.trip) {
      setCreatedTrip(res.trip);
      setCreatedStartPin(res.startPin || null);
      setTrips(getLocalTrips());
      onTripCreated(res.trip);
      placesSessionToken.current = createPlacesSessionToken();
      // Reset form
      setCustomerName('');
      setCustomerMobile('');
      setPickupAddress('');
      setDropAddress('');
      setNotes('');
    } else {
      setFormError(res.error || 'Failed to create trip');
    }
  };

  const handleCopyOtp = (otp: string) => {
    navigator.clipboard.writeText(otp);
    setCopiedOtp(otp);
    setTimeout(() => setCopiedOtp(null), 2500);
  };

  const handleRevealPin = async (tripId: string) => {
    if (revealedPins[tripId]) return;
    setLoadingPins(prev => ({ ...prev, [tripId]: true }));
    const pin = await getTripStartPin(tripId);
    setLoadingPins(prev => ({ ...prev, [tripId]: false }));
    if (pin) {
      setRevealedPins(prev => ({ ...prev, [tripId]: pin }));
    } else {
      alert('Failed to retrieve start PIN. Unauthorized or network error.');
    }
  };

  const handleExportCsv = () => {
    if (trips.length === 0) return;
    const headers = [
      'Trip Number',
      'Customer Name',
      'Customer Mobile',
      'Pickup',
      'Drop',
      'Type',
      'Base Fare',
      'Rate/KM',
      'Estimated Fare',
      'Status',
      'OTP',
      'Claimed',
      'Created At',
    ];
    const rows = trips.map((t) => [
      `"${t.tripNumber}"`,
      `"${t.customerName}"`,
      `"${t.customerMobile}"`,
      `"${t.pickupAddress.replace(/"/g, '""')}"`,
      `"${t.dropAddress.replace(/"/g, '""')}"`,
      `"${t.tripType}"`,
      t.tariffConfig?.baseFare || 0,
      t.tariffConfig?.ratePerKm || 0,
      t.estimatedFare,
      `"${t.status}"`,
      `"${t.tripAccessOtp}"`,
      t.isOtpConsumed ? 'Yes' : 'No',
      `"${t.createdAt}"`,
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute(
      'download',
      `SBS_Travels_Trips_${new Date().toISOString().slice(0, 10)}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDeviceStatusChange = (status: DeviceActivationStatus) => {
    const updated = { ...driver, activationStatus: status };
    saveDriverProfile(updated);
    onDriverUpdated(updated);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-4">
      <div className="bg-slate-900 border border-slate-800 w-full max-w-xl rounded-3xl p-5 sm:p-6 shadow-2xl flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div>
            <div className="flex items-center space-x-2">
              <span className="bg-sky-500/10 text-sky-400 border border-sky-500/20 px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider">
                Dispatcher Console
              </span>
              <h2 className="text-base font-bold text-white">SBS Travels Trip Manager</h2>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Custom Per-Trip Pricing &amp; Driver Authorization
            </p>
          </div>
          <div className="flex items-center space-x-2.5">
            {adminProfile && (
              <>
                <div className="text-right hidden sm:block">
                  <div className="flex items-center justify-end space-x-1.5">
                    <span className="text-xs font-semibold text-white">{adminProfile.fullName}</span>
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      {adminProfile.role}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400">{adminProfile.email}</div>
                </div>
                <button
                  onClick={handleSignOut}
                  title="Sign Out"
                  className="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-rose-400 text-xs font-semibold transition border border-slate-700 flex items-center space-x-1.5"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Sign Out</span>
                </button>
              </>
            )}
            <button
              onClick={onClose}
              className="w-7 h-7 rounded-full bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center text-xs"
            >
              ✕
            </button>
          </div>
        </div>

        {authLoading ? (
          <div className="flex-1 flex flex-col items-center justify-center py-20 space-y-3">
            <RefreshCw className="w-7 h-7 animate-spin text-sky-400" />
            <span className="text-xs text-slate-400 font-medium tracking-wide">
              Verifying Dispatcher Credentials...
            </span>
          </div>
        ) : !adminProfile ? (
          <div className="flex-1 flex flex-col justify-center items-center py-6 px-2 sm:px-6">
            <div className="w-full max-w-md bg-slate-950/60 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-5">
              <div className="text-center space-y-1">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-sky-500/10 border border-sky-500/20 text-sky-400 mb-2 shadow-inner">
                  <Shield className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-bold text-white tracking-tight">Dispatcher Authorization</h3>
                <p className="text-xs text-slate-400">
                  Sign in with your SBS Travels credentials to dispatch trips and manage fleet.
                </p>
              </div>

              {authError && (
                <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start space-x-2.5">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-rose-400" />
                  <div className="flex-1 leading-relaxed">{authError}</div>
                </div>
              )}

              <form onSubmit={handleLoginSubmit} className="space-y-4">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                    Dispatcher Email
                  </label>
                  <input
                    type="email"
                    value={loginEmail}
                    onChange={(e) => {
                      setLoginEmail(e.target.value);
                      setAuthError(null);
                    }}
                    placeholder="dispatcher@sbstravels.com"
                    disabled={isLoggingIn}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-sky-500 transition"
                    required
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                    Password
                  </label>
                  <input
                    type="password"
                    value={loginPassword}
                    onChange={(e) => {
                      setLoginPassword(e.target.value);
                      setAuthError(null);
                    }}
                    placeholder="••••••••••••"
                    disabled={isLoggingIn}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-sky-500 transition"
                    required
                  />
                </div>

                <button
                  type="submit"
                  disabled={isLoggingIn}
                  className="w-full py-3 px-4 rounded-xl bg-sky-600 hover:bg-sky-500 active:bg-sky-700 disabled:opacity-50 text-white font-bold text-sm tracking-wide transition shadow-lg shadow-sky-600/20 flex items-center justify-center space-x-2"
                >
                  {isLoggingIn ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Verifying Authorization...</span>
                    </>
                  ) : (
                    <>
                      <Key className="w-4 h-4" />
                      <span>Sign In to Dispatch Console</span>
                    </>
                  )}
                </button>
              </form>

              <div className="pt-2 border-t border-slate-800/80 text-[11px] text-slate-500 text-center">
                Access restricted to authorized <span className="text-slate-400 font-mono">MASTER_ADMIN</span>, <span className="text-slate-400 font-mono">ADMIN</span>, or <span className="text-slate-400 font-mono">DISPATCHER</span> personnel.
              </div>
            </div>
          </div>
        ) : (
          <>
        {/* Navigation Tabs */}
        <div className="flex space-x-1 pt-3 pb-2 text-xs overflow-x-auto no-scrollbar">
          <button
            onClick={() => setActiveTab('create')}
            className={`px-3 py-2 rounded-xl font-bold whitespace-nowrap transition ${
              activeTab === 'create'
                ? 'bg-sky-600 text-white shadow-md'
                : 'bg-slate-800/70 text-slate-400 hover:text-slate-200'
            }`}
          >
            + Create
          </button>
          <button
            onClick={() => setActiveTab('list')}
            className={`px-3 py-2 rounded-xl font-bold whitespace-nowrap transition ${
              activeTab === 'list'
                ? 'bg-sky-600 text-white shadow-md'
                : 'bg-slate-800/70 text-slate-400 hover:text-slate-200'
            }`}
          >
            Live Trips ({trips.length})
          </button>
          <button
            onClick={() => setActiveTab('drivers')}
            className={`px-3 py-2 rounded-xl font-bold whitespace-nowrap transition ${
              activeTab === 'drivers'
                ? 'bg-sky-600 text-white shadow-md'
                : 'bg-slate-800/70 text-slate-400 hover:text-slate-200'
            }`}
          >
            Fleet Monitor
          </button>
          <button
            onClick={() => setActiveTab('reports')}
            className={`px-3 py-2 rounded-xl font-bold whitespace-nowrap transition ${
              activeTab === 'reports'
                ? 'bg-sky-600 text-white shadow-md'
                : 'bg-slate-800/70 text-slate-400 hover:text-slate-200'
            }`}
          >
            Reports &amp; History
          </button>
          <button
            onClick={() => setActiveTab('devices')}
            className={`px-3 py-2 rounded-xl font-bold whitespace-nowrap transition ${
              activeTab === 'devices'
                ? 'bg-sky-600 text-white shadow-md'
                : 'bg-slate-800/70 text-slate-400 hover:text-slate-200'
            }`}
          >
            Device Security
          </button>
          <button
            onClick={() => setActiveTab('sql')}
            className={`px-3 py-2 rounded-xl font-bold whitespace-nowrap transition ${
              activeTab === 'sql'
                ? 'bg-sky-600 text-white shadow-md'
                : 'bg-slate-800/70 text-slate-400 hover:text-slate-200'
            }`}
          >
            SQL Setup
          </button>
        </div>

        {/* Body Container */}
        <div className="overflow-y-auto flex-1 pr-1 pt-2 space-y-4">
          {/* TAB 1: Create OPEN Trip with Custom Tariff */}
          {activeTab === 'create' && (
            <div className="space-y-4">
              {createdTrip && (
                <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-xs space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-emerald-400 uppercase tracking-wider">
                      Trip Created Successfully!
                    </span>
                    <button
                      onClick={() => setCreatedTrip(null)}
                      className="text-slate-400 hover:text-white"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                      <div>
                        <p className="font-mono font-bold text-sky-400">{createdTrip.tripNumber}</p>
                        <p className="text-slate-300 font-medium">{createdTrip.customerName}</p>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] text-slate-500 uppercase block font-semibold">1. Trip Access OTP (For Driver)</span>
                        <div className="flex items-center space-x-1.5 mt-0.5 justify-end">
                          <span className="font-mono font-black text-lg text-emerald-400 tracking-wider">
                            {createdTrip.tripAccessOtp}
                          </span>
                          <button
                            onClick={() => handleCopyOtp(createdTrip.tripAccessOtp)}
                            className="p-1 rounded bg-slate-800 text-slate-300 hover:text-white"
                          >
                            {copiedOtp === createdTrip.tripAccessOtp ? (
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Start Trip PIN (Phase 2.6) */}
                    <div className="flex items-center justify-between bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                      <div>
                        <span className="text-[10px] text-slate-500 uppercase block font-semibold">2. Start Trip PIN (Driver Secret)</span>
                        <span className="text-[11px] text-slate-400">Driver enters this code to activate active meter</span>
                      </div>
                      <div className="flex items-center space-x-1.5">
                        <span className="font-mono font-black text-lg text-emerald-400 tracking-wider">
                          {createdStartPin || 'N/A'}
                        </span>
                        <button
                          onClick={() => handleCopyOtp(createdStartPin || '')}
                          className="p-1 rounded bg-slate-800 text-slate-300 hover:text-white"
                        >
                          {copiedOtp === createdStartPin ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>

                    {createdTrip.passengerOtpRequired && createdTrip.passengerVerificationOtp && (
                      <div className="flex items-center justify-between bg-amber-950/20 p-2.5 rounded-xl border border-amber-500/30">
                        <div>
                          <span className="text-[10px] text-amber-400 font-bold uppercase block">
                            2. Passenger Verification OTP (Customer Secret)
                          </span>
                          <span className="text-[11px] text-slate-300">
                            Give this 4-digit code to customer {createdTrip.customerName}
                          </span>
                        </div>
                        <div className="flex items-center space-x-1.5">
                          <span className="font-mono font-black text-lg text-amber-400 tracking-widest">
                            {createdTrip.passengerVerificationOtp}
                          </span>
                          <button
                            onClick={() => handleCopyOtp(createdTrip.passengerVerificationOtp!)}
                            className="p-1 rounded bg-slate-800 text-slate-300 hover:text-white"
                          >
                            {copiedOtp === createdTrip.passengerVerificationOtp ? (
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Driver uses <strong>{createdTrip.tripAccessOtp}</strong> to claim. {createdTrip.passengerOtpRequired ? `Passenger provides OTP ${createdTrip.passengerVerificationOtp} upon driver arrival.` : 'Passenger OTP verification is not required for this trip.'}
                  </p>
                </div>
              )}

              {formError && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs">
                  {formError}
                </div>
              )}

              <form onSubmit={handleCreateTrip} className="space-y-3.5 text-xs">
                {/* Customer Details */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-bold text-slate-400 block mb-1">
                      Customer Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      placeholder="e.g. Suresh Kumar"
                      className="w-full text-xs py-2 px-3 bg-slate-950 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-sky-500"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-slate-400 block mb-1">
                      Customer Mobile *
                    </label>
                    <input
                      type="text"
                      required
                      value={customerMobile}
                      onChange={(e) => setCustomerMobile(e.target.value)}
                      placeholder="e.g. +91 98401 23456"
                      className="w-full text-xs py-2 px-3 bg-slate-950 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-sky-500 font-mono"
                    />
                  </div>
                </div>

                {/* Pickup Address with Google Places Autocomplete */}
                <div className="relative">
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] font-bold text-slate-400">
                      Pickup Address *
                    </label>
                    {isSearchingPickup && (
                      <span className="text-[10px] text-sky-400 animate-pulse">Searching places...</span>
                    )}
                  </div>
                  <div className="relative">
                    <input
                      type="text"
                      required
                      value={pickupAddress}
                      onChange={(e) => handlePickupChange(e.target.value)}
                      onFocus={() => pickupSuggestions.length > 0 && setShowPickupDropdown(true)}
                      placeholder="Type 3+ letters to search (e.g. Chennai Central)"
                      className="w-full text-xs py-2 pl-8 pr-3 bg-slate-950 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-sky-500"
                    />
                    <MapPin className="w-3.5 h-3.5 text-sky-400 absolute left-2.5 top-2.5" />
                  </div>

                  {showPickupDropdown && pickupSuggestions.length > 0 && (
                    <div className="absolute z-20 left-0 right-0 mt-1 bg-slate-950 border border-slate-800 rounded-xl shadow-xl max-h-48 overflow-y-auto">
                      {pickupSuggestions.map((s) => (
                        <div
                          key={s.placeId}
                          onClick={() => selectPickupSuggestion(s)}
                          className="p-2.5 hover:bg-slate-800/80 cursor-pointer border-b border-slate-900 last:border-none"
                        >
                          <p className="font-semibold text-white text-xs">{s.primaryText}</p>
                          <p className="text-[10px] text-slate-400 truncate">{s.secondaryText || s.fullAddress}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Drop Address with Google Places Autocomplete */}
                <div className="relative">
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] font-bold text-slate-400">
                      Drop Address *
                    </label>
                    {isSearchingDrop && (
                      <span className="text-[10px] text-emerald-400 animate-pulse">Searching places...</span>
                    )}
                  </div>
                  <div className="relative">
                    <input
                      type="text"
                      required
                      value={dropAddress}
                      onChange={(e) => handleDropChange(e.target.value)}
                      onFocus={() => dropSuggestions.length > 0 && setShowDropDropdown(true)}
                      placeholder="Type 3+ letters to search (e.g. Airport Terminal)"
                      className="w-full text-xs py-2 pl-8 pr-3 bg-slate-950 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-sky-500"
                    />
                    <MapPin className="w-3.5 h-3.5 text-emerald-400 absolute left-2.5 top-2.5" />
                  </div>

                  {showDropDropdown && dropSuggestions.length > 0 && (
                    <div className="absolute z-20 left-0 right-0 mt-1 bg-slate-950 border border-slate-800 rounded-xl shadow-xl max-h-48 overflow-y-auto">
                      {dropSuggestions.map((s) => (
                        <div
                          key={s.placeId}
                          onClick={() => selectDropSuggestion(s)}
                          className="p-2.5 hover:bg-slate-800/80 cursor-pointer border-b border-slate-900 last:border-none"
                        >
                          <p className="font-semibold text-white text-xs">{s.primaryText}</p>
                          <p className="text-[10px] text-slate-400 truncate">{s.secondaryText || s.fullAddress}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Driving Route Estimation Banner */}
                <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800 flex items-center justify-between text-xs">
                  <div className="flex items-center space-x-2">
                    <Navigation className="w-4 h-4 text-sky-400" />
                    <div>
                      <span className="text-[10px] text-slate-400 uppercase block font-semibold">
                        Google Driving Route
                      </span>
                      <span className="font-mono font-bold text-white">
                        {isCalculatingRoute ? 'Calculating...' : `${routeDistanceKm} km`}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Clock className="w-4 h-4 text-teal-400" />
                    <div>
                      <span className="text-[10px] text-slate-400 uppercase block font-semibold">
                        Estimated Time
                      </span>
                      <span className="font-mono font-bold text-white">
                        {isCalculatingRoute ? '...' : `~${routeDurationMin} min`}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Custom Per-Trip Tariff Configuration Header */}
                <div className="pt-2 border-t border-slate-800">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <span className="text-xs font-bold text-white block">
                        Custom Trip Fare Configuration
                      </span>
                      <span className="text-[10px] text-slate-400">
                        Dispatcher defines exact pricing for this trip
                      </span>
                    </div>
                    {/* Quick Preset Selector for Convenience */}
                    <div className="flex space-x-1">
                      {['ONE_WAY', 'LOCAL', 'ROUND_TRIP', 'AIRPORT'].map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => handlePresetSelect(preset)}
                          className={`text-[9px] font-bold px-2 py-0.5 rounded transition ${
                            tripType === preset
                              ? 'bg-sky-500 text-white'
                              : 'bg-slate-800 text-slate-400 hover:text-white'
                          }`}
                        >
                          {preset}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Tariff Grid Inputs */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                    <div>
                      <label className="text-[10px] font-semibold text-slate-400 block mb-0.5">
                        Base Fare (₹)
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={tariff.baseFare}
                        onChange={(e) => setTariff({ ...tariff, baseFare: Number(e.target.value) })}
                        className="w-full text-xs py-1.5 px-2 bg-slate-950 border border-slate-700 rounded-lg text-white font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-slate-400 block mb-0.5">
                        Included KM
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={tariff.includedKm}
                        onChange={(e) => setTariff({ ...tariff, includedKm: Number(e.target.value) })}
                        className="w-full text-xs py-1.5 px-2 bg-slate-950 border border-slate-700 rounded-lg text-white font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-slate-400 block mb-0.5">
                        Minimum KM
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={tariff.minimumKm}
                        onChange={(e) => setTariff({ ...tariff, minimumKm: Number(e.target.value) })}
                        className="w-full text-xs py-1.5 px-2 bg-slate-950 border border-slate-700 rounded-lg text-white font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-slate-400 block mb-0.5">
                        Rate / KM (₹)
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        value={tariff.ratePerKm}
                        onChange={(e) => setTariff({ ...tariff, ratePerKm: Number(e.target.value) })}
                        className="w-full text-xs py-1.5 px-2 bg-slate-950 border border-slate-700 rounded-lg text-white font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-slate-400 block mb-0.5">
                        Waiting ₹/min
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={tariff.waitingRatePerMinute}
                        onChange={(e) =>
                          setTariff({ ...tariff, waitingRatePerMinute: Number(e.target.value) })
                        }
                        className="w-full text-xs py-1.5 px-2 bg-slate-950 border border-slate-700 rounded-lg text-white font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-slate-400 block mb-0.5">
                        Waiting Grace (min)
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={tariff.waitingGraceMinutes}
                        onChange={(e) =>
                          setTariff({ ...tariff, waitingGraceMinutes: Number(e.target.value) })
                        }
                        className="w-full text-xs py-1.5 px-2 bg-slate-950 border border-slate-700 rounded-lg text-white font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-slate-400 block mb-0.5">
                        Driver Bata (₹)
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={tariff.driverBata}
                        onChange={(e) => setTariff({ ...tariff, driverBata: Number(e.target.value) })}
                        className="w-full text-xs py-1.5 px-2 bg-slate-950 border border-slate-700 rounded-lg text-white font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-slate-400 block mb-0.5">
                        Toll (₹)
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={tariff.toll}
                        onChange={(e) => setTariff({ ...tariff, toll: Number(e.target.value) })}
                        className="w-full text-xs py-1.5 px-2 bg-slate-950 border border-slate-700 rounded-lg text-white font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-slate-400 block mb-0.5">
                        Parking (₹)
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={tariff.parking}
                        onChange={(e) => setTariff({ ...tariff, parking: Number(e.target.value) })}
                        className="w-full text-xs py-1.5 px-2 bg-slate-950 border border-slate-700 rounded-lg text-white font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-slate-400 block mb-0.5">
                        Interstate Tax (₹)
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={tariff.interstateTax}
                        onChange={(e) =>
                          setTariff({ ...tariff, interstateTax: Number(e.target.value) })
                        }
                        className="w-full text-xs py-1.5 px-2 bg-slate-950 border border-slate-700 rounded-lg text-white font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-slate-400 block mb-0.5">
                        Extra Charges (₹)
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={tariff.additionalCharges}
                        onChange={(e) =>
                          setTariff({ ...tariff, additionalCharges: Number(e.target.value) })
                        }
                        className="w-full text-xs py-1.5 px-2 bg-slate-950 border border-slate-700 rounded-lg text-white font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-slate-400 block mb-0.5">
                        Discount (₹)
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={tariff.discount}
                        onChange={(e) => setTariff({ ...tariff, discount: Number(e.target.value) })}
                        className="w-full text-xs py-1.5 px-2 bg-slate-950 border border-slate-700 rounded-lg text-white font-mono"
                      />
                    </div>
                  </div>
                </div>

                {/* Pricing Summary Breakdown Card */}
                <div className="bg-slate-950 p-3 rounded-2xl border border-slate-800 space-y-1.5 text-slate-300">
                  <div className="flex items-center justify-between text-[11px] font-bold text-slate-400 uppercase tracking-wider pb-1 border-b border-slate-900">
                    <span>Dispatch Pricing Summary</span>
                    <span className="text-sky-400 font-mono">@{tariff.ratePerKm}/km</span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-slate-400">Base Fare ({tariff.includedKm} km incl.)</span>
                    <span className="font-mono text-white">₹{calculatedEstimate.baseFare}</span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-slate-400">Distance Fare ({Math.max(0, routeDistanceKm - tariff.includedKm)} km extra)</span>
                    <span className="font-mono text-white">₹{calculatedEstimate.distanceFare}</span>
                  </div>
                  {(calculatedEstimate.driverBata > 0 || calculatedEstimate.toll > 0) && (
                    <div className="flex justify-between text-[11px]">
                      <span className="text-slate-400">Bata &amp; Toll</span>
                      <span className="font-mono text-white">
                        ₹{calculatedEstimate.driverBata + calculatedEstimate.toll}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between pt-1 border-t border-slate-800 text-xs">
                    <span className="font-bold text-white uppercase">Quoted Customer Fare</span>
                    <span className="text-base font-extrabold font-mono text-emerald-400">
                      ₹{calculatedEstimate.totalFare}
                    </span>
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-bold text-slate-400 block mb-1">
                    Special Notes (Optional)
                  </label>
                  <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="e.g. Airport Terminal 2 gate pickup"
                    className="w-full text-xs py-2 px-3 bg-slate-950 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-sky-500"
                  />
                </div>

                {/* Credential 4: Passenger Verification OTP */}
                <div className="bg-slate-950 p-3 rounded-2xl border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Shield className="w-4 h-4 text-amber-400" />
                      <div>
                        <label htmlFor="passengerOtpReq" className="text-xs font-bold text-white cursor-pointer block">
                          Require Passenger Verification OTP
                        </label>
                        <span className="text-[10px] text-slate-400">
                          Customer must provide 4-digit code upon arrival before driver can start meter
                        </span>
                      </div>
                    </div>
                    <input
                      id="passengerOtpReq"
                      type="checkbox"
                      checked={passengerOtpRequired}
                      onChange={(e) => setPassengerOtpRequired(e.target.checked)}
                      className="w-4 h-4 accent-amber-500 rounded cursor-pointer"
                    />
                  </div>

                  {passengerOtpRequired && (
                    <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between">
                      <div>
                        <span className="text-[10px] text-slate-400 block font-semibold uppercase">
                          Customer OTP Secret
                        </span>
                        <span className="font-mono font-extrabold text-amber-400 text-sm tracking-widest">
                          {passengerOtp}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setPassengerOtp(Math.floor(1000 + Math.random() * 9000).toString())}
                        className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-[10px] font-bold text-slate-300 border border-slate-700 transition"
                      >
                        Regenerate OTP
                      </button>
                    </div>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white font-extrabold text-xs tracking-wider uppercase shadow-lg shadow-sky-600/25 active:scale-[0.98] transition flex items-center justify-center space-x-2"
                >
                  <PlusCircle className="w-4 h-4" />
                  <span>{isSubmitting ? 'Creating Trip...' : 'Generate OPEN Trip &amp; OTP'}</span>
                </button>
              </form>
            </div>
          )}

          {/* TAB 2: Trips Realtime Monitor */}
          {activeTab === 'list' && (
            <div className="space-y-3">
              {/* Status Sub-Filters */}
              <div className="flex space-x-1 overflow-x-auto pb-1 no-scrollbar text-[11px]">
                {(['ALL', 'OPEN', 'CLAIMED', 'ARRIVED', 'STARTED', 'COMPLETED', 'CANCELLED'] as const).map((st) => {
                  const count = st === 'ALL' ? trips.length : trips.filter((t) => t.status === st).length;
                  const isActive = tripStatusFilter === st;
                  return (
                    <button
                      key={st}
                      onClick={() => setTripStatusFilter(st)}
                      className={`px-2.5 py-1 rounded-lg font-bold whitespace-nowrap transition flex items-center space-x-1 ${
                        isActive
                          ? 'bg-sky-600 text-white shadow-sm'
                          : 'bg-slate-950 border border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <span>{st === 'STARTED' ? 'ACTIVE' : st}</span>
                      <span className={`text-[10px] px-1 py-0.2 rounded-full ${isActive ? 'bg-sky-700 text-sky-100' : 'bg-slate-800 text-slate-400'}`}>
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center justify-between pb-1 text-xs">
                <span className="font-semibold text-slate-400">
                  Showing: <strong className="text-white">{trips.filter((t) => tripStatusFilter === 'ALL' || t.status === tripStatusFilter).length}</strong> trips
                </span>
                {trips.length > 0 && (
                  <button
                    onClick={handleExportCsv}
                    className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-sky-400 border border-slate-700 text-[11px] font-bold transition shadow-sm"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Export CSV</span>
                  </button>
                )}
              </div>

              {trips.filter((t) => tripStatusFilter === 'ALL' || t.status === tripStatusFilter).length === 0 ? (
                <div className="text-center py-8 text-slate-500 text-xs bg-slate-950/40 rounded-2xl border border-slate-800/60">
                  No {tripStatusFilter === 'ALL' ? '' : tripStatusFilter.toLowerCase()} trips found.
                </div>
              ) : (
                trips
                  .filter((t) => tripStatusFilter === 'ALL' || t.status === tripStatusFilter)
                  .map((t) => {
                    const isPassengerVerified = Boolean(t.passengerVerifiedAt || t.passengerVerificationStatus === 'VERIFIED');
                    return (
                      <div
                        key={t.id}
                        className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 text-xs space-y-2.5"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2">
                            <span className="font-mono font-bold text-sky-400">{t.tripNumber}</span>
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                t.status === 'OPEN'
                                  ? 'bg-amber-500/10 border border-amber-500/30 text-amber-400'
                                  : t.status === 'CLAIMED'
                                  ? 'bg-sky-500/10 border border-sky-500/30 text-sky-400'
                                  : t.status === 'ARRIVED'
                                  ? 'bg-purple-500/10 border border-purple-500/30 text-purple-400'
                                  : t.status === 'STARTED'
                                  ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 animate-pulse'
                                  : t.status === 'COMPLETED'
                                  ? 'bg-teal-500/10 border border-teal-500/30 text-teal-400'
                                  : 'bg-rose-500/10 border border-rose-500/30 text-rose-400'
                              }`}
                            >
                              {t.status === 'STARTED' ? 'ACTIVE' : t.status}
                            </span>

                            {t.passengerOtpRequired && (
                              <span
                                className={`px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase ${
                                  isPassengerVerified
                                    ? 'bg-emerald-950 text-emerald-400 border border-emerald-500/40'
                                    : 'bg-amber-950 text-amber-400 border border-amber-500/40'
                                }`}
                              >
                                {isPassengerVerified ? '✓ OTP VERIFIED' : 'OTP PENDING'}
                              </span>
                            )}
                          </div>
                          <span className="font-mono font-bold text-white">
                            {t.status === 'COMPLETED' ? `Fare: ₹${t.tariffConfig?.quotedAmount || t.estimatedFare}` : `Est: ₹${t.estimatedFare}`}
                          </span>
                        </div>

                        {/* Customer & Route details */}
                        <div className="text-slate-300">
                          <p className="font-semibold text-white">
                            {t.customerName} ({t.customerMobile})
                          </p>
                          <p className="text-[11px] text-slate-400 mt-0.5 truncate">
                            <span className="text-slate-500 font-semibold">Pickup:</span> {t.pickupAddress}
                          </p>
                          <p className="text-[11px] text-slate-400 truncate">
                            <span className="text-slate-500 font-semibold">Drop:</span> {t.dropAddress}
                          </p>
                        </div>

                        {/* Status-specific lifecycle details */}
                        {/* WhatsApp Sharing Bar */}
                        <div className="pt-2 border-t border-slate-900/80 flex items-center justify-between text-[11px]">
                          <span className="text-slate-500 font-semibold">Share via WhatsApp:</span>
                          <div className="flex items-center space-x-2">
                            <button
                              type="button"
                              onClick={() => {
                                const assignedDriver = t.claimedByDriverId
                                  ? fleetDrivers.find((fd) => fd.id === t.claimedByDriverId) || driver
                                  : undefined;
                                const msg = generateCustomerBookingMessage(t, assignedDriver);
                                const res = openWhatsApp(t.customerMobile, msg);
                                if (!res.success) alert(res.error);
                              }}
                              className="px-2.5 py-1 bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 border border-emerald-500/30 rounded-lg font-bold text-[10px] flex items-center space-x-1 transition"
                            >
                              <MessageSquare className="w-3 h-3 text-emerald-400" />
                              <span>WhatsApp Customer</span>
                            </button>

                            {t.status === 'OPEN' && (
                              <button
                                type="button"
                                onClick={() => {
                                  const msg = generateDriverDispatchMessage(t);
                                  const targetMobile = driver.mobile;
                                  const res = openWhatsApp(targetMobile, msg);
                                  if (!res.success) alert(res.error);
                                }}
                                className="px-2.5 py-1 bg-sky-600/20 hover:bg-sky-600/40 text-sky-300 border border-sky-500/30 rounded-lg font-bold text-[10px] flex items-center space-x-1 transition"
                              >
                                <MessageSquare className="w-3 h-3 text-sky-400" />
                                <span>WhatsApp Driver</span>
                              </button>
                            )}
                          </div>
                        </div>

                        {t.status !== 'COMPLETED' && t.status !== 'CANCELLED' && (
                          <div className="pt-1.5 flex flex-wrap items-center justify-between border-t border-slate-900 gap-2 text-[11px]">
                            <div className="flex items-center space-x-4">
                              <div className="flex items-center space-x-1.5 font-mono">
                                <span className="text-slate-500">Access OTP:</span>
                                <span className="font-bold text-white bg-slate-900 px-1.5 py-0.5 rounded">
                                  {t.tripAccessOtp}
                                </span>
                              </div>
                              <div className="flex items-center space-x-1.5 font-mono">
                                <span className="text-slate-500">Start PIN:</span>
                                {revealedPins[t.id] ? (
                                  <span className="font-bold text-emerald-400 bg-slate-900 px-1.5 py-0.5 rounded">
                                    {revealedPins[t.id]}
                                  </span>
                                ) : (
                                  <button
                                    onClick={() => handleRevealPin(t.id)}
                                    disabled={loadingPins[t.id]}
                                    className="px-1.5 py-0.5 rounded bg-slate-800 text-sky-400 font-bold text-[10px] hover:bg-slate-700 transition"
                                  >
                                    {loadingPins[t.id] ? '...' : 'Reveal'}
                                  </button>
                                )}
                              </div>
                            </div>
                            <button
                              onClick={() => handleCopyOtp(revealedPins[t.id] || t.tripAccessOtp)}
                              className="text-sky-400 hover:text-sky-300 flex items-center space-x-1 text-[11px]"
                            >
                              <Copy className="w-3 h-3" />
                              <span>Copy Code</span>
                            </button>
                          </div>
                        )}

                        {t.status === 'CLAIMED' && (
                          <div className="pt-1.5 flex items-center justify-between border-t border-slate-900 text-[11px] text-slate-400">
                            <div>
                              <span>Driver: <strong className="text-slate-200">{driver.name}</strong></span>
                              <span className="ml-2 font-mono">({driver.vehicleNumber})</span>
                            </div>
                            <span>Claimed: {t.claimedAt ? new Date(t.claimedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Just now'}</span>
                          </div>
                        )}

                        {t.status === 'ARRIVED' && (
                          <div className="pt-1.5 flex items-center justify-between border-t border-slate-900 text-[11px] text-slate-400">
                            <div>
                              <span>Driver: <strong className="text-purple-300">{driver.name}</strong></span>
                              <span className="ml-1 text-[10px]">arrived at {t.arrivedAt ? new Date(t.arrivedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'scene'}</span>
                            </div>
                            <div>
                              {t.passengerOtpRequired ? (
                                <span className={isPassengerVerified ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>
                                  {isPassengerVerified ? 'Customer OTP Verified' : 'Awaiting Customer OTP'}
                                </span>
                              ) : (
                                <span className="text-slate-500">OTP Not Required</span>
                              )}
                            </div>
                          </div>
                        )}

                        {t.status === 'STARTED' && (
                          <div className="pt-1.5 flex items-center justify-between border-t border-slate-900 text-[11px] text-slate-400">
                            <div className="flex items-center space-x-2">
                              <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                              <span>On Trip: <strong className="text-emerald-300">{driver.name}</strong></span>
                            </div>
                            <div className="font-mono text-emerald-400">
                              Started: {t.startedAt ? new Date(t.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Active'}
                            </div>
                          </div>
                        )}

                        {t.status === 'COMPLETED' && (
                          <div className="pt-1.5 flex items-center justify-between border-t border-slate-900 text-[11px] text-slate-400">
                            <div>
                              <span>Driver: <strong className="text-slate-200">{driver.name}</strong></span>
                              {t.completedAt && (
                                <span className="ml-2 text-slate-500">
                                  {new Date(t.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                              )}
                            </div>
                            <div className="font-mono font-bold text-teal-400">
                              Final: ₹{t.tariffConfig?.quotedAmount || t.estimatedFare}
                            </div>
                          </div>
                        )}

                        {/* WhatsApp Actions (Phase 2.3.3) */}
                        <div className="pt-2 flex items-center justify-between border-t border-slate-900/80 text-[11px]">
                          <button
                            type="button"
                            onClick={() => {
                              const msg = generateCustomerBookingMessage(t, t.status !== 'OPEN' ? driver : undefined);
                              const res = openWhatsApp(t.customerMobile, msg);
                              if (!res.success) alert(res.error);
                            }}
                            className="px-2.5 py-1 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30 rounded-lg font-bold text-[10px] transition flex items-center space-x-1"
                          >
                            <MessageSquare className="w-3 h-3 text-emerald-400" />
                            <span>WhatsApp Customer</span>
                          </button>

                          {t.status === 'OPEN' && (
                            <button
                              type="button"
                              onClick={() => {
                                const msg = generateDriverDispatchMessage(t);
                                const res = openWhatsApp(driver.mobile, msg);
                                if (!res.success) alert(res.error);
                              }}
                              className="px-2.5 py-1 bg-sky-600/20 hover:bg-sky-600/30 text-sky-400 border border-sky-500/30 rounded-lg font-bold text-[10px] transition flex items-center space-x-1"
                            >
                              <MessageSquare className="w-3 h-3 text-sky-400" />
                              <span>WhatsApp Driver</span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
              )}
            </div>
          )}

          {/* TAB 3: Realtime Fleet Driver Monitoring (Phase 2.3.2) */}
          {activeTab === 'drivers' && (() => {
            // Find reference pickup location from trips
            const openTripsWithCoords = trips.filter(
              (t) => t.status === 'OPEN' && t.pickupLatitude != null && t.pickupLongitude != null
            );
            const refTrip =
              selectedPickupTripId === 'AUTO'
                ? openTripsWithCoords[0] || trips[0]
                : trips.find((t) => t.id === selectedPickupTripId);

            const refLat = refTrip?.pickupLatitude;
            const refLng = refTrip?.pickupLongitude;

            // Filter drivers
            const allDriversList = fleetDrivers.length > 0 ? fleetDrivers : [driver];
            const filteredDrivers = allDriversList.filter((d) => {
              if (driverStatusFilter !== 'ALL' && d.operationalStatus !== driverStatusFilter) {
                return false;
              }
              if (driverSearchQuery.trim()) {
                const q = driverSearchQuery.toLowerCase().trim();
                const matchName = d.name.toLowerCase().includes(q);
                const matchCode = d.driverCode.toLowerCase().includes(q);
                const matchMobile = d.mobile.toLowerCase().includes(q);
                const matchVeh = d.vehicleNumber.toLowerCase().includes(q);
                const matchLoc = d.currentLocality ? d.currentLocality.toLowerCase().includes(q) : false;
                if (!matchName && !matchCode && !matchMobile && !matchVeh && !matchLoc) {
                  return false;
                }
              }
              return true;
            });

            // Map distances and sort
            const driversWithDistance = filteredDrivers.map((d) => {
              let distKm: number | null = null;
              if (refLat != null && refLng != null && d.currentLatitude != null && d.currentLongitude != null) {
                distKm = calculateHaversineKm(refLat, refLng, d.currentLatitude, d.currentLongitude);
              }
              return { driver: d, distKm };
            });

            if (refLat != null && refLng != null) {
              driversWithDistance.sort((a, b) => {
                if (a.distKm == null) return 1;
                if (b.distKm == null) return -1;
                return a.distKm - b.distKm;
              });
            }

            const activeOnlineCount = allDriversList.filter((d) => d.operationalStatus !== 'OFFLINE').length;

            return (
              <div className="space-y-4 text-xs">
                <div className="flex items-center justify-between pb-1 border-b border-slate-900">
                  <div>
                    <h3 className="font-bold text-white text-sm">Fleet Driver & Live GPS Dispatch</h3>
                    <p className="text-[11px] text-slate-400">Realtime driver availability, device activation & dispatch</p>
                  </div>
                  <div className="flex items-center space-x-2">
                    <button
                      type="button"
                      onClick={() => setShowProvisionModal(!showProvisionModal)}
                      className="px-2.5 py-1 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-bold transition flex items-center space-x-1"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      <span>{showProvisionModal ? 'Close Form' : '+ Provision Driver'}</span>
                    </button>
                    <span className="px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[11px] font-bold flex items-center space-x-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      <span>{activeOnlineCount} Driver{activeOnlineCount !== 1 ? 's' : ''} Online</span>
                    </span>
                  </div>
                </div>

                {copiedCodeNotice && (
                  <div className="bg-sky-950/80 border border-sky-500/60 p-2 rounded-xl text-sky-300 font-bold text-xs flex items-center space-x-1.5 animate-in fade-in">
                    <Check className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                    <span>{copiedCodeNotice}</span>
                  </div>
                )}

                {/* Provision Driver Form Panel (Phase 2.3.4) */}
                {showProvisionModal && (
                  <form onSubmit={handleProvisionDriverSubmit} className="bg-slate-950 p-4 rounded-2xl border border-sky-800/80 space-y-3">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-900">
                      <div className="flex items-center space-x-2 text-sky-400 font-bold text-xs uppercase">
                        <UserPlus className="w-4 h-4" />
                        <span>Provision New Driver Account</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowProvisionModal(false)}
                        className="text-slate-400 hover:text-white text-xs font-bold"
                      >
                        ✕ Close
                      </button>
                    </div>

                    {provisionError && (
                      <div className="bg-rose-950/80 text-rose-300 border border-rose-800 p-2 rounded-xl text-xs flex items-center space-x-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        <span>{provisionError}</span>
                      </div>
                    )}

                    {provisionSuccess && (
                      <div className="bg-emerald-950/80 text-emerald-300 border border-emerald-800 p-2 rounded-xl text-xs flex items-center space-x-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                        <span>{provisionSuccess}</span>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-slate-400 font-bold uppercase block mb-1">Driver Name *</label>
                        <input
                          type="text"
                          required
                          value={newDriverName}
                          onChange={(e) => setNewDriverName(e.target.value)}
                          placeholder="e.g. Ramesh Kumar"
                          className="w-full bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-sky-500"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-400 font-bold uppercase block mb-1">Mobile Number *</label>
                        <input
                          type="tel"
                          required
                          value={newDriverMobile}
                          onChange={(e) => setNewDriverMobile(e.target.value)}
                          placeholder="e.g. 9840122481"
                          className="w-full bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-sky-500"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="text-[10px] text-slate-400 font-bold uppercase block mb-1">Driver Code *</label>
                        <input
                          type="text"
                          required
                          value={newDriverCode}
                          onChange={(e) => setNewDriverCode(e.target.value)}
                          placeholder="e.g. DRV-102"
                          className="w-full bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-sky-500 font-mono"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-400 font-bold uppercase block mb-1">Vehicle No. *</label>
                        <input
                          type="text"
                          required
                          value={newDriverVehNo}
                          onChange={(e) => setNewDriverVehNo(e.target.value)}
                          placeholder="e.g. TN 37 AB 1234"
                          className="w-full bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-sky-500 font-mono"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-400 font-bold uppercase block mb-1">Vehicle Model</label>
                        <input
                          type="text"
                          value={newDriverVehModel}
                          onChange={(e) => setNewDriverVehModel(e.target.value)}
                          placeholder="e.g. Dzire / Etios"
                          className="w-full bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-sky-500"
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={isProvisioning}
                      className="w-full py-2 bg-sky-600 hover:bg-sky-500 disabled:bg-slate-800 text-white font-bold rounded-xl text-xs transition shadow flex items-center justify-center space-x-1"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      <span>{isProvisioning ? 'Provisioning Account...' : 'Provision Driver Account'}</span>
                    </button>
                  </form>
                )}

                {/* Search, Filter & Pickup Reference Bar */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2 bg-slate-950 p-3 rounded-2xl border border-slate-800">
                  <div>
                    <label className="text-[10px] text-slate-400 font-bold uppercase block mb-1">Search Fleet</label>
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
                      <input
                        type="text"
                        value={driverSearchQuery}
                        onChange={(e) => setDriverSearchQuery(e.target.value)}
                        placeholder="Search name, mobile, code, locality..."
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] text-slate-400 font-bold uppercase block mb-1">Status Filter</label>
                    <select
                      value={driverStatusFilter}
                      onChange={(e) => setDriverStatusFilter(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-sky-500"
                    >
                      <option value="ALL">All Statuses ({allDriversList.length})</option>
                      <option value="READY">🟢 READY / AVAILABLE</option>
                      <option value="TRIP_CLAIMED">🔵 TRIP CLAIMED</option>
                      <option value="ON_TRIP">🚙 ON TRIP</option>
                      <option value="OFFLINE">⚪ OFFLINE</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-[10px] text-slate-400 font-bold uppercase block mb-1">Pickup Distance Reference</label>
                    <select
                      value={selectedPickupTripId}
                      onChange={(e) => setSelectedPickupTripId(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-sky-500 truncate"
                    >
                      <option value="AUTO">Auto (Latest Open Trip)</option>
                      {trips.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.tripNumber}: {t.pickupAddress.slice(0, 25)}...
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {refTrip && (
                  <div className="bg-sky-950/40 border border-sky-800/60 p-2.5 rounded-xl flex items-center justify-between text-xs text-sky-200">
                    <div className="flex items-center space-x-2">
                      <MapPin className="w-4 h-4 text-sky-400 shrink-0" />
                      <span className="truncate">
                        <strong>Pickup Reference:</strong> {refTrip.pickupAddress}
                      </span>
                    </div>
                    {refLat != null && refLng != null && (
                      <span className="text-[10px] font-mono text-sky-400 bg-sky-900/60 px-2 py-0.5 rounded font-bold shrink-0 ml-2">
                        GPS Set
                      </span>
                    )}
                  </div>
                )}

                {/* Driver Fleet List */}
                <div className="space-y-3 max-h-96 overflow-y-auto pr-1 no-scrollbar">
                  {driversWithDistance.length === 0 ? (
                    <div className="text-center py-8 bg-slate-950 rounded-2xl border border-slate-800 text-slate-500">
                      No drivers match your current search/filter.
                    </div>
                  ) : (
                    driversWithDistance.map(({ driver: d, distKm }) => {
                      const lastLocAt = d.lastLocationAt;
                      let locFreshness = 'No GPS';
                      let locColor = 'text-slate-500';
                      if (lastLocAt) {
                        const diffMin = Math.floor((Date.now() - new Date(lastLocAt).getTime()) / 60000);
                        if (diffMin < 2) {
                          locFreshness = 'Live GPS (< 2m)';
                          locColor = 'text-emerald-400 font-bold';
                        } else if (diffMin < 10) {
                          locFreshness = `${diffMin}m ago`;
                          locColor = 'text-amber-400';
                        } else {
                          locFreshness = 'Stale GPS';
                          locColor = 'text-slate-500';
                        }
                      }

                      return (
                        <div
                          key={d.id}
                          className="bg-slate-950 p-3.5 rounded-2xl border border-slate-800 hover:border-slate-700 transition space-y-2.5"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-2.5">
                              {d.photoUrl ? (
                                <img
                                  src={d.photoUrl}
                                  alt={d.name}
                                  className="w-11 h-11 rounded-xl object-cover border border-slate-700 shadow-sm shrink-0"
                                />
                              ) : (
                                <div className="w-11 h-11 rounded-xl bg-sky-500/10 border border-sky-500/30 text-sky-400 flex items-center justify-center font-black shrink-0 text-base">
                                  {d.name.charAt(0)}
                                </div>
                              )}
                              <div>
                                <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                                  <span className="font-bold text-white text-sm">{d.name}</span>
                                  {editingDriverCodeId === d.id ? (
                                    <div className="flex items-center space-x-1">
                                      <input
                                        type="text"
                                        value={tempDriverCodeValue}
                                        onChange={(e) => setTempDriverCodeValue(e.target.value.toUpperCase())}
                                        className="w-20 bg-slate-900 border border-sky-500 rounded px-1.5 py-0.5 text-[10px] font-mono font-bold text-white uppercase focus:outline-none"
                                        placeholder="DRV007"
                                        autoFocus
                                      />
                                      <button
                                        type="button"
                                        onClick={() => handleSaveDriverCode(d.id)}
                                        className="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[10px] shadow"
                                      >
                                        Save
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setEditingDriverCodeId(null)}
                                        className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 text-[10px]"
                                      >
                                        ✕
                                      </button>
                                    </div>
                                  ) : (
                                    <div className="flex items-center space-x-1">
                                      <span className="bg-slate-800 text-sky-300 font-mono text-[10px] px-1.5 py-0.5 rounded font-bold border border-slate-700">
                                        {d.driverCode}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setEditingDriverCodeId(d.id);
                                          setTempDriverCodeValue(d.driverCode);
                                        }}
                                        className="text-[10px] text-sky-400 hover:text-sky-300 font-semibold underline ml-0.5"
                                        title="Master Admin: Change Driver ID (e.g. to DRV007)"
                                      >
                                        Edit ID
                                      </button>
                                    </div>
                                  )}
                                </div>
                                <p className="text-[11px] text-slate-400 font-mono">
                                  {d.mobile} • {d.vehicleNumber} ({d.vehicleModel || 'Taxi'})
                                </p>
                                {d.homeLocation && (
                                  <div className="flex items-center space-x-1 mt-0.5 text-[10px] text-emerald-400 font-medium">
                                    <MapPin className="w-3 h-3 text-emerald-400 shrink-0" />
                                    <span>Home: {d.homeLocation}</span>
                                  </div>
                                )}
                              </div>
                            </div>

                             <div className="flex items-center space-x-2 shrink-0">
                              {/* WhatsApp Dispatch Button */}
                              <button
                                type="button"
                                onClick={() => {
                                  const refTripForMsg = selectedPickupTripId === 'AUTO'
                                    ? (openTripsWithCoords[0] || trips[0])
                                    : trips.find((t) => t.id === selectedPickupTripId);

                                  if (!refTripForMsg) {
                                    alert('No active open trip found to dispatch. Please create a trip first.');
                                    return;
                                  }

                                  const msg = generateDriverDispatchMessage(refTripForMsg, d);
                                  const res = openWhatsApp(d.mobile, msg);
                                  if (!res.success) alert(res.error);
                                }}
                                className="px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 border border-emerald-500/30 rounded-xl font-bold text-xs transition flex items-center space-x-1.5"
                              >
                                <MessageSquare className="w-3.5 h-3.5 text-emerald-400" />
                                <span>WhatsApp</span>
                              </button>

                              {/* Direct Call Button */}
                              <a
                                href={`tel:${d.mobile}`}
                                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold text-xs transition border border-emerald-400/30 flex items-center space-x-1.5 shadow-sm"
                              >
                                <Phone className="w-3.5 h-3.5" />
                                <span>Call</span>
                              </a>
                            </div>
                          </div>

                          {/* Status & Distance Bar */}
                          <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-900 text-[11px]">
                            <div>
                              <span className="text-[10px] text-slate-500 uppercase font-semibold block mb-0.5">
                                Operational Status
                              </span>
                              <span
                                className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                                  d.operationalStatus === 'READY' || d.operationalStatus === 'AVAILABLE'
                                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                    : d.operationalStatus === 'TRIP_CLAIMED'
                                    ? 'bg-sky-500/20 text-sky-400 border border-sky-500/30'
                                    : d.operationalStatus === 'ARRIVED'
                                    ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                                    : d.operationalStatus === 'ON_TRIP'
                                    ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                                    : d.operationalStatus === 'OFFLINE'
                                    ? 'bg-slate-800 text-slate-400'
                                    : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                                }`}
                              >
                                {d.operationalStatus}
                              </span>
                            </div>

                            <div>
                              <span className="text-[10px] text-slate-500 uppercase font-semibold block mb-0.5">
                                Proximity to Pickup
                              </span>
                              <span className="font-bold text-white flex items-center space-x-1">
                                <Compass className="w-3 h-3 text-sky-400" />
                                <span>
                                  {distKm != null ? `${distKm.toFixed(1)} km away` : 'No GPS Ref'}
                                </span>
                              </span>
                            </div>

                            <div>
                              <span className="text-[10px] text-slate-500 uppercase font-semibold block mb-0.5">
                                Locality & GPS
                              </span>
                              <span className={`font-medium ${locColor} truncate block`}>
                                {d.currentLocality ? `${d.currentLocality} (${locFreshness})` : locFreshness}
                              </span>
                            </div>
                          </div>

                          {/* Quick Operational Status Override for Dispatcher */}
                          <div className="pt-2 border-t border-slate-900/60 flex items-center justify-between text-[10px]">
                            <span className="text-slate-500 font-semibold">Dispatcher Status Control:</span>
                            <div className="flex space-x-1">
                              {(['READY', 'OFFLINE', 'SUSPENDED'] as const).map((st) => (
                                <button
                                  key={st}
                                  type="button"
                                  onClick={async () => {
                                    await updateDriverOperationalStatus(d.id, st);
                                    if (d.id === driver.id) {
                                      const updated = { ...driver, operationalStatus: st };
                                      saveDriverProfile(updated);
                                      onDriverUpdated(updated);
                                    }
                                    fetchDriversForDispatch().then((list) => {
                                      if (list) setFleetDrivers(list);
                                    });
                                  }}
                                  className={`px-2 py-0.5 rounded font-bold text-[9px] transition ${
                                    d.operationalStatus === st
                                      ? 'bg-sky-600 text-white'
                                      : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                                  }`}
                                >
                                  {st}
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* Device Activation & Activation Code Delivery Bar (Phase 2.4) */}
                          <div className="pt-2 border-t border-slate-900/60 flex items-center justify-between text-[10px] gap-2 flex-wrap bg-slate-900/40 p-2.5 rounded-xl border border-slate-800/80">
                            <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                              <span className="text-slate-400 font-bold uppercase text-[9px]">Device:</span>
                              <span className={`px-2 py-0.5 rounded font-mono font-bold text-[10px] ${
                                d.activationStatus === 'ACTIVE'
                                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                  : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                              }`}>
                                {d.activationStatus || 'ACTIVE'}
                              </span>
                              <span className="font-mono text-slate-300 bg-slate-950 px-2 py-0.5 rounded border border-slate-800 text-[10px] font-bold">
                                {d.deviceId}
                              </span>
                              {d.deviceId && d.deviceId !== 'Unavailable/Not Registered' && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    navigator.clipboard.writeText(d.deviceId);
                                    setCopiedCodeNotice(`Copied Device ID: ${d.deviceId}`);
                                    setTimeout(() => setCopiedCodeNotice(null), 2500);
                                  }}
                                  className="text-slate-400 hover:text-white"
                                  title="Copy Device ID"
                                >
                                  <Copy className="w-3 h-3" />
                                </button>
                              )}
                            </div>

                            <div className="flex items-center space-x-2 flex-wrap gap-1.5">
                              {/* If activation code exists or was generated */}
                              {(generatedActivationCodes[d.id] || d.activationCode) ? (
                                <div className="flex items-center space-x-1.5 bg-sky-950/80 border border-sky-500/50 px-2.5 py-1 rounded-xl">
                                  <Key className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                                  <span className="text-slate-400 font-bold text-[9px] uppercase">Code:</span>
                                  <span className="font-mono font-black text-amber-300 text-xs tracking-wider">
                                    {generatedActivationCodes[d.id] || d.activationCode}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const codeToCopy = generatedActivationCodes[d.id] || d.activationCode || '';
                                      navigator.clipboard.writeText(codeToCopy);
                                      setCopiedCodeNotice(`Copied Code: ${codeToCopy}`);
                                      setTimeout(() => setCopiedCodeNotice(null), 2500);
                                    }}
                                    className="text-slate-300 hover:text-white ml-1"
                                    title="Copy Code"
                                  >
                                    <Copy className="w-3 h-3" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const code = generatedActivationCodes[d.id] || d.activationCode || '';
                                      const msg = `SBS Travels Dispatch: Hello ${d.name}, your Device Activation Code is: *${code}*. Please enter this code in your SBS Driver App to activate your mobile device (${d.deviceId}).`;
                                      openWhatsApp(d.mobile, msg);
                                    }}
                                    className="px-2 py-0.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-[10px] font-bold flex items-center space-x-1 transition ml-1 shadow-sm"
                                    title="Send Activation Code via WhatsApp"
                                  >
                                    <MessageSquare className="w-3 h-3" />
                                    <span>WhatsApp Code</span>
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  disabled={isGeneratingCode[d.id]}
                                  onClick={() => handleGenerateActivationCode(d.id, d.deviceId)}
                                  className="px-2.5 py-1 rounded-xl font-bold text-[10px] bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white shadow-sm transition flex items-center space-x-1 active:scale-95"
                                  title="Generate 6-digit Activation Code bound to this Device ID"
                                >
                                  <Key className="w-3 h-3" />
                                  <span>{isGeneratingCode[d.id] ? 'Generating...' : 'Create Activation Code'}</span>
                                </button>
                              )}

                              <button
                                type="button"
                                onClick={async () => {
                                  const nextStatus = d.activationStatus === 'ACTIVE' ? 'DEACTIVATED' : 'ACTIVE';
                                  await updateDriverActivation(d.id, nextStatus as DeviceActivationStatus);
                                  fetchDriversForDispatch().then((list) => {
                                    if (list) setFleetDrivers(list);
                                  });
                                }}
                                className={`px-2 py-1 rounded-xl font-bold transition text-[9px] ${
                                  d.activationStatus === 'ACTIVE'
                                    ? 'bg-rose-950/60 hover:bg-rose-900 text-rose-300 border border-rose-800'
                                    : 'bg-emerald-950/60 hover:bg-emerald-900 text-emerald-300 border border-emerald-800'
                                }`}
                              >
                                {d.activationStatus === 'ACTIVE' ? 'Deactivate' : 'Authorize'}
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })()}

          {/* TAB 4: Trip History & Performance Reporting */}
          {activeTab === 'reports' && (() => {
            const completedData = getFilteredCompletedTrips({
              range: dateFilter,
              customStart: customStartDate,
              customEnd: customEndDate,
              driverId: filterDriverId,
              vehicleNumber: filterVehicle,
            });
            const reportMetrics = calculateDispatcherReportMetrics(trips, completedData);

            // Export handler for filtered completed trips report
            const handleExportCompletedCsv = () => {
              if (completedData.length === 0) return;
              const headers = [
                'Trip Number',
                'Date',
                'Driver',
                'Customer',
                'Pickup',
                'Drop',
                'Distance (KM)',
                'Duration (Min)',
                'Waiting (Min)',
                'Base Fare',
                'Distance Fare',
                'Waiting Fare',
                'Toll & Parking',
                'Bata',
                'Total Fare',
                'Passenger OTP Verified',
                'Synced',
              ];
              const rows = completedData.map((t) => [
                `"${t.tripNumber}"`,
                `"${new Date(t.completedAt).toLocaleDateString()}"`,
                `"${driver.name}"`,
                `"${t.customerName}"`,
                `"${t.pickupAddress.replace(/"/g, '""')}"`,
                `"${t.dropAddress.replace(/"/g, '""')}"`,
                t.distanceKm.toFixed(2),
                Math.ceil(t.durationSeconds / 60),
                Math.ceil(t.waitingSeconds / 60),
                t.baseFare,
                t.distanceFare,
                t.waitingFare,
                t.toll + t.parking,
                t.driverBata,
                t.totalFare,
                t.passengerVerifiedAt || t.passengerVerificationStatus === 'VERIFIED' ? 'Yes' : 'No',
                t.isSynced ? 'Yes' : 'No',
              ]);
              const csvContent =
                'data:text/csv;charset=utf-8,' +
                [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
              const encodedUri = encodeURI(csvContent);
              const link = document.createElement('a');
              link.setAttribute('href', encodedUri);
              link.setAttribute('download', `SBS_Travels_Report_${dateFilter}_${new Date().toISOString().slice(0, 10)}.csv`);
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
            };

            return (
              <div className="space-y-3.5 text-xs">
                {/* Date Filter Pills */}
                <div className="flex space-x-1 overflow-x-auto pb-1 no-scrollbar text-[11px]">
                  {(['TODAY', 'YESTERDAY', 'THIS_WEEK', 'THIS_MONTH', 'ALL', 'CUSTOM'] as DateFilterRange[]).map((d) => (
                    <button
                      key={d}
                      onClick={() => setDateFilter(d)}
                      className={`px-2.5 py-1 rounded-lg font-bold whitespace-nowrap transition ${
                        dateFilter === d
                          ? 'bg-sky-600 text-white shadow-sm'
                          : 'bg-slate-950 border border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {d === 'THIS_WEEK'
                        ? 'This Week'
                        : d === 'THIS_MONTH'
                        ? 'This Month'
                        : d === 'ALL'
                        ? 'All Time'
                        : d === 'TODAY'
                        ? 'Today'
                        : d === 'YESTERDAY'
                        ? 'Yesterday'
                        : 'Custom Range'}
                    </button>
                  ))}
                </div>

                {/* Custom Date Inputs if CUSTOM selected */}
                {dateFilter === 'CUSTOM' && (
                  <div className="grid grid-cols-2 gap-2 bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                    <div>
                      <label className="text-[10px] text-slate-400 font-semibold block mb-0.5">Start Date</label>
                      <input
                        type="date"
                        value={customStartDate}
                        onChange={(e) => setCustomStartDate(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg text-white text-xs px-2 py-1"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-400 font-semibold block mb-0.5">End Date</label>
                      <input
                        type="date"
                        value={customEndDate}
                        onChange={(e) => setCustomEndDate(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg text-white text-xs px-2 py-1"
                      />
                    </div>
                  </div>
                )}

                {/* KPI Metrics Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className="bg-slate-950 p-3 rounded-2xl border border-slate-800">
                    <span className="text-[10px] text-slate-400 block uppercase font-semibold">Total Trips</span>
                    <span className="text-lg font-black font-mono text-white">{reportMetrics.totalTrips}</span>
                  </div>
                  <div className="bg-slate-950 p-3 rounded-2xl border border-slate-800">
                    <span className="text-[10px] text-slate-400 block uppercase font-semibold">Total Distance</span>
                    <span className="text-lg font-black font-mono text-sky-400">{reportMetrics.totalDistanceKm.toFixed(1)} <span className="text-xs font-normal text-slate-400">km</span></span>
                  </div>
                  <div className="bg-slate-950 p-3 rounded-2xl border border-slate-800">
                    <span className="text-[10px] text-slate-400 block uppercase font-semibold">Total Revenue</span>
                    <span className="text-lg font-black font-mono text-emerald-400">₹{reportMetrics.totalFare.toLocaleString('en-IN')}</span>
                  </div>
                  <div className="bg-slate-950 p-3 rounded-2xl border border-slate-800">
                    <span className="text-[10px] text-slate-400 block uppercase font-semibold">Total Waiting</span>
                    <span className="text-lg font-black font-mono text-amber-400">{reportMetrics.totalWaitingMinutes} <span className="text-xs font-normal text-slate-400">m</span></span>
                  </div>
                </div>

                {/* Estimated vs Actual Comparison Analysis */}
                <div className="bg-slate-950 p-3.5 rounded-2xl border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between pb-1 border-b border-slate-900">
                    <span className="text-[11px] font-bold text-slate-300 uppercase">Estimated vs Actual Analysis</span>
                    <span className="text-[10px] text-slate-500 font-mono">Completed Trips</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="text-[10px] text-slate-400 block">Est. Fare vs Actual Fare</span>
                      <div className="flex items-baseline space-x-1.5 mt-0.5">
                        <span className="font-mono font-bold text-white">₹{reportMetrics.actualFareTotal.toLocaleString('en-IN')}</span>
                        <span className="text-[10px] text-slate-500">vs</span>
                        <span className="font-mono text-slate-400 text-xs">₹{reportMetrics.estimatedFareTotal.toLocaleString('en-IN')}</span>
                      </div>
                      <span className={`text-[10px] font-bold ${reportMetrics.fareVariance >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {reportMetrics.fareVariance >= 0 ? '+' : ''}₹{reportMetrics.fareVariance}
                      </span>
                    </div>

                    <div>
                      <span className="text-[10px] text-slate-400 block">Est. KM vs Actual KM</span>
                      <div className="flex items-baseline space-x-1.5 mt-0.5">
                        <span className="font-mono font-bold text-sky-400">{reportMetrics.actualDistanceTotal.toFixed(1)} km</span>
                        <span className="text-[10px] text-slate-500">vs</span>
                        <span className="font-mono text-slate-400 text-xs">{reportMetrics.estimatedDistanceTotal.toFixed(1)} km</span>
                      </div>
                      <span className={`text-[10px] font-bold ${reportMetrics.distanceVariance >= 0 ? 'text-sky-400' : 'text-slate-400'}`}>
                        {reportMetrics.distanceVariance >= 0 ? '+' : ''}{reportMetrics.distanceVariance.toFixed(1)} km
                      </span>
                    </div>
                  </div>
                </div>

                {/* Driver-wise Totals Breakdowns */}
                {reportMetrics.driverTotals && reportMetrics.driverTotals.length > 0 && (
                  <div className="bg-slate-950 p-3 rounded-2xl border border-slate-800 space-y-2">
                    <span className="text-[11px] font-bold text-slate-300 uppercase block">Driver Performance Breakdown</span>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-[11px]">
                        <thead>
                          <tr className="text-slate-500 border-b border-slate-800">
                            <th className="pb-1">Driver</th>
                            <th className="pb-1 text-center">Trips</th>
                            <th className="pb-1 text-right">Distance</th>
                            <th className="pb-1 text-right">Revenue</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-900">
                          {reportMetrics.driverTotals.map((d) => (
                            <tr key={d.driverId} className="text-slate-300">
                              <td className="py-1.5 font-medium text-white">{d.driverName}</td>
                              <td className="py-1.5 text-center font-mono">{d.tripCount}</td>
                              <td className="py-1.5 text-right font-mono text-sky-400">{d.totalDistanceKm.toFixed(1)} km</td>
                              <td className="py-1.5 text-right font-mono font-bold text-emerald-400">₹{d.totalFare}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Export Report CSV Button */}
                <div className="pt-1 flex items-center justify-between">
                  <span className="text-[11px] text-slate-400 font-semibold">
                    {completedData.length} Completed Records Found
                  </span>
                  {completedData.length > 0 && (
                    <button
                      onClick={handleExportCompletedCsv}
                      className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs shadow-md transition"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download Report CSV</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })()}

          {/* TAB 5: Driver Device Management (Harden and Enhanced for Phase 2.6) */}
          {activeTab === 'devices' && (() => {
            const allDriversList = fleetDrivers.length > 0 ? fleetDrivers : [driver];
            const currentSelectedDriver = allDriversList.find(d => d.id === selectedDriverId) || driver;

            const handleRegisterDevice = async (e: React.FormEvent) => {
              e.preventDefault();
              if (!newFingerprint.trim()) {
                setDeviceError('Please enter a device fingerprint string.');
                return;
              }
              setIsRegisteringDevice(true);
              setDeviceError(null);
              setDeviceSuccess(null);
              const res = await registerDriverDevice(selectedDriverId, newFingerprint.trim(), newDeviceModel.trim() || 'Taxi Mobile');
              setIsRegisteringDevice(false);
              if (res.success) {
                setDeviceSuccess('New device fingerprint successfully authorized.');
                setNewFingerprint('');
                setNewDeviceModel('');
                fetchDevicesForDriver(selectedDriverId).then(setDriverDevicesList);
              } else {
                setDeviceError(res.error || 'Failed to register device.');
              }
            };

            return (
              <div className="space-y-4 text-xs animate-in fade-in duration-200">
                {/* Driver Selector */}
                <div className="bg-slate-950 p-3.5 rounded-2xl border border-slate-800 space-y-2">
                  <label className="text-[10px] text-slate-400 font-bold uppercase block mb-1">
                    Select Driver to Manage Devices
                  </label>
                  <select
                    value={selectedDriverId}
                    onChange={(e) => setSelectedDriverId(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-sky-500"
                  >
                    {allDriversList.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} ({d.driverCode})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Explicit Device-Provisioning Form */}
                <form onSubmit={handleRegisterDevice} className="bg-slate-950 p-4 rounded-2xl border border-sky-800/40 space-y-3">
                  <div className="flex items-center space-x-2 text-sky-400 font-bold text-xs uppercase mb-1">
                    <Shield className="w-4 h-4" />
                    <span>Authorize New Device Fingerprint</span>
                  </div>

                  {deviceError && (
                    <div className="bg-rose-950/80 text-rose-300 border border-rose-800 p-2.5 rounded-xl text-xs flex items-center space-x-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-rose-400" />
                      <span>{deviceError}</span>
                    </div>
                  )}

                  {deviceSuccess && (
                    <div className="bg-emerald-950/80 text-emerald-300 border border-emerald-800 p-2.5 rounded-xl text-xs flex items-center space-x-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
                      <span>{deviceSuccess}</span>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-slate-400 font-bold uppercase block mb-1">
                        Device Fingerprint *
                      </label>
                      <input
                        type="text"
                        required
                        value={newFingerprint}
                        onChange={(e) => setNewFingerprint(e.target.value)}
                        placeholder="e.g. DEV-SBS-9821-ANDROID"
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-sky-500 font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-400 font-bold uppercase block mb-1">
                        Device Model / Name
                      </label>
                      <input
                        type="text"
                        value={newDeviceModel}
                        onChange={(e) => setNewDeviceModel(e.target.value)}
                        placeholder="e.g. OnePlus 11 Pro"
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-sky-500"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isRegisteringDevice}
                    className="w-full py-2.5 bg-sky-600 hover:bg-sky-500 disabled:bg-slate-800 text-white font-bold rounded-xl text-xs transition shadow flex items-center justify-center space-x-1"
                  >
                    <PlusCircle className="w-3.5 h-3.5" />
                    <span>{isRegisteringDevice ? 'Authorizing Fingerprint...' : 'Authorize Device Fingerprint'}</span>
                  </button>
                </form>

                {/* Device Registry List */}
                <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-3">
                  <div className="flex items-center justify-between pb-1.5 border-b border-slate-900">
                    <span className="font-bold text-white text-xs uppercase tracking-wide">
                      Device Authorization Registry
                    </span>
                    <span className="text-[10px] text-slate-400">
                      Only one device can be ACTIVE at any time
                    </span>
                  </div>

                  {driverDevicesList.length === 0 ? (
                    <div className="text-center py-6 text-slate-500">
                      No authorized devices registered for this driver.
                    </div>
                  ) : (
                    <div className="space-y-2.5 max-h-56 overflow-y-auto no-scrollbar">
                      {driverDevicesList.map((dev) => (
                        <div key={dev.id} className="p-3 bg-slate-900/80 border border-slate-800 rounded-xl space-y-2 text-xs">
                          <div className="flex items-center justify-between">
                            <span className="font-mono font-bold text-sky-400">{dev.deviceFingerprint}</span>
                            <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase ${
                              dev.status === 'ACTIVE'
                                ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
                                : dev.status === 'SUSPENDED'
                                ? 'bg-amber-500/10 border border-amber-500/30 text-amber-400'
                                : 'bg-slate-800 text-slate-400'
                            }`}>
                              {dev.status}
                            </span>
                          </div>

                          <div className="grid grid-cols-2 gap-2 text-[10px] text-slate-400">
                            <p>Model: <strong className="text-slate-200">{dev.deviceModel || 'Unknown'}</strong></p>
                            <p className="text-right">Created: {new Date(dev.createdAt).toLocaleDateString()}</p>
                          </div>

                          <div className="pt-1.5 border-t border-slate-800 flex items-center justify-end space-x-1.5">
                            {(['ACTIVE', 'SUSPENDED', 'DEACTIVATED'] as DeviceActivationStatus[]).map((st) => (
                              <button
                                key={st}
                                type="button"
                                disabled={dev.status === st}
                                onClick={async () => {
                                  await updateDriverDeviceStatus(dev.id, st);
                                  fetchDevicesForDriver(selectedDriverId).then(setDriverDevicesList);
                                }}
                                className={`px-2 py-0.5 rounded font-bold text-[9px] transition ${
                                  dev.status === st
                                    ? 'bg-sky-600 text-white shadow-sm'
                                    : 'bg-slate-800 text-slate-400 hover:text-white border border-slate-700'
                                }`}
                              >
                                {st === 'DEACTIVATED' ? 'DEACTIVATE' : st}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* TAB 4: SQL Master Setup */}
          {activeTab === 'sql' && (
            <div className="space-y-4 text-xs">
              {/* Highlighted Driver Login Fix SQL */}
              <div className="p-4 rounded-2xl bg-gradient-to-r from-amber-500/10 via-amber-600/5 to-slate-900 border border-amber-500/30 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-amber-300 text-sm flex items-center space-x-2">
                      <Key className="w-4 h-4 text-amber-400" />
                      <span>1-Click Driver Login &amp; Auth Fix SQL</span>
                    </h3>
                    <p className="text-[11px] text-slate-300 mt-0.5">
                      Instantly provisions &amp; binds Supabase Auth accounts for <strong>DRV002</strong> and all fleet drivers with password <code className="text-amber-300 font-mono">SbsTravels@2026!</code>.
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(SBS_DRIVER_AUTH_FIX_SQL);
                      setCopiedFixSql(true);
                      setTimeout(() => setCopiedFixSql(false), 2500);
                    }}
                    className="px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs flex items-center space-x-1.5 shadow-md transition shrink-0"
                  >
                    {copiedFixSql ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedFixSql ? 'Copied Driver Fix' : 'Copy Driver Fix SQL'}</span>
                  </button>
                </div>
                <pre className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 font-mono text-[9px] text-amber-200/90 max-h-36 overflow-auto whitespace-pre">
                  {SBS_DRIVER_AUTH_FIX_SQL}
                </pre>
              </div>

              <div className="flex items-center justify-between pt-2">
                <div>
                  <h3 className="font-bold text-white">Full Database Schema &amp; RPCs</h3>
                  <p className="text-[11px] text-slate-400">
                    Run in Supabase Dashboard SQL Editor
                  </p>
                </div>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(SBS_TRAVELS_SQL_SCHEMA);
                    setCopiedSql(true);
                    setTimeout(() => setCopiedSql(false), 2500);
                  }}
                  className="px-3 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs flex items-center space-x-1.5 shadow-md"
                >
                  {copiedSql ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedSql ? 'Copied SQL' : 'Copy Full SQL'}</span>
                </button>
              </div>

              <pre className="p-3 rounded-2xl bg-slate-950 border border-slate-800 font-mono text-[10px] text-slate-300 max-h-80 overflow-auto whitespace-pre">
                {SBS_TRAVELS_SQL_SCHEMA}
              </pre>
            </div>
          )}
        </div>
          </>
        )}
      </div>
    </div>
  );
};
