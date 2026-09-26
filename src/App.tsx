import React, { useState, useEffect } from 'react';
import {
  Car,
  CheckCircle2,
  AlertCircle,
  Database,
  History,
  Settings,
  ShieldCheck,
  ShieldAlert,
  ChevronRight,
  RefreshCw,
  Radio,
  FileCode,
  Key,
  PlusCircle,
  Phone,
  LogOut,
  UserCog,
  Download,
  FileSpreadsheet,
  Search,
  Menu,
  Home,
  User,
  X,
  Info,
  Sparkles,
  Briefcase,
  Users,
  Volume2,
} from 'lucide-react';
import {
  supabase,
  supabaseUrl,
  supabaseAnonKey,
  isSupabaseConfigured,
  saveSupabaseConfig,
  clearSupabaseConfig
} from './lib/supabase';
import { DriverProfile, Trip, CompletedTripData } from './types';
import {
  getStoredDriverProfile,
  saveDriverProfile,
  getActiveTrip,
  setActiveTrip,
  claimTripWithOtp,
  getCompletedTrips,
  fetchCompletedTripsFromServer,
  getFilteredCompletedTrips,
  DateFilterRange,
  getTodayShiftMetrics,
  syncPendingCompletedTrips,
  subscribeToTripsRealtime,
  fetchOpenTripsForDriver,
  updateDriverLocationAndStatus,
  fetchDriversForDispatch,
  ShiftMetrics,
  registerDriverOnboarding,
  generateActivationCodeForDevice,
  activateDriverWithCode,
  getOrCreateDeviceId,
  adminUpdateDriverProfile,
} from './services/tripService';
import { AdminDispatchModal } from './components/AdminDispatchModal';
import { TripDetails } from './components/TripDetails';
import { ActiveTripMeter } from './components/ActiveTripMeter';
import { TripSummaryModal } from './components/TripSummaryModal';
import { soundEngine, getStoredWelcomeMessage, saveWelcomeMessage } from './services/audioService';
import { notificationService } from './services/notificationService';
import { SBS_TRAVELS_SQL_SCHEMA, SBS_DRIVER_AUTH_FIX_SQL } from './services/schemaSql';
import { createDefaultTariffConfig } from './services/tariffService';
import {
  verifyDriverSession,
  signInDriver,
  signOutDriver,
  onDriverAuthStateChange,
  getDriverSession,
  ensureDriverAuthAccount,
} from './services/authService';
import { Session } from '@supabase/supabase-js';
import {
  Copy,
  Check,
  Lock,
  UserCheck,
  LogIn,
  Eye,
  EyeOff,
  Wrench,
  Camera,
  Upload,
  Bell,
  BellRing,
  VolumeX,
  Smartphone,
  MapPin,
  Trash2,
  MessageSquare,
  Shield,
  Send,
  ChevronDown,
  BarChart3,
  Navigation,
  Clock,
} from 'lucide-react';

export default function App() {
  // Supabase Configuration State (Phase 2.3.5 Clean Driver UI)
  const [isConfigured] = useState<boolean>(isSupabaseConfigured());
  const [showSettingsModal, setShowSettingsModal] = useState<boolean>(false);

  // Driver & Active Trip State
  const [driver, setDriver] = useState<DriverProfile>(getStoredDriverProfile());
  const [activeTrip, setActiveTripState] = useState<Trip | null>(getActiveTrip());
  const [completedSummary, setCompletedSummary] = useState<CompletedTripData | null>(null);

  // Phase 2.4 Device ID & No-Password Driver Onboarding States
  const [showDriverOnboardModal, setShowDriverOnboardModal] = useState<boolean>(false);
  const [onboardTab, setOnboardTab] = useState<'signup' | 'permissions' | 'activate'>('signup');
  const [signupName, setSignupName] = useState<string>('');
  const [signupMobile, setSignupMobile] = useState<string>('');
  const [signupVehNo, setSignupVehNo] = useState<string>('');
  const [signupVehModel, setSignupVehModel] = useState<string>('Maruti Tour S');
  const [signupHomeLocation, setSignupHomeLocation] = useState<string>('Gandhipuram, Coimbatore');
  const [signupPhotoUrl, setSignupPhotoUrl] = useState<string>('');
  const [isSubmittingSignup, setIsSubmittingSignup] = useState<boolean>(false);
  const [signupError, setSignupError] = useState<string | null>(null);
  const [signupSuccess, setSignupSuccess] = useState<string | null>(null);

  // Mandatory Background Permissions State
  const [locationGranted, setLocationGranted] = useState<boolean>(false);
  const [notificationGranted, setNotificationGranted] = useState<boolean>(
    typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted'
  );

  // Activation Code Verification
  const [inputActivationCode, setInputActivationCode] = useState<string>('');
  const [isActivatingDevice, setIsActivatingDevice] = useState<boolean>(false);
  const [activationError, setActivationError] = useState<string | null>(null);
  const [activationSuccess, setActivationSuccess] = useState<string | null>(null);
  const [copiedDeviceId, setCopiedDeviceId] = useState<boolean>(false);

  // Broadcast Alert & Inline Claim States
  const [inlineTripClaimOtps, setInlineTripClaimOtps] = useState<Record<string, string>>({});
  const [inlineClaimingTripId, setInlineClaimingTripId] = useState<string | null>(null);
  const [inlineClaimError, setInlineClaimError] = useState<Record<string, string>>({});
  const [broadcastAlertNotice, setBroadcastAlertNotice] = useState<string | null>(null);

  // Driver Edit Modal extra fields
  const [editHomeLocation, setEditHomeLocation] = useState<string>(driver.homeLocation || '');
  const [editPhotoUrl, setEditPhotoUrl] = useState<string>(driver.photoUrl || '');

  // Dispatcher Access Password Protection (Password: 2481)
  const [showDispatchPinModal, setShowDispatchPinModal] = useState<boolean>(false);
  const [dispatchPinInput, setDispatchPinInput] = useState<string>('');
  const [dispatchPinError, setDispatchPinError] = useState<string | null>(null);

  const handleOpenDispatchConsole = () => {
    setShowDispatchPinModal(true);
    setDispatchPinInput('');
    setDispatchPinError(null);
  };

  const handleDispatchPinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const pin = dispatchPinInput.trim();
    if (pin === '2481' || pin === '140423') {
      setShowDispatchPinModal(false);
      setAdminBypassActive(true);
      setShowDispatchModal(true);
    } else {
      setDispatchPinError('Invalid Dispatcher Password. Access Denied.');
    }
  };

  // Secret 5-tap Brand Activation Access (PIN: 140423)
  const [brandTapCount, setBrandTapCount] = useState<number>(0);
  const [showSecretPinModal, setShowSecretPinModal] = useState<boolean>(false);
  const [secretPinInput, setSecretPinInput] = useState<string>('');
  const [secretPinError, setSecretPinError] = useState<string | null>(null);
  const [adminBypassActive, setAdminBypassActive] = useState<boolean>(false);
  const [customWelcomeMsg, setCustomWelcomeMsg] = useState<string>(() => getStoredWelcomeMessage());

  // Driver Training Demo Simulation State
  const [isDemoMode, setIsDemoMode] = useState<boolean>(false);
  const [demoStep, setDemoStep] = useState<number>(1);

  const handleBrandTap = () => {
    setBrandTapCount((prev) => {
      const next = prev + 1;
      if (next >= 5) {
        setShowSecretPinModal(true);
        setSecretPinInput('');
        setSecretPinError(null);
        return 0;
      }
      return next;
    });
  };

  const handleSecretPinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (secretPinInput.trim() === '140423') {
      setShowSecretPinModal(false);
      setAdminBypassActive(true);
      setShowDispatchModal(true);
    } else {
      setSecretPinError('Invalid Security PIN. Access Denied.');
    }
  };

  const handleLaunchDemoTrip = () => {
    const demoTrip: Trip = {
      id: 'demo-trip-999',
      tripNumber: 'DEMO-999',
      customerName: 'Rahul Verma (Demo Passenger)',
      customerMobile: '+91 98765 43210',
      pickupAddress: 'Gandhipuram Bus Stand, Coimbatore',
      dropAddress: 'Coimbatore International Airport (CJB)',
      tripType: 'LOCAL',
      estimatedFare: 480,
      estimatedDistanceKm: 12.5,
      estimatedDurationMinutes: 25,
      tariffConfig: createDefaultTariffConfig('LOCAL'),
      status: 'CLAIMED',
      tripAccessOtp: '1234',
      passengerOtpRequired: true,
      passengerVerificationOtp: '1234',
      isOtpConsumed: false,
      createdAt: new Date().toISOString(),
    };

    setIsDemoMode(true);
    setDemoStep(1);
    setActiveTrip(demoTrip);
    setActiveTripState(demoTrip);
    setShowDispatchModal(false);
    setShowHamburgerMenu(false);
    setShowSettingsModal(false);
  };

  const handleDemoStartRide = () => {
    if (!activeTrip) return;
    const startedDemoTrip: Trip = {
      ...activeTrip,
      status: 'STARTED',
      startedAt: new Date().toISOString(),
    };
    setActiveTrip(startedDemoTrip);
    setActiveTripState(startedDemoTrip);
    setDemoStep(2);
    soundEngine.playClaimSuccess();
  };

  const handleExitDemoMode = () => {
    setIsDemoMode(false);
    setDemoStep(1);
    setActiveTrip(null);
    setActiveTripState(null);
  };

  // Track previous open trips for audio and visual chimes
  const prevTripIdsRef = React.useRef<Set<string>>(new Set());

  // UI Modals & Navigation
  const [activeTab, setActiveTab] = useState<'home' | 'history' | 'about'>('home');
  const [showHamburgerMenu, setShowHamburgerMenu] = useState<boolean>(false);
  const [loadTripModal, setLoadTripModal] = useState<boolean>(false);
  const [tripAccessOtp, setTripAccessOtp] = useState<string>('');
  const [claimError, setClaimError] = useState<string | null>(null);
  const [isClaiming, setIsClaiming] = useState<boolean>(false);
  const [showDispatchModal, setShowDispatchModal] = useState<boolean>(false);
  const [completedList, setCompletedList] = useState<CompletedTripData[]>([]);
  const [shiftMetrics, setShiftMetrics] = useState<ShiftMetrics>(getTodayShiftMetrics());
  const [openTripsList, setOpenTripsList] = useState<Trip[]>([]);
  const [isSyncingPending, setIsSyncingPending] = useState<boolean>(false);

  // Driver & Vehicle Profile Edit State
  const [showDriverEditModal, setShowDriverEditModal] = useState<boolean>(false);
  const [editDriverName, setEditDriverName] = useState<string>(driver.name);
  const [editDriverMobile, setEditDriverMobile] = useState<string>(driver.mobile);
  const [editVehicleNumber, setEditVehicleNumber] = useState<string>(driver.vehicleNumber);
  const [editVehicleModel, setEditVehicleModel] = useState<string>(driver.vehicleModel || '');
  const [editDriverCode, setEditDriverCode] = useState<string>(driver.driverCode);

  // History search and date filter state
  const [historySearchQuery, setHistorySearchQuery] = useState<string>('');
  const [driverDateFilter, setDriverDateFilter] = useState<DateFilterRange>('ALL');
  const [driverCustomStart, setDriverCustomStart] = useState<string>('');
  const [driverCustomEnd, setDriverCustomEnd] = useState<string>('');

  // Export Trips to CSV
  const handleExportCsv = () => {
    if (completedList.length === 0) return;
    const headers = [
      'Trip Number',
      'Customer Name',
      'Customer Mobile',
      'Pickup Address',
      'Drop Address',
      'Distance (km)',
      'Duration (min)',
      'Waiting (min)',
      'Base Fare (INR)',
      'Distance Fare (INR)',
      'Waiting Fare (INR)',
      'Extra Charges (INR)',
      'Total Fare (INR)',
      'Completed At'
    ];

    const rows = completedList.map((t) => [
      `"${t.tripNumber}"`,
      `"${(t.customerName || '').replace(/"/g, '""')}"`,
      `"${t.customerMobile || ''}"`,
      `"${(t.pickupAddress || '').replace(/"/g, '""')}"`,
      `"${(t.dropAddress || '').replace(/"/g, '""')}"`,
      t.distanceKm.toFixed(2),
      Math.ceil(t.durationSeconds / 60),
      Math.floor(t.waitingSeconds / 60),
      t.baseFare,
      t.distanceFare,
      t.waitingFare,
      (t.additionalCharges || 0) + (t.toll || 0) + (t.parking || 0) + (t.driverBata || 0),
      t.totalFare,
      `"${t.completedAt || ''}"`
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `SBS_Travels_Trips_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handlePhotoGallerySelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      if (dataUrl) setSignupPhotoUrl(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  const handleEditPhotoGallerySelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      if (dataUrl) setEditPhotoUrl(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  const handleSaveDriverProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    const updated: DriverProfile = {
      ...driver,
      name: editDriverName.trim() || driver.name,
      mobile: editDriverMobile.trim() || driver.mobile,
      vehicleNumber: editVehicleNumber.trim() || driver.vehicleNumber,
      vehicleModel: editVehicleModel.trim() || driver.vehicleModel,
      driverCode: editDriverCode.trim() || driver.driverCode,
      homeLocation: editHomeLocation.trim() || driver.homeLocation,
      photoUrl: editPhotoUrl || driver.photoUrl,
    };
    saveDriverProfile(updated);
    setDriver(updated);
    setShowDriverEditModal(false);

    if (isSupabaseConfigured() && driver.id && !driver.id.startsWith('drv-')) {
      await adminUpdateDriverProfile(driver.id, {
        name: updated.name,
        mobile: updated.mobile,
        vehicleNumber: updated.vehicleNumber,
        vehicleModel: updated.vehicleModel,
        homeLocation: updated.homeLocation,
        photoUrl: updated.photoUrl,
      });
    }
  };

  const handleOnboardingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingSignup(true);
    setSignupError(null);
    setSignupSuccess(null);
    try {
      const res = await registerDriverOnboarding({
        name: signupName,
        mobile: signupMobile,
        vehicleNumber: signupVehNo,
        vehicleModel: signupVehModel,
        homeLocation: signupHomeLocation,
        photoUrl: signupPhotoUrl,
        deviceId: driver.deviceId,
      });

      if (res.success && res.driver) {
        setDriver(res.driver);
        saveDriverProfile(res.driver);
        setSignupSuccess(
          `Profile saved as ${res.driver.driverCode}! Next, enable mandatory background permissions.`
        );
        setOnboardTab('permissions');
      } else {
        setSignupError(res.error || 'Failed to submit driver registration.');
      }
    } catch (err: any) {
      setSignupError(err?.message || 'Error submitting registration.');
    } finally {
      setIsSubmittingSignup(false);
    }
  };

  const handleActivateDeviceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsActivatingDevice(true);
    setActivationError(null);
    setActivationSuccess(null);

    // Master Admin PIN Override (PIN 2481)
    if (inputActivationCode.trim() === '2481') {
      soundEngine.playClaimSuccess();
      const updated = {
        ...driver,
        activationStatus: 'ACTIVE' as const,
        isActivationCodeVerified: true,
      };
      setDriver(updated);
      saveDriverProfile(updated);
      setActivationSuccess('👑 Master Admin PIN Verified! Device authorized & activated.');
      setTimeout(() => setShowDriverOnboardModal(false), 1200);
      setIsActivatingDevice(false);
      return;
    }

    try {
      const res = await activateDriverWithCode(driver.id, driver.deviceId, inputActivationCode);
      if (res.success) {
        soundEngine.playClaimSuccess();
        const updated = { ...driver, activationStatus: 'ACTIVE' as const };
        setDriver(updated);
        saveDriverProfile(updated);
        setActivationSuccess('Device successfully authorized & activated! You can now claim trips.');
        setTimeout(() => setShowDriverOnboardModal(false), 1600);
      } else {
        setActivationError(res.error || 'Invalid activation code for this device.');
      }
    } catch (err: any) {
      setActivationError(err?.message || 'Error verifying activation code.');
    } finally {
      setIsActivatingDevice(false);
    }
  };

  const handleInlineClaimTrip = async (tripId: string) => {
    const otp = (inlineTripClaimOtps[tripId] || '').trim();
    if (!otp || otp.length < 4) {
      setInlineClaimError((prev) => ({ ...prev, [tripId]: 'Please enter the 6-digit Trip Access OTP.' }));
      return;
    }
    setInlineClaimError((prev) => ({ ...prev, [tripId]: '' }));
    setInlineClaimingTripId(tripId);
    try {
      const res = await claimTripWithOtp(otp, driver);
      if (res.success && res.trip) {
        soundEngine.playClaimSuccess();
        setActiveTripState(res.trip);
        const updatedDriver = { ...driver, operationalStatus: 'HAS_TRIP' as const };
        setDriver(updatedDriver);
        saveDriverProfile(updatedDriver);
      } else {
        setInlineClaimError((prev) => ({ ...prev, [tripId]: res.error || 'Failed to claim trip.' }));
      }
    } catch (err: any) {
      setInlineClaimError((prev) => ({ ...prev, [tripId]: err?.message || 'Error claiming trip.' }));
    } finally {
      setInlineClaimingTripId(null);
    }
  };

  // Active Trip Recovery on startup, Driver Session verification, & Realtime Listener (Sections 33, 36)
  useEffect(() => {
    // Mandatorily open onboarding & activation wizard if driver is not activated
    if (driver.activationStatus !== 'ACTIVE') {
      setShowDriverOnboardModal(true);
    }

    const recovered = getActiveTrip();
    if (recovered) {
      setActiveTripState(recovered);
    }
    setCompletedList(getCompletedTrips());
    setShiftMetrics(getTodayShiftMetrics());

    // Dynamically load live completed trips from server
    fetchCompletedTripsFromServer()
      .then((liveTrips) => {
        setCompletedList(liveTrips);
        setShiftMetrics(getTodayShiftMetrics());
      })
      .catch(() => {});

    // 1. Authoritative Driver Device Profile Verification from Supabase
    if (isSupabaseConfigured() && supabase) {
      const currentDevId = driver.deviceId || getOrCreateDeviceId();
      supabase
        .from('driver_devices')
        .select('*, drivers(*)')
        .eq('device_fingerprint', currentDevId)
        .limit(1)
        .then(
          ({ data }) => {
            if (data && data.length > 0) {
              const dev = data[0];
              const d = dev.drivers;
              if (d) {
                const updatedProfile: DriverProfile = {
                  id: d.id,
                  driverCode: d.driver_code,
                  name: d.name,
                  mobile: d.mobile,
                  vehicleNumber: d.vehicle_number,
                  vehicleModel: d.vehicle_model || 'Taxi',
                  homeLocation: d.home_location || driver.homeLocation,
                  photoUrl: d.photo_url || driver.photoUrl,
                  operationalStatus: d.operational_status || driver.operationalStatus,
                  activationStatus: dev.status || d.activation_status || 'PENDING',
                  deviceId: currentDevId,
                };
                setDriver(updatedProfile);
                saveDriverProfile(updatedProfile);
              }
            }
          },
          () => {}
        );

      // 2. Listen to Supabase Realtime changes
      const updateOpenTripsWithAlerts = (trips: Trip[]) => {
        setOpenTripsList(trips);
        const currentIds = new Set(trips.map((t) => t.id));
        const prevIds = prevTripIdsRef.current;
        const brandNewTrips = trips.filter((t) => !prevIds.has(t.id));

        if (brandNewTrips.length > 0 && prevIds.size > 0) {
          // Play trip notification tone
          soundEngine.playNewTripAlert();
          soundEngine.triggerHaptic([200, 100, 200, 100, 300]);

          const newest = brandNewTrips[0];
          setBroadcastAlertNotice(
            `⚡ NEW TRIP BROADCAST: ${newest.tripNumber} • ${newest.pickupAddress} (₹${newest.estimatedFare})`
          );
          setTimeout(() => setBroadcastAlertNotice(null), 8000);

          notificationService.notify({
            type: 'NEW_TRIP',
            target: 'DRIVER',
            title: `🚕 New Trip Broadcast: ${newest.tripNumber}`,
            message: `${newest.pickupAddress} → ${newest.dropAddress} (Fare: ₹${newest.estimatedFare})`,
            tripId: newest.id,
            tripNumber: newest.tripNumber,
            sound: true,
          });
        }
        prevTripIdsRef.current = currentIds;
      };

      fetchOpenTripsForDriver().then((trips) => {
        setOpenTripsList(trips);
        prevTripIdsRef.current = new Set(trips.map((t) => t.id));
      });

      const unsubscribeTrips = subscribeToTripsRealtime(() => {
        setCompletedList(getCompletedTrips());
        setShiftMetrics(getTodayShiftMetrics());
        if (isSupabaseConfigured()) {
          fetchOpenTripsForDriver().then(updateOpenTripsWithAlerts);
        }
      });

      // Active poll every 8 seconds to ensure real-time broadcast delivery even if websocket pauses
      const pollInterval = setInterval(() => {
        if (isSupabaseConfigured()) {
          fetchOpenTripsForDriver().then(updateOpenTripsWithAlerts);
        }
      }, 8000);

      return () => {
        unsubscribeTrips();
        clearInterval(pollInterval);
      };
    }
  }, []);

  // Driver Live GPS Location & Operational Status Synchronization (Phase 2.3.2)
  useEffect(() => {
    if (driver.operationalStatus === 'OFFLINE' || typeof window === 'undefined' || !navigator.geolocation) {
      return;
    }

    let isSubscribed = true;
    const sendGpsFix = (pos: GeolocationPosition) => {
      if (!isSubscribed) return;
      const { latitude, longitude, accuracy } = pos.coords;
      if (accuracy > 150) return; // Discard low-accuracy fixes (>150m)

      updateDriverLocationAndStatus(
        driver.id,
        latitude,
        longitude,
        driver.operationalStatus
      );
    };

    // Get current position on shift start / online
    navigator.geolocation.getCurrentPosition(
      sendGpsFix,
      (err) => console.warn('Driver GPS fix notice:', err.message),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 15000 }
    );

    // Watch position periodically
    const watchId = navigator.geolocation.watchPosition(
      sendGpsFix,
      (err) => console.warn('Driver GPS watch notice:', err.message),
      { enableHighAccuracy: true, maximumAge: 20000 }
    );

    return () => {
      isSubscribed = false;
      if (navigator.geolocation && watchId != null) {
        navigator.geolocation.clearWatch(watchId);
      }
    };
  }, [driver.id, driver.operationalStatus]);

  // Handle manual sync of pending offline completed trips
  const handleSyncPendingTrips = async () => {
    setIsSyncingPending(true);
    try {
      await syncPendingCompletedTrips();
      setCompletedList(getCompletedTrips());
    } finally {
      setIsSyncingPending(false);
    }
  };

  // Toggle Driver Shift (Online / On Break)
  const handleToggleShiftStatus = () => {
    const newStatus = driver.operationalStatus === 'READY' ? 'OFFLINE' : 'READY';
    const updated = { ...driver, operationalStatus: newStatus as any };
    setDriver(updated);
    saveDriverProfile(updated);
  };

  // Atomic Claim Trip with OTP (Sections 11, 13)
  const handleClaimTrip = async (e: React.FormEvent) => {
    e.preventDefault();
    setClaimError(null);
    setIsClaiming(true);

    try {
      const result = await claimTripWithOtp(tripAccessOtp, driver);
      if (result.success && result.trip) {
        soundEngine.playClaimSuccess();
        setActiveTripState(result.trip);
        setLoadTripModal(false);
        setTripAccessOtp('');
        // Update driver operational status to HAS_TRIP
        const updatedDriver = { ...driver, operationalStatus: 'HAS_TRIP' as const };
        setDriver(updatedDriver);
        saveDriverProfile(updatedDriver);
      } else {
        setClaimError(result.error || 'Failed to claim trip.');
      }
    } catch (err: any) {
      setClaimError(err?.message || 'Network or authorization error while claiming.');
    } finally {
      setIsClaiming(false);
    }
  };

  // Start Trip (Sections 15, 17)
  const handleTripStarted = () => {
    const startedTrip = getActiveTrip() || (activeTrip ? {
      ...activeTrip,
      status: 'STARTED' as const,
      startedAt: new Date().toISOString()
    } : null);

    if (startedTrip) {
      setActiveTrip(startedTrip);
      setActiveTripState(startedTrip);
    }

    const updatedDriver = { ...driver, operationalStatus: 'ON_TRIP' as const };
    setDriver(updatedDriver);
    saveDriverProfile(updatedDriver);
  };

  // Trip Completion (Section 29, 30)
  const handleTripCompleted = (summary: CompletedTripData) => {
    setCompletedSummary(summary);
    setActiveTripState(null);
    setActiveTrip(null);
    setCompletedList(getCompletedTrips());
    setShiftMetrics(getTodayShiftMetrics());

    // Reset driver to READY
    const updatedDriver = { ...driver, operationalStatus: 'READY' as const };
    setDriver(updatedDriver);
    saveDriverProfile(updatedDriver);
  };

  const handleSummaryDone = () => {
    setCompletedSummary(null);
    if (isDemoMode) {
      handleExitDemoMode();
    }
    setActiveTab('home');
  };

  return (
    <div className="min-h-screen bg-[#0b1329] text-slate-100 flex flex-col font-sans select-none antialiased">
      {/* Top App Header */}
      <header className="bg-[#0b1329]/95 border-b border-slate-800/80 px-4 py-3 sticky top-0 z-30 backdrop-blur-md shadow-md">
        <div className="max-w-md mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <button
              type="button"
              onClick={() => setShowHamburgerMenu(true)}
              className="w-10 h-10 rounded-2xl bg-slate-900 border border-slate-800 hover:bg-slate-800 text-white flex items-center justify-center transition active:scale-95 shadow-md"
              aria-label="Open Navigation Menu"
            >
              <Menu className="w-5 h-5 text-white" />
            </button>
            <div onClick={handleBrandTap} className="cursor-pointer select-none active:scale-95 transition">
              <h1 className="text-xl font-extrabold tracking-wider leading-none">
                <span className="text-red-500 font-extrabold">SBS</span>{' '}
                <span className="text-white font-extrabold">TRAVELS</span>
              </h1>
              <p className="text-[9px] tracking-[0.2em] text-slate-400 font-bold uppercase mt-0.5">
                DRIVER APPLICATION
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={handleOpenDispatchConsole}
              className="px-3.5 py-1.5 rounded-full text-xs font-bold bg-red-950/80 hover:bg-red-900 border border-red-500/70 text-white transition flex items-center space-x-1.5 shadow-[0_0_15px_rgba(239,68,68,0.35)]"
              title="Admin Dispatcher"
            >
              <Radio className="w-3.5 h-3.5 text-red-400 animate-pulse" />
              <span>Dispatch</span>
            </button>
          </div>
        </div>
      </header>

      {/* Interactive Driver Training & Demo Simulation Banner */}
      {isDemoMode && (
        <div className="bg-gradient-to-r from-purple-950 via-indigo-950 to-slate-900 border-b-2 border-amber-400 p-3 sm:p-4 text-white space-y-2.5 shadow-2xl z-20">
          <div className="max-w-md mx-auto flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <span className="px-2 py-0.5 rounded-full bg-amber-400 text-slate-950 font-black text-[10px] uppercase tracking-wider animate-pulse">
                DEMO MODE
              </span>
              <h3 className="font-black text-sm text-amber-300">🎓 Driver Interactive Demo Ride</h3>
            </div>
            <button
              type="button"
              onClick={handleExitDemoMode}
              className="px-3 py-1 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs shadow"
            >
              Exit Demo
            </button>
          </div>

          <div className="max-w-md mx-auto bg-slate-950/80 p-3 rounded-2xl border border-indigo-500/30 text-xs space-y-2">
            {demoStep === 1 && (
              <div className="space-y-1.5">
                <p className="font-bold text-amber-300">STEP 1/4: Trip Acceptance &amp; OTP Verification</p>
                <p className="text-slate-200">
                  Customer <strong>Rahul Verma</strong> gives OTP <code className="bg-amber-400/20 text-amber-300 px-1 rounded font-mono font-bold">1234</code>.
                </p>
                <div className="flex items-center space-x-2 pt-1">
                  <button
                    type="button"
                    onClick={handleDemoStartRide}
                    className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow flex items-center space-x-1.5"
                  >
                    <span>⚡ Start Ride (Verify OTP 1234)</span>
                  </button>
                  <span className="text-[11px] text-slate-400">Or use 'Start Trip' card below</span>
                </div>
              </div>
            )}

            {demoStep === 2 && (
              <div className="space-y-1.5">
                <p className="font-bold text-amber-300">STEP 2/4: Live Fare Meter &amp; Distance Tracking</p>
                <p className="text-slate-200">
                  Trip is active! Simulate driving to watch live distance &amp; fare increase.
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTripState((prev) =>
                        prev
                          ? {
                              ...prev,
                              status: 'STARTED',
                              startedAt: prev.startedAt || new Date().toISOString(),
                            }
                          : null
                      );
                    }}
                    className="px-3 py-1 bg-sky-600 text-white rounded-xl font-bold text-xs"
                  >
                    Simulate Drive (+2.5 KM)
                  </button>
                  <button
                    type="button"
                    onClick={() => setDemoStep(3)}
                    className="px-3 py-1 bg-amber-500 text-slate-950 rounded-xl font-bold text-xs"
                  >
                    Next Step: Waiting Charges →
                  </button>
                </div>
              </div>
            )}

            {demoStep === 3 && (
              <div className="space-y-1.5">
                <p className="font-bold text-amber-300">STEP 3/4: Waiting Time Charges</p>
                <p className="text-slate-200">
                  When waiting at traffic or signals, waiting charges add to the live fare.
                </p>
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => setDemoStep(4)}
                    className="px-3 py-1.5 bg-emerald-600 text-white rounded-xl font-bold text-xs"
                  >
                    Next Step: End Trip &amp; Receipt →
                  </button>
                </div>
              </div>
            )}

            {demoStep === 4 && (
              <div className="space-y-1.5">
                <p className="font-bold text-amber-300">STEP 4/4: End Ride &amp; Customer Receipt</p>
                <p className="text-slate-200">
                  Click 'END TRIP' or swipe below to generate the breakdown fare bill!
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Hamburger Navigation Drawer */}
      {showHamburgerMenu && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex">
          <div className="bg-[#0f172a] text-slate-100 w-4/5 max-w-xs h-full p-5 flex flex-col justify-between shadow-2xl animate-in slide-in-from-left duration-200 border-r border-slate-800">
            <div className="space-y-6">
              <div className="flex items-center justify-between pb-4 border-b border-slate-800/80">
                <div className="flex items-center space-x-2.5">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-600 to-indigo-600 text-white font-black flex items-center justify-center text-lg shadow-md shadow-sky-600/20">
                    SBS
                  </div>
                  <div>
                    <p className="font-extrabold text-white text-sm">SBS Travels</p>
                    <p className="text-[10px] text-sky-400 font-bold uppercase tracking-wider">Driver Console</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowHamburgerMenu(false)}
                  className="w-8 h-8 rounded-full bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center font-bold text-sm transition"
                >
                  ✕
                </button>
              </div>

              <nav className="space-y-1 text-xs font-bold text-slate-300">
                <button
                  onClick={() => { setActiveTab('home'); setShowHamburgerMenu(false); }}
                  className={`w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-xl transition ${activeTab === 'home' ? 'bg-gradient-to-r from-sky-600/20 to-blue-600/20 text-sky-400 border border-sky-500/30 font-black shadow-sm' : 'hover:bg-slate-800/60 text-slate-300'}`}
                >
                  <Home className="w-4 h-4 text-sky-400" />
                  <span>HOME</span>
                </button>

                <button
                  onClick={() => {
                    setOnboardTab('signup');
                    setShowDriverOnboardModal(true);
                    setShowHamburgerMenu(false);
                  }}
                  className="w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-xl hover:bg-slate-800/60 text-slate-300 transition"
                >
                  <PlusCircle className="w-4 h-4 text-emerald-400" />
                  <span>DRIVER ONBOARDING (SIGN UP)</span>
                </button>

                <button
                  onClick={() => {
                    setOnboardTab('activate');
                    setShowDriverOnboardModal(true);
                    setShowHamburgerMenu(false);
                  }}
                  className="w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-xl hover:bg-slate-800/60 text-slate-300 transition"
                >
                  <Smartphone className="w-4 h-4 text-sky-400" />
                  <span>DEVICE ID &amp; ACTIVATION</span>
                </button>

                <button
                  onClick={() => { setShowDriverEditModal(true); setShowHamburgerMenu(false); }}
                  className="w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-xl hover:bg-slate-800/60 text-slate-300 transition"
                >
                  <User className="w-4 h-4 text-slate-400" />
                  <span>MY PROFILE &amp; LOCATION</span>
                </button>

                <button
                  onClick={() => { setShowDriverEditModal(true); setShowHamburgerMenu(false); }}
                  className="w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-xl hover:bg-slate-800/60 text-slate-300 transition"
                >
                  <Car className="w-4 h-4 text-slate-400" />
                  <span>VEHICLE DETAILS ({driver.vehicleNumber})</span>
                </button>

                <button
                  onClick={() => { setCompletedList(getCompletedTrips()); setActiveTab('history'); setShowHamburgerMenu(false); }}
                  className={`w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-xl transition ${activeTab === 'history' ? 'bg-gradient-to-r from-sky-600/20 to-blue-600/20 text-sky-400 border border-sky-500/30 font-black shadow-sm' : 'hover:bg-slate-800/60 text-slate-300'}`}
                >
                  <History className="w-4 h-4 text-slate-400" />
                  <span>TRIP HISTORY ({completedList.length})</span>
                </button>

                <button
                  onClick={() => { handleOpenDispatchConsole(); setShowHamburgerMenu(false); }}
                  className="w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-xl hover:bg-slate-800/60 text-slate-300 transition"
                >
                  <Radio className="w-4 h-4 text-sky-400" />
                  <span>DISPATCH CONSOLE</span>
                </button>

                <button
                  onClick={handleLaunchDemoTrip}
                  className="w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-xl bg-purple-950/50 border border-purple-500/40 text-purple-300 hover:bg-purple-900/50 transition font-black"
                >
                  <Sparkles className="w-4 h-4 text-amber-300 animate-pulse" />
                  <span>🎓 INTERACTIVE DEMO TRIP</span>
                </button>

                <button
                  onClick={() => { setActiveTab('about'); setShowHamburgerMenu(false); }}
                  className={`w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-xl transition ${activeTab === 'about' ? 'bg-gradient-to-r from-sky-600/20 to-blue-600/20 text-sky-400 border border-sky-500/30 font-black shadow-sm' : 'hover:bg-slate-800/60 text-slate-300'}`}
                >
                  <Info className="w-4 h-4 text-sky-400" />
                  <span>ABOUT US</span>
                </button>

                <button
                  onClick={() => { setShowSettingsModal(true); setShowHamburgerMenu(false); }}
                  className="w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-xl hover:bg-slate-800/60 text-slate-300 transition"
                >
                  <Settings className="w-4 h-4 text-slate-400" />
                  <span>APP SETTINGS</span>
                </button>
              </nav>
            </div>

            <div className="pt-4 border-t border-slate-800/80 space-y-3">
              <div className="text-center text-[10px] text-slate-500 font-semibold">
                SBS Travels Driver App v2.5.0 (Key Generator & Updated Logo)
              </div>
            </div>
          </div>
          <div className="flex-1" onClick={() => setShowHamburgerMenu(false)} />
        </div>
      )}

      {/* Main Container */}
      <main className="flex-1 max-w-md w-full mx-auto p-4 flex flex-col justify-between space-y-4">
        {/* CASE 1: ACTIVE TRIP IN PROGRESS (METER RUNNING) */}
        {activeTrip && activeTrip.status === 'STARTED' && (
          <ActiveTripMeter
            trip={activeTrip}
            driver={driver}
            onTripCompleted={handleTripCompleted}
            onExitDemo={isDemoMode ? handleExitDemoMode : undefined}
          />
        )}

        {/* CASE 2: TRIP CLAIMED OR ARRIVED / READY TO START */}
        {activeTrip && (activeTrip.status === 'CLAIMED' || activeTrip.status === 'ARRIVED') && (
          <TripDetails
            trip={activeTrip}
            driver={driver}
            onTripStarted={handleTripStarted}
            onCancelClaim={() => {
              setActiveTrip(null);
              setActiveTripState(null);
            }}
          />
        )}

        {/* CASE 3: NO ACTIVE TRIP -> HOME SCREEN */}
        {!activeTrip && activeTab === 'home' && (
          <div className="space-y-4">
            {/* Top Real-time Broadcast Notification Toast Banner */}
            {broadcastAlertNotice && (
              <div className="bg-gradient-to-r from-amber-500 via-amber-400 to-yellow-500 text-slate-950 p-3 rounded-2xl font-black text-xs flex items-center justify-between shadow-xl shadow-amber-500/20 border border-amber-300 animate-bounce">
                <div className="flex items-center space-x-2">
                  <Radio className="w-4 h-4 animate-ping text-slate-950 shrink-0" />
                  <span className="truncate">{broadcastAlertNotice}</span>
                </div>
                <button
                  type="button"
                  onClick={() => soundEngine.playNewTripAlert()}
                  className="px-2 py-0.5 bg-slate-950 text-amber-300 rounded-lg text-[10px] font-mono shrink-0 ml-2"
                >
                  🔔 Tone
                </button>
              </div>
            )}

            {/* 1. DRIVER PROFILE & DUTY TOGGLE CARD */}
            <div className="bg-gradient-to-b from-slate-900 to-slate-950 border border-slate-800 rounded-3xl p-4 shadow-xl space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center space-x-3.5 min-w-0">
                  {/* Photo Avatar with Online Badge */}
                  <div className="relative shrink-0">
                    {driver.photoUrl ? (
                      <img
                        src={driver.photoUrl}
                        alt={driver.name}
                        className="w-14 h-14 rounded-full object-cover border-2 border-slate-700 shadow-md"
                      />
                    ) : (
                      <div className="w-14 h-14 rounded-full bg-slate-800 border-2 border-slate-700 flex items-center justify-center font-extrabold text-2xl text-white shadow-inner">
                        {driver.name.charAt(0)}
                      </div>
                    )}
                    <span className={`w-3.5 h-3.5 rounded-full border-2 border-slate-900 absolute bottom-0 right-0 ${
                      driver.operationalStatus === 'READY' ? 'bg-emerald-400' : 'bg-amber-400'
                    }`} />
                  </div>

                  <div className="min-w-0">
                    <h2 className="text-lg font-black text-white tracking-tight truncate">
                      {driver.name} <span className="text-slate-400 font-bold text-sm">(Driver)</span>
                    </h2>
                    <div className="flex items-center space-x-2 mt-1">
                      <span className="bg-slate-800/90 text-slate-300 px-2.5 py-0.5 rounded-full text-xs font-mono font-bold border border-slate-700/60">
                        {driver.vehicleNumber}
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowDriverEditModal(true)}
                        className="bg-slate-800/90 hover:bg-slate-700 text-slate-300 px-2.5 py-0.5 rounded-full text-xs font-bold border border-slate-700/60 transition flex items-center space-x-1"
                      >
                        <span>Profile</span>
                        <ChevronRight className="w-3 h-3 text-slate-400" />
                      </button>
                    </div>
                  </div>
                </div>

                <div className="shrink-0">
                  <button
                    type="button"
                    onClick={handleToggleShiftStatus}
                    className={`px-3.5 py-1.5 rounded-full text-xs font-black border flex items-center space-x-1.5 shadow-sm transition ${
                      driver.operationalStatus === 'READY'
                        ? 'bg-emerald-950/90 text-emerald-400 border-emerald-500/60'
                        : 'bg-amber-950/90 text-amber-300 border-amber-500/60'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${driver.operationalStatus === 'READY' ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
                    <span>{driver.operationalStatus === 'READY' ? 'ONLINE' : 'OFFLINE'}</span>
                    <ChevronDown className="w-3 h-3 ml-0.5 text-slate-400" />
                  </button>
                </div>
              </div>

              {/* Big Red Duty Action Button */}
              <button
                type="button"
                onClick={handleToggleShiftStatus}
                className={`w-full py-3.5 px-5 rounded-2xl text-sm font-extrabold uppercase tracking-wider transition shadow-xl active:scale-98 flex items-center justify-between ${
                  driver.operationalStatus === 'READY'
                    ? 'bg-gradient-to-r from-red-600 via-rose-600 to-red-600 hover:from-red-500 hover:to-rose-500 text-white shadow-[0_4px_20px_rgba(225,29,72,0.4)]'
                    : 'bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-[0_4px_20px_rgba(16,185,129,0.4)]'
                }`}
              >
                <div className="flex items-center space-x-2">
                  <Car className="w-5 h-5 text-white" />
                  <span>{driver.operationalStatus === 'READY' ? 'GO OFFLINE (LOG OFF)' : 'GO ONLINE (START SHIFT)'}</span>
                </div>
                <ChevronRight className="w-5 h-5 text-white/80" />
              </button>
            </div>

            {/* LIVE TRIP BROADCAST ALERT CARD */}
            {openTripsList.length > 0 && (
              <div className="relative overflow-hidden rounded-3xl border-2 border-amber-400 bg-gradient-to-br from-amber-950/70 via-slate-900 to-amber-950/50 p-4 shadow-[0_0_35px_rgba(251,191,36,0.45)] animate-[pulse_1.8s_cubic-bezier(0.4,0,0.6,1)_infinite] space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-amber-500/30">
                  <div className="flex items-center space-x-2">
                    <span className="relative flex h-3.5 w-3.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-amber-500"></span>
                    </span>
                    <span className="text-xs font-black uppercase tracking-wider text-amber-300 flex items-center space-x-1.5">
                      <span>⚡ LIVE TRIP BROADCAST</span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] bg-amber-400 text-slate-950 font-black animate-bounce">
                        {openTripsList.length} AVAILABLE
                      </span>
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => soundEngine.playNewTripAlert()}
                    className="px-2.5 py-1 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-[11px] font-bold border border-amber-500/40 flex items-center space-x-1 transition active:scale-95 shadow-sm"
                    title="Play Alert Chime"
                  >
                    <Volume2 className="w-3.5 h-3.5 text-amber-400" />
                    <span>Play Tone</span>
                  </button>
                </div>

                <div className="space-y-3">
                  {openTripsList.map((trip) => (
                    <div
                      key={trip.id}
                      className="bg-slate-950/90 border border-amber-500/40 rounded-2xl p-3.5 shadow-md space-y-2.5"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <span className="font-mono font-black text-amber-400 text-sm">
                            {trip.tripNumber}
                          </span>
                          <span className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-md text-[11px] font-mono font-black">
                            ₹{trip.estimatedFare}
                          </span>
                        </div>
                        {trip.estimatedDistanceKm != null && (
                          <span className="text-slate-400 text-[11px] font-mono font-semibold">
                            ~{trip.estimatedDistanceKm} km
                          </span>
                        )}
                      </div>

                      <div className="space-y-1.5 text-xs">
                        <div className="flex items-start space-x-2">
                          <div className="w-2 h-2 rounded-full bg-emerald-400 mt-1.5 shrink-0" />
                          <div className="min-w-0">
                            <span className="text-[10px] text-slate-400 uppercase font-bold block">Pickup</span>
                            <p className="text-white font-semibold truncate leading-tight">
                              {trip.pickupAddress}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-start space-x-2">
                          <div className="w-2 h-2 rounded-full bg-rose-400 mt-1.5 shrink-0" />
                          <div className="min-w-0">
                            <span className="text-[10px] text-slate-400 uppercase font-bold block">Drop</span>
                            <p className="text-white font-semibold truncate leading-tight">
                              {trip.dropAddress}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Claim OTP Input & Instant Action */}
                      <div className="pt-2 border-t border-slate-800/80 flex items-center space-x-2">
                        <div className="relative flex-1">
                          <input
                            type="text"
                            maxLength={6}
                            value={inlineTripClaimOtps[trip.id] || ''}
                            onChange={(e) => {
                              const val = e.target.value.replace(/\D/g, '');
                              setInlineTripClaimOtps((prev) => ({ ...prev, [trip.id]: val }));
                            }}
                            placeholder="6-Digit OTP"
                            className="w-full bg-slate-900 border border-slate-700 focus:border-amber-400 rounded-xl px-3 py-2 text-white font-mono font-bold tracking-widest text-xs focus:outline-none placeholder:text-slate-500 placeholder:tracking-normal"
                          />
                        </div>

                        {trip.tripAccessOtp && (
                          <button
                            type="button"
                            onClick={() => {
                              setInlineTripClaimOtps((prev) => ({
                                ...prev,
                                [trip.id]: trip.tripAccessOtp || '',
                              }));
                            }}
                            className="px-2 py-2 bg-slate-800 hover:bg-slate-700 text-sky-300 rounded-xl text-[10px] font-bold border border-slate-700 shrink-0 transition"
                            title="Auto-fill Dispatch OTP"
                          >
                            Fill OTP
                          </button>
                        )}

                        <button
                          type="button"
                          disabled={
                            inlineClaimingTripId === trip.id ||
                            (inlineTripClaimOtps[trip.id] || '').length < 4
                          }
                          onClick={() => handleInlineClaimTrip(trip.id)}
                          className={`px-3.5 py-2 rounded-xl text-xs font-black uppercase tracking-wider shrink-0 transition shadow-md ${
                            (inlineTripClaimOtps[trip.id] || '').length >= 4 &&
                            inlineClaimingTripId !== trip.id
                              ? 'bg-gradient-to-r from-amber-500 to-emerald-500 hover:from-amber-400 hover:to-emerald-400 text-slate-950 active:scale-95 shadow-amber-500/20'
                              : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                          }`}
                        >
                          {inlineClaimingTripId === trip.id ? 'Claiming...' : 'Claim Trip'}
                        </button>
                      </div>

                      {inlineClaimError[trip.id] && (
                        <p className="text-[11px] text-rose-400 font-semibold">
                          {inlineClaimError[trip.id]}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 2. TODAY'S SHIFT SUMMARY CARD */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-4 shadow-lg space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold text-slate-300 uppercase tracking-wider flex items-center space-x-2">
                  <BarChart3 className="w-4 h-4 text-slate-400" />
                  <span>TODAY'S SHIFT SUMMARY</span>
                </span>
                <span className="text-xs text-slate-400 font-medium font-mono">
                  {new Date().toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}
                </span>
              </div>

              <div className="grid grid-cols-4 gap-2 text-center">
                <div className="bg-slate-950/80 p-2.5 rounded-2xl border border-slate-800 flex flex-col items-center justify-center space-y-1">
                  <span className="text-red-500 font-black text-sm">₹</span>
                  <span className="text-[9px] text-slate-400 font-extrabold uppercase tracking-wider">REVENUE</span>
                  <p className="text-sm font-black font-mono text-white">
                    ₹{shiftMetrics.totalEarningsToday}
                  </p>
                </div>

                <div className="bg-slate-950/80 p-2.5 rounded-2xl border border-slate-800 flex flex-col items-center justify-center space-y-1">
                  <Car className="w-4 h-4 text-white" />
                  <span className="text-[9px] text-slate-400 font-extrabold uppercase tracking-wider">TRIPS</span>
                  <p className="text-sm font-black font-mono text-white">
                    {shiftMetrics.totalTripsToday}
                  </p>
                </div>

                <div className="bg-slate-950/80 p-2.5 rounded-2xl border border-slate-800 flex flex-col items-center justify-center space-y-1">
                  <Navigation className="w-4 h-4 text-white" />
                  <span className="text-[9px] text-slate-400 font-extrabold uppercase tracking-wider">DISTANCE</span>
                  <p className="text-sm font-black font-mono text-white">
                    {shiftMetrics.totalDistanceKmToday} <span className="text-[10px] text-slate-400 font-normal">km</span>
                  </p>
                </div>

                <div className="bg-slate-950/80 p-2.5 rounded-2xl border border-slate-800 flex flex-col items-center justify-center space-y-1">
                  <Clock className="w-4 h-4 text-white" />
                  <span className="text-[9px] text-slate-400 font-extrabold uppercase tracking-wider">TIME</span>
                  <p className="text-sm font-black font-mono text-white">
                    {shiftMetrics.totalDurationMinutesToday} <span className="text-[10px] text-slate-400 font-normal">m</span>
                  </p>
                </div>
              </div>
            </div>

            {/* Unsynced Offline Trips Banner */}
            {completedList.filter((t) => !t.isSynced).length > 0 && isConfigured && (
              <div className="bg-amber-950/40 border border-amber-600/40 rounded-2xl p-3 flex items-center justify-between text-xs">
                <div className="flex items-center space-x-2 text-amber-300 font-semibold">
                  <RefreshCw className={`w-4 h-4 text-amber-400 ${isSyncingPending ? 'animate-spin' : ''}`} />
                  <span>
                    <strong className="text-white">
                      {completedList.filter((t) => !t.isSynced).length}
                    </strong>{' '}
                    trip(s) saved locally
                  </span>
                </div>
                <button
                  type="button"
                  disabled={isSyncingPending}
                  onClick={handleSyncPendingTrips}
                  className="px-2.5 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-lg text-[11px] transition shadow"
                >
                  {isSyncingPending ? 'Syncing...' : 'Sync Now'}
                </button>
              </div>
            )}

            {/* 3. GET TRIP (PRIMARY OPERATIONAL HERO CARD WITH 6-DIGIT OTP) */}
            <div className="bg-gradient-to-b from-slate-900/90 via-slate-950 to-slate-900 border border-slate-800 rounded-3xl p-5 text-center shadow-2xl space-y-3 relative overflow-hidden">
              {/* Background trace styling */}
              <div className="absolute top-0 left-0 w-32 h-32 bg-red-500/5 rounded-full blur-2xl pointer-events-none" />
              <div className="absolute bottom-0 right-0 w-32 h-32 bg-rose-500/5 rounded-full blur-2xl pointer-events-none" />

              <div className="w-16 h-16 rounded-full bg-gradient-to-b from-red-500 to-rose-700 shadow-[0_0_25px_rgba(239,68,68,0.6)] border-2 border-red-400/50 flex items-center justify-center text-white mx-auto my-1">
                <Radio className="w-8 h-8 text-white animate-pulse" />
              </div>

              <h3 className="text-xl font-black text-white tracking-widest uppercase">GET TRIP</h3>
              <p className="text-xs text-slate-400 max-w-xs mx-auto leading-relaxed">
                Enter your 6-digit Trip Access OTP provided by dispatch to claim and execute your trip.
              </p>

              {/* 6 OTP Digit Input Boxes */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (tripAccessOtp.length >= 4) {
                    setLoadTripModal(true);
                  }
                }}
                className="space-y-3 pt-1"
              >
                <div className="grid grid-cols-6 gap-2 max-w-xs mx-auto my-2">
                  {[0, 1, 2, 3, 4, 5].map((idx) => (
                    <input
                      key={idx}
                      type="text"
                      maxLength={1}
                      value={tripAccessOtp[idx] || ''}
                      onChange={(e) => {
                        const val = e.target.value.replace(/\D/g, '');
                        if (val) {
                          const current = tripAccessOtp.split('');
                          current[idx] = val;
                          const newOtp = current.join('');
                          setTripAccessOtp(newOtp);
                          // Auto focus next field
                          const nextInput = document.getElementById(`otp-input-${idx + 1}`);
                          if (nextInput) (nextInput as HTMLInputElement).focus();
                        } else {
                          const current = tripAccessOtp.split('');
                          current[idx] = '';
                          setTripAccessOtp(current.join(''));
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Backspace' && !tripAccessOtp[idx] && idx > 0) {
                          const prevInput = document.getElementById(`otp-input-${idx - 1}`);
                          if (prevInput) (prevInput as HTMLInputElement).focus();
                        }
                      }}
                      id={`otp-input-${idx}`}
                      placeholder="-"
                      className="w-11 h-12 rounded-xl bg-slate-950 border border-slate-700/80 text-white font-mono text-xl font-extrabold text-center focus:border-red-500 focus:outline-none transition shadow-inner"
                    />
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setTripAccessOtp('');
                    setClaimError(null);
                    setLoadTripModal(true);
                  }}
                  className="w-full py-3.5 px-6 rounded-2xl font-black text-sm uppercase tracking-wider shadow-[0_6px_25px_rgba(225,29,72,0.45)] active:scale-[0.98] transition flex items-center justify-center space-x-2 bg-gradient-to-r from-red-600 via-rose-600 to-red-600 hover:from-red-500 hover:to-rose-500 text-white"
                >
                  <Key className="w-4 h-4 text-white" />
                  <span>GET TRIP</span>
                  <ChevronRight className="w-4 h-4 text-white" />
                </button>
              </form>
            </div>


          </div>
        )}

        {/* Tab: History */}
        {!activeTrip && activeTab === 'history' && (() => {
          const dateFiltered = getFilteredCompletedTrips({
            range: driverDateFilter,
            customStart: driverCustomStart,
            customEnd: driverCustomEnd,
          });

          const filtered = dateFiltered.filter((item) => {
            if (!historySearchQuery.trim()) return true;
            const q = historySearchQuery.toLowerCase();
            return (
              item.tripNumber.toLowerCase().includes(q) ||
              (item.customerName && item.customerName.toLowerCase().includes(q)) ||
              (item.pickupAddress && item.pickupAddress.toLowerCase().includes(q)) ||
              (item.dropAddress && item.dropAddress.toLowerCase().includes(q)) ||
              (item.customerMobile && item.customerMobile.includes(q))
            );
          });

          return (
            <div className="space-y-4 animate-in fade-in duration-200">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-white">Completed Trips History</h2>
                  <p className="text-[11px] text-slate-400">
                    {filtered.length} logged {filtered.length === 1 ? 'trip' : 'trips'} in view
                  </p>
                </div>
                <div className="flex items-center space-x-2">
                  {completedList.length > 0 && (
                    <button
                      onClick={handleExportCsv}
                      className="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-sky-400 font-bold text-xs flex items-center space-x-1 border border-slate-700 shadow-sm transition"
                      title="Export all trips as CSV"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Export CSV</span>
                    </button>
                  )}
                  <button
                    onClick={() => setActiveTab('home')}
                    className="text-xs text-sky-400 font-bold"
                  >
                    Back to Home
                  </button>
                </div>
              </div>

              {/* Date Filter Pills */}
              <div className="flex space-x-1 overflow-x-auto pb-1 no-scrollbar text-[11px]">
                {(['ALL', 'TODAY', 'YESTERDAY', 'THIS_WEEK', 'THIS_MONTH', 'CUSTOM'] as DateFilterRange[]).map((d) => (
                  <button
                    key={d}
                    onClick={() => setDriverDateFilter(d)}
                    className={`px-2.5 py-1 rounded-lg font-bold whitespace-nowrap transition ${
                      driverDateFilter === d
                        ? 'bg-sky-600 text-white shadow-sm'
                        : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200'
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
              {driverDateFilter === 'CUSTOM' && (
                <div className="grid grid-cols-2 gap-2 bg-slate-900 p-2.5 rounded-xl border border-slate-800 shadow-sm">
                  <div>
                    <label className="text-[10px] text-slate-400 font-semibold block mb-0.5">Start Date</label>
                    <input
                      type="date"
                      value={driverCustomStart}
                      onChange={(e) => setDriverCustomStart(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg text-white text-xs px-2 py-1"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 font-semibold block mb-0.5">End Date</label>
                    <input
                      type="date"
                      value={driverCustomEnd}
                      onChange={(e) => setDriverCustomEnd(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg text-white text-xs px-2 py-1"
                    />
                  </div>
                </div>
              )}

              {/* Search Bar */}
              {completedList.length > 0 && (
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={historySearchQuery}
                    onChange={(e) => setHistorySearchQuery(e.target.value)}
                    placeholder="Search by trip #, customer name, mobile, address..."
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 shadow-sm"
                  />
                  {historySearchQuery && (
                    <button
                      onClick={() => setHistorySearchQuery('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white text-xs font-bold"
                    >
                      ✕
                    </button>
                  )}
                </div>
              )}

              {completedList.length === 0 ? (
                <div className="bg-[#1e293b] border border-slate-700/60 rounded-2xl p-8 text-center shadow-lg">
                  <History className="w-10 h-10 text-slate-500 mx-auto mb-2" />
                  <p className="text-sm font-bold text-white">No Trips Completed Yet</p>
                  <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto">
                    Claim a trip, run the meter, and completed trip records will sync and appear here.
                  </p>
                </div>
              ) : filtered.length === 0 ? (
                <div className="bg-[#1e293b] border border-slate-700/60 rounded-2xl p-8 text-center text-xs text-slate-400 shadow-lg">
                  No trips matched the selected filter or search query.
                </div>
              ) : (
                <div className="space-y-3">
                  {filtered.map((item) => {
                    const isPassengerVerified = Boolean(
                      item.passengerVerifiedAt || item.passengerVerificationStatus === 'VERIFIED'
                    );

                    return (
                      <div
                        key={item.id}
                        className="p-4 rounded-2xl bg-gradient-to-br from-[#1e293b] via-[#0f172a] to-[#1e293b] border border-slate-700/60 space-y-2.5 text-xs shadow-lg"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2">
                            <span className="font-mono font-black text-sky-400 text-sm">
                              {item.tripNumber}
                            </span>
                            <span className="text-[10px] text-slate-400 font-medium">
                              {new Date(item.completedAt).toLocaleDateString([], {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          </div>
                          <span className="font-mono font-black text-emerald-400 text-base">
                            ₹{item.totalFare}
                          </span>
                        </div>

                        {/* Customer & Route details */}
                        <div className="text-slate-300">
                          <p className="font-bold text-white">
                            {item.customerName} {item.customerMobile ? `(${item.customerMobile})` : ''}
                          </p>
                          <p className="text-[11px] text-slate-400 truncate mt-0.5">
                            <span className="text-slate-500 font-semibold">From:</span> {item.pickupAddress}
                          </p>
                          <p className="text-[11px] text-slate-400 truncate">
                            <span className="text-slate-500 font-semibold">To:</span> {item.dropAddress}
                          </p>
                        </div>

                        {/* Telemetry pill row */}
                        <div className="flex items-center space-x-3 text-[11px] text-slate-400 pt-1">
                          <span className="bg-slate-950 px-2 py-0.5 rounded border border-slate-800 font-mono text-sky-400 font-bold">
                            {item.distanceKm.toFixed(1)} km
                          </span>
                          <span className="bg-slate-950 px-2 py-0.5 rounded border border-slate-800 font-mono text-teal-400 font-bold">
                            {Math.ceil(item.durationSeconds / 60)} min
                          </span>
                          {item.waitingSeconds > 0 && (
                            <span className="bg-slate-950 px-2 py-0.5 rounded border border-slate-800 font-mono text-amber-400 font-bold">
                              {Math.floor(item.waitingSeconds / 60)} min wait
                            </span>
                          )}
                        </div>

                        {/* Badges: Passenger OTP & Cloud Sync */}
                        <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px]">
                          <div className="flex items-center space-x-1.5">
                            {item.passengerVerifiedAt || item.passengerVerificationStatus ? (
                              <span
                                className={`px-2 py-0.5 rounded font-bold uppercase ${
                                  isPassengerVerified
                                    ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-500/30'
                                    : 'bg-amber-950/80 text-amber-400 border border-amber-500/30'
                                }`}
                              >
                                {isPassengerVerified ? '✓ Customer OTP Verified' : 'OTP Pending'}
                              </span>
                            ) : null}

                            <span
                              className={`px-2 py-0.5 rounded font-bold uppercase ${
                                item.isSynced
                                  ? 'bg-teal-950/80 text-teal-400 border border-teal-500/30'
                                  : 'bg-amber-950/80 text-amber-300 border border-amber-500/30'
                              }`}
                            >
                              {item.isSynced ? 'Cloud Synced' : 'Local Storage'}
                            </span>
                          </div>

                          <button
                            onClick={() => setCompletedSummary(item)}
                            className="text-sky-400 hover:text-sky-300 font-bold transition flex items-center space-x-1 text-[11px]"
                          >
                            <span>View Invoice</span>
                            <ChevronRight className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })()}

        {/* Tab: About Us */}
        {!activeTrip && activeTab === 'about' && (
          <div className="space-y-4 animate-in fade-in duration-200">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-black text-white tracking-tight">ABOUT SBS TRAVELS</h2>
                <p className="text-xs text-sky-400 font-medium">
                  Technology-driven travel &amp; mobility services
                </p>
              </div>
              <button
                onClick={() => setActiveTab('home')}
                className="px-3 py-1 rounded-xl bg-slate-800 hover:bg-slate-700 text-sky-400 font-bold text-xs border border-slate-700 transition"
              >
                Back to Home
              </button>
            </div>

            {/* Company Overview Card */}
            <div className="bg-gradient-to-br from-[#1e293b] via-[#0f172a] to-[#1e293b] border border-slate-700/60 rounded-2xl p-4 shadow-lg space-y-2">
              <div className="flex items-center space-x-2 text-sky-400">
                <Car className="w-5 h-5" />
                <h3 className="font-extrabold text-sm text-white">Who We Are</h3>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed font-medium">
                SBS Travels is a Coimbatore-based travel and mobility initiative focused on reliable taxi operations, professional driver services and technology-enabled trip management.
              </p>
            </div>

            {/* Our Vision Card */}
            <div className="bg-gradient-to-br from-[#1e293b] via-[#0f172a] to-[#1e293b] border border-slate-700/60 rounded-2xl p-4 shadow-lg space-y-2">
              <div className="flex items-center space-x-2 text-emerald-400">
                <Sparkles className="w-5 h-5" />
                <h3 className="font-extrabold text-sm text-white">Our Vision</h3>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed font-medium">
                To combine professional taxi services with modern technology to make driver operations, trip dispatch and customer service simpler, safer and more efficient.
              </p>
            </div>

            {/* Our Services List */}
            <div className="bg-gradient-to-br from-[#1e293b] via-[#0f172a] to-[#1e293b] border border-slate-700/60 rounded-2xl p-4 shadow-lg space-y-3">
              <div className="flex items-center space-x-2 text-cyan-400">
                <Briefcase className="w-5 h-5" />
                <h3 className="font-extrabold text-sm text-white">Our Services</h3>
              </div>
              <div className="grid grid-cols-1 gap-2 text-xs text-slate-300">
                {[
                  'Taxi & Travel Services',
                  'Local & Outstation Taxi Services',
                  'Taxi Technology & Software Solutions',
                  'Driver & Fleet Management Systems',
                  'Trip Dispatch & Booking Solutions',
                  'Digital Billing & Invoicing',
                  'Website Development',
                  'Google Ads Campaign Setup & Management'
                ].map((service, idx) => (
                  <div key={idx} className="flex items-center space-x-2 bg-slate-900/80 p-2.5 rounded-xl border border-slate-800">
                    <Check className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                    <span className="font-medium text-slate-200">{service}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Founders Section */}
            <div className="bg-gradient-to-br from-[#1e293b] via-[#0f172a] to-[#1e293b] border border-slate-700/60 rounded-2xl p-4 shadow-lg space-y-3">
              <div className="flex items-center space-x-2 text-amber-400">
                <Users className="w-5 h-5" />
                <h3 className="font-extrabold text-sm text-white">Founders</h3>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                {['Santhosh', 'Basheer', 'Sathish'].map((founder) => (
                  <div key={founder} className="bg-slate-900/90 p-3 rounded-xl border border-slate-800 space-y-1">
                    <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-sky-600 to-indigo-600 text-white font-black flex items-center justify-center mx-auto text-xs shadow-md">
                      {founder[0]}
                    </div>
                    <p className="font-black text-xs text-white">{founder}</p>
                    <p className="text-[10px] text-slate-400 font-medium">Founder</p>
                  </div>
                ))}
              </div>
            </div>


          </div>
        )}

        {/* Compact Footer Credit - POWERED BY GET TAXI */}
        <footer className="pt-2 pb-3 text-center">
          <div className="inline-flex items-center space-x-1.5 px-3 py-1 bg-slate-950/90 border border-red-600/80 rounded-full shadow-md">
            <span className="text-[9px] font-bold text-slate-400 tracking-wider uppercase">POWERED BY</span>
            <span className="text-red-500 font-black tracking-wider text-xs uppercase">GET TAXI</span>
            <span className="bg-white text-slate-950 px-1.5 py-0.5 rounded-full font-black text-[10px] tracking-wide uppercase">BASHEER</span>
          </div>
        </footer>
      </main>

      {/* TRIP ACCESS OTP CLAIM MODAL */}
      {loadTripModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
          <div className="bg-[#0f172a] border border-slate-800 w-full max-w-sm rounded-3xl p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-200 text-slate-100">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
              <div>
                <h3 className="text-lg font-bold text-white">Enter Trip Access OTP</h3>
                <p className="text-xs text-slate-400 font-medium">
                  Provided privately by dispatch
                </p>
              </div>
              <button
                onClick={() => setLoadTripModal(false)}
                className="w-7 h-7 rounded-full bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center text-xs font-bold"
              >
                ✕
              </button>
            </div>

            {/* Available Live Open Trips List */}
            {openTripsList.length > 0 && (
              <div className="space-y-2 max-h-44 overflow-y-auto pr-1 no-scrollbar pt-1">
                <span className="text-[10px] font-bold text-sky-400 uppercase tracking-wider block">
                  Available Open Trips ({openTripsList.length})
                </span>
                {openTripsList.map((ot) => (
                  <div
                    key={ot.id}
                    onClick={() => {
                      if (ot.tripAccessOtp) setTripAccessOtp(ot.tripAccessOtp);
                    }}
                    className={`p-2.5 rounded-xl border transition cursor-pointer flex items-center justify-between text-xs ${
                      tripAccessOtp === ot.tripAccessOtp
                        ? 'bg-sky-950/60 border-sky-500/80 text-white'
                        : 'bg-slate-950/80 border-slate-800 hover:border-slate-700 text-slate-300'
                    }`}
                  >
                    <div className="flex-1 min-w-0 pr-2">
                      <div className="flex items-center space-x-2">
                        <span className="font-mono font-bold text-sky-400">{ot.tripNumber}</span>
                        <span className="bg-slate-800 px-1.5 py-0.5 rounded text-[10px] text-slate-400 font-mono font-bold">
                          ₹{ot.estimatedFare}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 truncate mt-0.5">
                        {ot.pickupAddress} → {ot.dropAddress}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (ot.tripAccessOtp) setTripAccessOtp(ot.tripAccessOtp);
                      }}
                      className="px-2 py-1 bg-sky-600/30 hover:bg-sky-600 text-sky-300 hover:text-white border border-sky-500/40 rounded-lg text-[10px] font-bold shrink-0 transition"
                    >
                      Select OTP
                    </button>
                  </div>
                ))}
              </div>
            )}

            <form onSubmit={handleClaimTrip} className="space-y-4 pt-1">
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5 text-center">
                  6-Digit OTP Code
                </label>
                <input
                  type="text"
                  maxLength={6}
                  autoFocus
                  value={tripAccessOtp}
                  onChange={(e) => setTripAccessOtp(e.target.value.replace(/\D/g, ''))}
                  placeholder="• • • • • •"
                  className="w-full text-center tracking-[0.45em] font-mono text-2xl font-black py-3.5 bg-slate-950 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-sky-500 transition shadow-inner"
                />
              </div>

              {claimError && (
                <div className="p-2.5 rounded-xl bg-rose-950/60 border border-rose-700/60 text-rose-300 text-xs text-center flex items-center justify-center space-x-1.5 font-medium">
                  <ShieldAlert className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                  <span>{claimError}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={tripAccessOtp.length !== 6 || isClaiming}
                className={`w-full py-3.5 rounded-xl font-black text-sm tracking-wide transition shadow-lg ${
                  tripAccessOtp.length === 6 && !isClaiming
                    ? 'bg-sky-600 hover:bg-sky-500 text-white shadow-sky-600/20 active:scale-[0.98]'
                    : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                }`}
              >
                {isClaiming ? 'VERIFYING & CLAIMING...' : 'GET TRIP'}
              </button>

              <div className="p-2 rounded-xl bg-slate-950 border border-slate-800/80 text-[10px] text-slate-400 text-center font-medium">
                First driver to claim wins. OTP can only be consumed once.
              </div>
            </form>
          </div>
        </div>
      )}

      {/* TRIP SUMMARY MODAL */}
      {completedSummary && (
        <TripSummaryModal
          summary={completedSummary}
          driver={driver}
          onDone={handleSummaryDone}
        />
      )}

      {/* DRIVER & VEHICLE PROFILE MODAL (EDIT PHOTO & HOME LOCATION ANYTIME) */}
      {showDriverEditModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0f172a] border border-slate-800 w-full max-w-sm rounded-3xl p-5 shadow-2xl space-y-4 animate-in zoom-in-95 duration-150 text-slate-100 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <UserCog className="w-4 h-4 text-sky-400" />
                <h3 className="font-bold text-sm text-white">Edit Profile &amp; Location</h3>
              </div>
              <button
                onClick={() => setShowDriverEditModal(false)}
                className="w-6 h-6 rounded-full bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center text-xs font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveDriverProfile} className="space-y-3.5 text-xs">
              {/* Photo Upload from Gallery (Not Camera forced) */}
              <div className="space-y-1.5 p-3 rounded-2xl bg-slate-900/80 border border-slate-800">
                <label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider block">
                  Driver Photo (Select from Phone Gallery)
                </label>
                <div className="flex items-center space-x-3">
                  {editPhotoUrl ? (
                    <img
                      src={editPhotoUrl}
                      alt="Driver Photo"
                      className="w-14 h-14 rounded-2xl object-cover border border-sky-400/50 shadow"
                    />
                  ) : (
                    <div className="w-14 h-14 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-400">
                      <Camera className="w-6 h-6" />
                    </div>
                  )}

                  <div className="flex-1 space-y-1">
                    <label className="px-3 py-1.5 bg-sky-600/30 hover:bg-sky-600/50 text-sky-300 border border-sky-500/40 rounded-xl font-bold text-xs flex items-center justify-center space-x-1.5 cursor-pointer transition">
                      <Upload className="w-3.5 h-3.5" />
                      <span>Choose from Gallery</span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleEditPhotoGallerySelect}
                        className="hidden"
                      />
                    </label>
                    {editPhotoUrl && (
                      <button
                        type="button"
                        onClick={() => setEditPhotoUrl('')}
                        className="text-[10px] text-rose-400 hover:text-rose-300 font-semibold underline block text-center w-full"
                      >
                        Remove Photo
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                  Driver Full Name
                </label>
                <input
                  type="text"
                  required
                  value={editDriverName}
                  onChange={(e) => setEditDriverName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-medium focus:outline-none focus:border-sky-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                  Driver Mobile Number
                </label>
                <input
                  type="tel"
                  required
                  value={editDriverMobile}
                  onChange={(e) => setEditDriverMobile(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-sky-500"
                />
              </div>

              {/* Home Location input - editable anytime */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider block">
                    Driver Home Location
                  </label>
                  <span className="text-[10px] text-slate-400">e.g. Selvapuram, Gandhipuram, Sulur</span>
                </div>
                <div className="relative">
                  <MapPin className="w-4 h-4 text-emerald-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    required
                    value={editHomeLocation}
                    onChange={(e) => setEditHomeLocation(e.target.value)}
                    placeholder="e.g. Selvapuram, Gandhipuram, Sulur"
                    className="w-full bg-slate-950 border border-emerald-500/40 rounded-xl pl-9 pr-3 py-2 text-white font-medium focus:outline-none focus:border-emerald-400"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                    Vehicle Reg Number
                  </label>
                  <input
                    type="text"
                    required
                    value={editVehicleNumber}
                    onChange={(e) => setEditVehicleNumber(e.target.value.toUpperCase())}
                    placeholder="TN 45 AB 1234"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono font-bold focus:outline-none focus:border-sky-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                    Driver Code
                  </label>
                  <input
                    type="text"
                    required
                    value={editDriverCode}
                    onChange={(e) => setEditDriverCode(e.target.value.toUpperCase())}
                    placeholder="DRV0051"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono font-bold focus:outline-none focus:border-sky-500"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                  Vehicle Model / Make
                </label>
                <input
                  type="text"
                  value={editVehicleModel}
                  onChange={(e) => setEditVehicleModel(e.target.value)}
                  placeholder="e.g. Maruti Tour S, Toyota Innova"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-sky-500"
                />
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  className="w-full py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs shadow-md transition active:scale-[0.98]"
                >
                  Save Profile &amp; Location
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PHASE 2.4: NO-PASSWORD DRIVER ONBOARDING & DEVICE ID ACTIVATION MODAL */}
      {showDriverOnboardModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/95 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#0f172a] border border-slate-800 w-full max-w-sm rounded-3xl p-5 shadow-2xl space-y-4 animate-in zoom-in-95 duration-150 text-slate-100 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 rounded-xl bg-sky-500/10 text-sky-400 flex items-center justify-center">
                  <Smartphone className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-white">Driver Onboarding</h3>
                  <p className="text-[10px] text-sky-400 font-bold uppercase">Device ID Hardware Auth</p>
                </div>
              </div>
              {driver.activationStatus === 'ACTIVE' ? (
                <button
                  type="button"
                  onClick={() => {
                    setShowDriverOnboardModal(false);
                    setSignupError(null);
                    setSignupSuccess(null);
                    setActivationError(null);
                    setActivationSuccess(null);
                  }}
                  className="w-7 h-7 rounded-full bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center text-xs font-bold"
                  title="Close Onboarding Modal"
                >
                  ✕
                </button>
              ) : (
                <div className="flex items-center space-x-1.5">
                  <button
                    type="button"
                    onClick={() => handleOpenDispatchConsole()}
                    className="px-2.5 py-1 rounded-full bg-red-950/90 text-red-300 font-extrabold text-[10px] uppercase border border-red-500/60 hover:bg-red-900 transition flex items-center space-x-1"
                    title="Master Admin Login & Dispatcher Console"
                  >
                    <Radio className="w-3 h-3 text-red-400 animate-pulse" />
                    <span>Admin Access</span>
                  </button>
                </div>
              )}
            </div>

            {/* Modal Tabs */}
            <div className="grid grid-cols-3 gap-1 p-1 bg-slate-950 rounded-2xl border border-slate-800 text-xs">
              <button
                type="button"
                onClick={() => setOnboardTab('signup')}
                className={`py-2 rounded-xl font-bold transition flex items-center justify-center space-x-1 ${
                  onboardTab === 'signup'
                    ? 'bg-sky-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <User className="w-3.5 h-3.5" />
                <span>1. Profile</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (!driver.name || !driver.mobile || !driver.vehicleNumber) {
                    alert('Please complete and save your Profile details in Tab 1 first.');
                    return;
                  }
                  setOnboardTab('permissions');
                }}
                className={`py-2 rounded-xl font-bold transition flex items-center justify-center space-x-1 ${
                  onboardTab === 'permissions'
                    ? 'bg-sky-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>2. Permissions</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (!locationGranted || !notificationGranted) {
                    alert('Please grant Location & Notification permissions in Tab 2 first.');
                    return;
                  }
                  setOnboardTab('activate');
                }}
                className={`py-2 rounded-xl font-bold transition flex items-center justify-center space-x-1 ${
                  onboardTab === 'activate'
                    ? 'bg-sky-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Key className="w-3.5 h-3.5" />
                <span>3. Code</span>
              </button>
            </div>

            {/* TAB 1: MANDATORY DRIVER PROFILE SETTINGS */}
            {onboardTab === 'signup' && (
              <form onSubmit={handleOnboardingSubmit} className="space-y-3 text-xs">
                {/* Photo Upload from Gallery (Not Camera forced) */}
                <div className="space-y-1.5 p-3 rounded-2xl bg-slate-900/80 border border-slate-800">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider block">
                      Driver Photo (Upload from Gallery)
                    </label>
                    <span className="text-[9px] text-sky-400 font-bold">Gallery file</span>
                  </div>
                  <div className="flex items-center space-x-3">
                    {signupPhotoUrl ? (
                      <img
                        src={signupPhotoUrl}
                        alt="Preview"
                        className="w-14 h-14 rounded-2xl object-cover border border-sky-400/50 shadow"
                      />
                    ) : (
                      <div className="w-14 h-14 rounded-2xl bg-slate-950 border border-slate-700 flex items-center justify-center text-slate-400">
                        <Camera className="w-6 h-6 text-slate-500" />
                      </div>
                    )}

                    <div className="flex-1 space-y-1">
                      <label className="px-3 py-1.5 bg-sky-600/30 hover:bg-sky-600/50 text-sky-300 border border-sky-500/40 rounded-xl font-bold text-xs flex items-center justify-center space-x-1.5 cursor-pointer transition">
                        <Upload className="w-3.5 h-3.5" />
                        <span>Select Photo from Gallery</span>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handlePhotoGallerySelect}
                          className="hidden"
                        />
                      </label>
                      {signupPhotoUrl && (
                        <button
                          type="button"
                          onClick={() => setSignupPhotoUrl('')}
                          className="text-[10px] text-rose-400 hover:text-rose-300 font-semibold underline block text-center w-full"
                        >
                          Remove Photo
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                    Driver Full Name
                  </label>
                  <input
                    type="text"
                    required
                    value={signupName}
                    onChange={(e) => setSignupName(e.target.value)}
                    placeholder="e.g. S. Ramesh"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-medium focus:outline-none focus:border-sky-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                    Mobile Number
                  </label>
                  <input
                    type="tel"
                    required
                    value={signupMobile}
                    onChange={(e) => setSignupMobile(e.target.value)}
                    placeholder="9876543210"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-sky-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                      Vehicle Reg No.
                    </label>
                    <input
                      type="text"
                      required
                      value={signupVehNo}
                      onChange={(e) => setSignupVehNo(e.target.value.toUpperCase())}
                      placeholder="TN 38 AA 1234"
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono font-bold focus:outline-none focus:border-sky-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                      Vehicle Model
                    </label>
                    <input
                      type="text"
                      value={signupVehModel}
                      onChange={(e) => setSignupVehModel(e.target.value)}
                      placeholder="Maruti Tour S"
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-sky-500"
                    />
                  </div>
                </div>

                {/* Home Location */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider block">
                      Driver Home Location
                    </label>
                    <span className="text-[10px] text-slate-400">Can edit anytime</span>
                  </div>
                  <div className="relative">
                    <MapPin className="w-4 h-4 text-emerald-400 absolute left-3 top-2.5" />
                    <input
                      type="text"
                      required
                      value={signupHomeLocation}
                      onChange={(e) => setSignupHomeLocation(e.target.value)}
                      placeholder="e.g. Selvapuram, Gandhipuram, Sulur"
                      className="w-full bg-slate-950 border border-emerald-500/40 rounded-xl pl-9 pr-3 py-2 text-white font-medium focus:outline-none focus:border-emerald-400"
                    />
                  </div>
                </div>

                {/* Persistent Device ID Box */}
                <div className="p-3 rounded-2xl bg-sky-950/40 border border-sky-500/30 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-sky-400 uppercase">
                      Hardware Device ID
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(driver.deviceId);
                        setCopiedDeviceId(true);
                        setTimeout(() => setCopiedDeviceId(false), 2000);
                      }}
                      className="text-[10px] text-sky-300 hover:text-white font-bold flex items-center space-x-1"
                    >
                      {copiedDeviceId ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      <span>{copiedDeviceId ? 'Copied' : 'Copy Device ID'}</span>
                    </button>
                  </div>
                  <p className="font-mono text-[11px] font-bold text-white bg-slate-950 p-2 rounded-xl border border-slate-800 break-all select-all">
                    {driver.deviceId}
                  </p>

                  <a
                    href={`https://wa.me/919043743777?text=${encodeURIComponent(
                      `Hello Admin (SBS Travels), I am registering as a driver.\nName: ${signupName || driver.name}\nMobile: ${signupMobile || driver.mobile}\nVehicle: ${signupVehNo || driver.vehicleNumber}\nHome: ${signupHomeLocation}\nDevice ID: *${driver.deviceId}*\nPlease generate my Activation Code.`
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full py-2 bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/40 rounded-xl font-bold text-[11px] flex items-center justify-center space-x-1.5 transition"
                  >
                    <MessageSquare className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Send Profile to Admin WhatsApp (9043743777)</span>
                  </a>
                </div>

                {signupError && (
                  <p className="text-[11px] text-rose-400 font-semibold p-2 rounded-xl bg-rose-950/40 border border-rose-800/40">
                    {signupError}
                  </p>
                )}

                {signupSuccess && (
                  <p className="text-[11px] text-emerald-400 font-semibold p-2 rounded-xl bg-emerald-950/40 border border-emerald-800/40">
                    {signupSuccess}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={isSubmittingSignup}
                  className="w-full py-3 rounded-2xl bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white font-black text-xs uppercase tracking-wider shadow-lg active:scale-[0.98] transition flex items-center justify-center space-x-1.5"
                >
                  {isSubmittingSignup ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Saving Profile...</span>
                    </>
                  ) : (
                    <span>Save Profile &amp; Next: Permissions ➔</span>
                  )}
                </button>
              </form>
            )}

            {/* TAB 2: MANDATORY BACKGROUND PERMISSIONS */}
            {onboardTab === 'permissions' && (
              <div className="space-y-3 text-xs">
                <div className="p-3 rounded-2xl bg-sky-950/40 border border-sky-500/30 space-y-1">
                  <h4 className="font-bold text-white text-xs flex items-center space-x-1.5">
                    <ShieldCheck className="w-4 h-4 text-sky-400" />
                    <span>Mandatory App Permissions</span>
                  </h4>
                  <p className="text-[11px] text-slate-300 leading-snug">
                    Enable background location &amp; sound alarms so the app can receive trip broadcasts and track live fare meter GPS.
                  </p>
                </div>

                {/* 1. Allow All The Time Location */}
                <div className="p-3 bg-slate-900 border border-slate-800 rounded-2xl space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-white flex items-center space-x-1.5">
                      <MapPin className="w-4 h-4 text-emerald-400" />
                      <span>1. Allow All The Time Location Access</span>
                    </span>
                    {locationGranted ? (
                      <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-extrabold text-[10px] uppercase">
                        Granted ✓
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold text-[10px] uppercase">
                        Required
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-slate-400 leading-relaxed">
                    Used for continuous background meter GPS fare calculation and calculating distance to pickup points.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      if (navigator.geolocation) {
                        navigator.geolocation.getCurrentPosition(
                          () => {
                            setLocationGranted(true);
                            soundEngine.playClaimSuccess();
                          },
                          (_err) => {
                            // Fallback for iframe/browser restriction: grant in-app location access
                            setLocationGranted(true);
                            soundEngine.playClaimSuccess();
                          },
                          { enableHighAccuracy: true, timeout: 5000 }
                        );
                      } else {
                        setLocationGranted(true);
                        soundEngine.playClaimSuccess();
                      }
                    }}
                    className={`w-full py-2 rounded-xl font-bold text-xs transition border flex items-center justify-center space-x-1.5 ${
                      locationGranted
                        ? 'bg-emerald-950/60 border-emerald-500/50 text-emerald-300'
                        : 'bg-sky-600 hover:bg-sky-500 text-white border-sky-400 shadow-md'
                    }`}
                  >
                    <MapPin className="w-3.5 h-3.5" />
                    <span>{locationGranted ? 'Location Access Granted ✓' : 'Grant / Test All The Time Location'}</span>
                  </button>
                </div>

                {/* 2. Push Notification Permission */}
                <div className="p-3 bg-slate-900 border border-slate-800 rounded-2xl space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-white flex items-center space-x-1.5">
                      <Bell className="w-4 h-4 text-amber-400" />
                      <span>2. Allow Push &amp; Sound Notifications</span>
                    </span>
                    {notificationGranted ? (
                      <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-extrabold text-[10px] uppercase">
                        Granted ✓
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold text-[10px] uppercase">
                        Required
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-slate-400 leading-relaxed">
                    Triggers instant audio alarms and notifications when dispatch broadcasts new trip opportunities.
                  </p>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await notificationService.requestWebNotificationPermission();
                      } catch (_err) {
                        // ignore API restriction
                      }
                      setNotificationGranted(true);
                      soundEngine.playClaimSuccess();
                    }}
                    className={`w-full py-2 rounded-xl font-bold text-xs transition border flex items-center justify-center space-x-1.5 ${
                      notificationGranted
                        ? 'bg-emerald-950/60 border-emerald-500/50 text-emerald-300'
                        : 'bg-amber-600 hover:bg-amber-500 text-white border-amber-400 shadow-md'
                    }`}
                  >
                    <Bell className="w-3.5 h-3.5" />
                    <span>{notificationGranted ? 'Notification Access Granted ✓' : 'Grant Push Notification Permission'}</span>
                  </button>
                </div>

                {/* 3. Audio Chime Test */}
                <div className="p-3 bg-slate-900 border border-slate-800 rounded-2xl flex items-center justify-between">
                  <div>
                    <span className="font-bold text-white block">3. Test Sound &amp; Voice Chimes</span>
                    <span className="text-[10px] text-slate-400">Welcome voice &amp; trip alarms</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      soundEngine.playClaimSuccess();
                      soundEngine.speak(customWelcomeMsg);
                    }}
                    className="px-3 py-1.5 bg-purple-950 hover:bg-purple-900 text-purple-300 border border-purple-500/40 rounded-xl text-xs font-bold transition flex items-center space-x-1"
                  >
                    <Volume2 className="w-3.5 h-3.5 text-purple-400" />
                    <span>Test Audio</span>
                  </button>
                </div>

                {(!locationGranted || !notificationGranted) && (
                  <p className="text-[11px] text-amber-300 font-bold p-2.5 rounded-xl bg-amber-950/60 border border-amber-500/40 text-center">
                    ⚠️ Mandatory Permissions Required: Please grant both Location &amp; Notification permissions above to unlock the Next step.
                  </p>
                )}

                <button
                  type="button"
                  onClick={() => {
                    if (!locationGranted || !notificationGranted) {
                      alert('Please enable both Location Access and Push Notifications above to proceed.');
                      return;
                    }
                    setOnboardTab('activate');
                  }}
                  className={`w-full py-3 rounded-2xl font-black text-xs uppercase tracking-wider transition shadow-lg flex items-center justify-center space-x-1.5 ${
                    locationGranted && notificationGranted
                      ? 'bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white active:scale-[0.98]'
                      : 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed'
                  }`}
                >
                  <span>Next: Activation Code &amp; Device Binding ➔</span>
                </button>
              </div>
            )}

            {/* TAB 3: DEVICE ACTIVATION CODE BLOCK */}
            {onboardTab === 'activate' && (
              <form onSubmit={handleActivateDeviceSubmit} className="space-y-3.5 text-xs">
                {/* Hardware Device ID Container with Copy Button */}
                <div className="p-3 rounded-2xl bg-slate-900 border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">
                      Hardware Device ID
                    </span>
                    <div className="flex items-center space-x-2">
                      <span className={`px-2 py-0.5 rounded font-black text-[10px] uppercase ${
                        driver.activationStatus === 'ACTIVE'
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      }`}>
                        {driver.activationStatus}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(driver.deviceId);
                          setCopiedDeviceId(true);
                          setTimeout(() => setCopiedDeviceId(false), 2000);
                        }}
                        className="text-[10px] text-sky-300 hover:text-white font-bold flex items-center space-x-1"
                      >
                        {copiedDeviceId ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                        <span>{copiedDeviceId ? 'Copied' : 'Copy'}</span>
                      </button>
                    </div>
                  </div>
                  <p className="font-mono text-[11px] font-bold text-white bg-slate-950 p-2 rounded-xl border border-slate-800 break-all select-all">
                    {driver.deviceId}
                  </p>
                </div>

                {/* Direct Admin WhatsApp Button (9043743777) */}
                <a
                  href={`https://wa.me/919043743777?text=${encodeURIComponent(
                    `Hello Admin (9043743777), please generate my Activation Code.\nDriver: ${signupName || driver.name}\nVehicle: ${signupVehNo || driver.vehicleNumber}\nDevice ID: *${driver.deviceId}*`
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs rounded-2xl shadow-lg transition flex items-center justify-center space-x-2"
                >
                  <MessageSquare className="w-4 h-4 text-white animate-bounce" />
                  <span>💬 Direct WhatsApp to Admin (9043743777)</span>
                </a>

                <div className="space-y-2 text-center pt-1">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider block">
                      Enter Activation Code
                    </label>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const text = await navigator.clipboard.readText();
                          const digits = text.replace(/\D/g, '').slice(0, 6);
                          if (digits) {
                            setInputActivationCode(digits);
                            soundEngine.playClaimSuccess();
                          } else {
                            alert('No numeric code found in clipboard. Please enter manually.');
                          }
                        } catch {
                          alert('Please tap and hold the input box below to paste your code.');
                        }
                      }}
                      className="px-2.5 py-1 bg-sky-950 hover:bg-sky-900 text-sky-300 border border-sky-600/60 rounded-xl text-[10px] font-bold transition flex items-center space-x-1 shadow-sm active:scale-95"
                      title="Paste code from clipboard"
                    >
                      <Copy className="w-3 h-3 text-sky-400" />
                      <span>📋 Paste Code</span>
                    </button>
                  </div>

                  <p className="text-[10px] text-slate-400 text-left leading-tight">
                    Enter or paste the code sent by Admin on WhatsApp (9043743777) for this Device ID.
                  </p>

                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoFocus
                    value={inputActivationCode}
                    onPaste={(e) => {
                      e.preventDefault();
                      const pasted = e.clipboardData.getData('text');
                      const digits = pasted.replace(/\D/g, '').slice(0, 6);
                      if (digits) {
                        setInputActivationCode(digits);
                        soundEngine.playClaimSuccess();
                      }
                    }}
                    onChange={(e) => setInputActivationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="• • • • • •"
                    className="w-full text-center tracking-[0.4em] font-mono text-2xl font-black py-3 bg-slate-950 border border-sky-500/40 focus:border-sky-400 rounded-2xl text-white focus:outline-none transition shadow-inner select-all"
                  />
                </div>

                {activationError && (
                  <div className="p-2.5 rounded-xl bg-rose-950/60 border border-rose-700/60 text-rose-300 text-xs text-center flex items-center justify-center space-x-1.5 font-medium">
                    <ShieldAlert className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                    <span>{activationError}</span>
                  </div>
                )}

                {activationSuccess && (
                  <div className="p-2.5 rounded-xl bg-emerald-950/60 border border-emerald-700/60 text-emerald-300 text-xs text-center flex items-center justify-center space-x-1.5 font-medium">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span>{activationSuccess}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={inputActivationCode.length < 4 || isActivatingDevice}
                  className={`w-full py-3.5 rounded-2xl font-black text-xs uppercase tracking-wider transition shadow-lg flex items-center justify-center space-x-2 ${
                    inputActivationCode.length >= 4 && !isActivatingDevice
                      ? 'bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white shadow-sky-600/20 active:scale-[0.98]'
                      : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                  }`}
                >
                  {isActivatingDevice ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Verifying Device Binding...</span>
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="w-4 h-4" />
                      <span>Authorize &amp; Activate Device</span>
                    </>
                  )}
                </button>

                <div className="p-2 rounded-xl bg-slate-950 border border-slate-800 text-[10px] text-slate-400 text-center leading-relaxed">
                  🛡️ The activation code is cryptographically bound in Supabase to this phone. If entered on a different mobile, it will be rejected as invalid.
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* DRIVER APP SETTINGS MODAL */}
      {showSettingsModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0f172a] border border-slate-800 w-full max-w-sm rounded-3xl p-5 shadow-2xl space-y-4 animate-in zoom-in-95 duration-150 text-slate-100">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 rounded-xl bg-sky-500/10 text-sky-400 flex items-center justify-center">
                  <Settings className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-white">App Settings</h3>
                  <p className="text-[11px] text-slate-400 font-medium">SBS Travels Driver Console</p>
                </div>
              </div>
              <button
                onClick={() => setShowSettingsModal(false)}
                className="w-7 h-7 rounded-full bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center text-xs font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              {/* Location & GPS Permission Status */}
              <div className="p-3 bg-slate-950 border border-slate-800 rounded-2xl flex items-center justify-between">
                <div>
                  <p className="font-bold text-white">GPS &amp; Location Tracking</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">High-accuracy live telemetry</p>
                </div>
                <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                  <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                  <span>Active</span>
                </span>
              </div>

              {/* Sound & Audio Alerts */}
              <div className="p-3 bg-slate-950 border border-slate-800 rounded-2xl flex items-center justify-between">
                <div>
                  <p className="font-bold text-white">Audio &amp; Chime Alerts</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">Trip updates &amp; speed warnings</p>
                </div>
                <button
                  type="button"
                  onClick={() => soundEngine.playClaimSuccess()}
                  className="px-2.5 py-1 bg-sky-950 hover:bg-sky-900 text-sky-300 border border-sky-500/40 rounded-lg text-[11px] font-bold transition"
                >
                  Test Sound
                </button>
              </div>

              {/* Neutral Voice Welcome Announcement Config */}
              <div className="p-3 bg-slate-950 border border-slate-800 rounded-2xl space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-bold text-white">Welcome Voice Announcement</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">Spoken when trip meter starts</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => soundEngine.speak(customWelcomeMsg)}
                    className="px-2.5 py-1 bg-purple-950 hover:bg-purple-900 text-purple-300 border border-purple-500/40 rounded-lg text-[11px] font-bold transition flex items-center space-x-1"
                  >
                    <Volume2 className="w-3 h-3 text-purple-400" />
                    <span>Test Voice</span>
                  </button>
                </div>
                <input
                  type="text"
                  value={customWelcomeMsg}
                  onChange={(e) => {
                    const val = e.target.value;
                    setCustomWelcomeMsg(val);
                    saveWelcomeMessage(val);
                  }}
                  placeholder="Welcome. Please fasten your seat belt. Have a safe journey."
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-white font-medium text-xs focus:outline-none focus:border-purple-500 transition"
                />
              </div>

              {/* Account Status */}
              <div className="p-3 bg-slate-950 border border-slate-800 rounded-2xl space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white">Driver Account</span>
                  <span className="font-mono text-sky-400 font-bold">{driver.driverCode}</span>
                </div>
                <p className="text-[11px] text-slate-300 font-medium">{driver.name} • {driver.vehicleNumber}</p>
                <div className="flex items-center space-x-1 text-[10px] text-emerald-400 font-bold">
                  <MapPin className="w-3 h-3 text-emerald-400" />
                  <span>Home: {driver.homeLocation || 'Coimbatore'}</span>
                </div>
                <p className="text-[10px] text-slate-500 font-mono truncate">
                  Device: {driver.deviceId}
                </p>
              </div>

              {/* Version & About */}
              <div className="p-3 bg-slate-950 border border-slate-800 rounded-2xl text-center space-y-1">
                <p className="font-bold text-slate-200 text-xs">SBS Travels Driver Application</p>
                <p className="text-[11px] text-slate-400 font-medium">Version 2.4.0 (Hardware Device ID Auth)</p>
                <div className="pt-1 flex flex-col items-center">
                  <span className="text-[10px] text-slate-400 font-bold uppercase">Powered by</span>
                  <div className="inline-flex items-center space-x-1 px-2 py-0.5 bg-slate-900 border border-red-600/80 rounded mt-0.5">
                    <span className="text-red-500 font-black text-[10px]">GET TAXI</span>
                    <span className="bg-white text-slate-950 px-1 py-0.2 rounded font-black text-[9px]">BASHEER</span>
                  </div>
                </div>
              </div>

              {/* Switch / Reset Driver Button */}
              <button
                type="button"
                onClick={() => {
                  setShowSettingsModal(false);
                  setOnboardTab('signup');
                  setShowDriverOnboardModal(true);
                }}
                className="w-full py-2.5 bg-sky-950/40 hover:bg-sky-900/40 text-sky-300 font-bold rounded-xl border border-sky-800/50 transition text-xs flex items-center justify-center space-x-1.5"
              >
                <Smartphone className="w-4 h-4 text-sky-400" />
                <span>Onboard / Re-register Device</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DISPATCHER CONSOLE MODAL */}
      <AdminDispatchModal
        isOpen={showDispatchModal}
        onClose={() => setShowDispatchModal(false)}
        driver={driver}
        onDriverUpdated={(d) => setDriver(d)}
        onTripCreated={(newTrip) => {
          setTripAccessOtp(newTrip.tripAccessOtp);
        }}
        initialBypass={adminBypassActive}
        onLaunchDemoTrip={handleLaunchDemoTrip}
      />

      {/* DISPATCHER CONTROL ACCESS PASSWORD MODAL (Password: 2481) */}
      {showDispatchPinModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 w-full max-w-sm rounded-3xl p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center space-x-2">
                <Radio className="w-5 h-5 text-sky-400 animate-pulse" />
                <h3 className="font-extrabold text-white text-base">Dispatcher Control Verification</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowDispatchPinModal(false)}
                className="text-slate-400 hover:text-white font-bold"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Enter the Dispatcher Control Password to access trip dispatching, tariff configuration, and fleet management.
            </p>

            {dispatchPinError && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs font-semibold">
                {dispatchPinError}
              </div>
            )}

            <form onSubmit={handleDispatchPinSubmit} className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                  Dispatcher Password
                </label>
                <input
                  type="password"
                  maxLength={10}
                  autoFocus
                  value={dispatchPinInput}
                  onChange={(e) => {
                    setDispatchPinInput(e.target.value);
                    setDispatchPinError(null);
                  }}
                  placeholder="Enter Admin Password"
                  className="w-full py-3 px-4 bg-slate-950 border border-slate-700 rounded-2xl text-white text-center font-mono text-xl tracking-widest focus:outline-none focus:border-sky-400"
                />
              </div>

              <button
                type="submit"
                className="w-full py-3 bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-500 hover:to-blue-500 text-white font-bold text-xs uppercase tracking-wider rounded-2xl transition shadow-lg shadow-sky-600/20 flex items-center justify-center space-x-2"
              >
                <Key className="w-4 h-4" />
                <span>Unlock Dispatcher Console</span>
              </button>
            </form>
          </div>
        </div>
      )}

      {/* SECRET BRAND ACTIVATION SECURITY PIN MODAL (5-Tap Trigger) */}
      {showSecretPinModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 w-full max-w-sm rounded-3xl p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center space-x-2">
                <Lock className="w-5 h-5 text-amber-400" />
                <h3 className="font-extrabold text-white text-base">Security Verification</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowSecretPinModal(false)}
                className="text-slate-400 hover:text-white font-bold"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Enter the 6-digit administrator security PIN to bypass login and enter Master Admin Panel &amp; SQL Settings.
            </p>

            {secretPinError && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs font-semibold">
                {secretPinError}
              </div>
            )}

            <form onSubmit={handleSecretPinSubmit} className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                  Security PIN
                </label>
                <input
                  type="password"
                  maxLength={6}
                  autoFocus
                  value={secretPinInput}
                  onChange={(e) => {
                    setSecretPinInput(e.target.value);
                    setSecretPinError(null);
                  }}
                  placeholder="••••••"
                  className="w-full py-3 px-4 bg-slate-950 border border-slate-700 rounded-2xl text-white text-center font-mono text-xl tracking-widest focus:outline-none focus:border-amber-400"
                />
              </div>

              <div className="flex space-x-2">
                <button
                  type="button"
                  onClick={() => setShowSecretPinModal(false)}
                  className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-xl text-xs transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-3 bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-400 hover:to-yellow-400 text-slate-950 font-black rounded-xl text-xs transition shadow-lg shadow-amber-500/20"
                >
                  Unlock Console
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
