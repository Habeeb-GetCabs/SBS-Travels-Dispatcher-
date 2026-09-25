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
  ShiftMetrics
} from './services/tripService';
import { AdminDispatchModal } from './components/AdminDispatchModal';
import { TripDetails } from './components/TripDetails';
import { ActiveTripMeter } from './components/ActiveTripMeter';
import { TripSummaryModal } from './components/TripSummaryModal';
import { soundEngine } from './services/audioService';
import { SBS_TRAVELS_SQL_SCHEMA } from './services/schemaSql';
import {
  verifyDriverSession,
  signInDriver,
  signOutDriver,
  onDriverAuthStateChange,
  getDriverSession,
} from './services/authService';
import { Session } from '@supabase/supabase-js';
import { Copy, Check, Lock, UserCheck, LogIn } from 'lucide-react';

export default function App() {
  // Supabase Configuration State (Phase 2.3.5 Clean Driver UI)
  const [isConfigured] = useState<boolean>(isSupabaseConfigured());
  const [showSettingsModal, setShowSettingsModal] = useState<boolean>(false);

  // Driver & Active Trip State
  const [driver, setDriver] = useState<DriverProfile>(getStoredDriverProfile());
  const [activeTrip, setActiveTripState] = useState<Trip | null>(getActiveTrip());
  const [completedSummary, setCompletedSummary] = useState<CompletedTripData | null>(null);

  // Driver Supabase Authentication State (Phase 2.2C)
  const [driverSession, setDriverSession] = useState<Session | null>(null);
  const [isDriverAuthLoading, setIsDriverAuthLoading] = useState<boolean>(true);
  const [driverAuthError, setDriverAuthError] = useState<string | null>(null);
  const [showDriverLoginModal, setShowDriverLoginModal] = useState<boolean>(false);
  const [driverLoginEmail, setDriverLoginEmail] = useState<string>('');
  const [driverLoginPassword, setDriverLoginPassword] = useState<string>('');
  const [isDriverLoggingIn, setIsDriverLoggingIn] = useState<boolean>(false);
  const [isDriverUnlinked, setIsDriverUnlinked] = useState<boolean>(false);

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

  const handleSaveDriverProfile = (e: React.FormEvent) => {
    e.preventDefault();
    const updated: DriverProfile = {
      ...driver,
      name: editDriverName.trim() || driver.name,
      mobile: editDriverMobile.trim() || driver.mobile,
      vehicleNumber: editVehicleNumber.trim() || driver.vehicleNumber,
      vehicleModel: editVehicleModel.trim() || driver.vehicleModel,
      driverCode: editDriverCode.trim() || driver.driverCode,
    };
    saveDriverProfile(updated);
    setDriver(updated);
    setShowDriverEditModal(false);
  };

  // Active Trip Recovery on startup, Driver Session verification, & Realtime Listener (Sections 33, 36)
  useEffect(() => {
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

    // 1. Authoritative Driver Supabase Session Verification (Phase 2.2C)
    if (isSupabaseConfigured()) {
      verifyDriverSession().then(({ session, profile, isLinked }) => {
        setDriverSession(session);
        if (profile) {
          setDriver(profile);
          setIsDriverUnlinked(false);
        } else if (session && !isLinked) {
          setIsDriverUnlinked(true);
        }
        setIsDriverAuthLoading(false);
      });

      const unsubscribeAuth = onDriverAuthStateChange((session, profile) => {
        setDriverSession(session);
        if (profile) {
          setDriver(profile);
          setIsDriverUnlinked(false);
        } else if (session) {
          setIsDriverUnlinked(true);
        } else {
          setIsDriverUnlinked(false);
        }
      });

      // 2. Listen to Supabase Realtime changes
      fetchOpenTripsForDriver().then(setOpenTripsList);

      const unsubscribeTrips = subscribeToTripsRealtime(() => {
        setCompletedList(getCompletedTrips());
        setShiftMetrics(getTodayShiftMetrics());
        if (isSupabaseConfigured()) {
          fetchOpenTripsForDriver().then(setOpenTripsList);
        }
      });

      return () => {
        unsubscribeAuth();
        unsubscribeTrips();
      };
    } else {
      setIsDriverAuthLoading(false);
    }
  }, []);

  // Driver Live GPS Location & Operational Status Synchronization (Phase 2.3.2)
  useEffect(() => {
    if (!driverSession || driver.operationalStatus === 'OFFLINE' || typeof window === 'undefined' || !navigator.geolocation) {
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
  }, [driverSession, driver.id, driver.operationalStatus]);

  // Driver Login Handler (Phase 2.2C)
  const handleDriverLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setDriverAuthError(null);
    setIsDriverLoggingIn(true);
    try {
      const res = await signInDriver(driverLoginEmail, driverLoginPassword);
      if (res.success && res.profile) {
        setDriver(res.profile);
        setDriverSession(res.session || null);
        setShowDriverLoginModal(false);
        setDriverLoginPassword('');
        setIsDriverUnlinked(false);
      } else {
        setDriverAuthError(res.error || 'Invalid driver credentials.');
      }
    } catch (err: any) {
      setDriverAuthError(err?.message || 'Driver authentication error.');
    } finally {
      setIsDriverLoggingIn(false);
    }
  };

  // Driver Sign-Out Handler (Phase 2.2C)
  const handleDriverSignOut = async () => {
    await signOutDriver();
    setDriverSession(null);
    setIsDriverUnlinked(false);
    setDriver(getStoredDriverProfile());
  };

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
    setCompletedList(getCompletedTrips());
    setShiftMetrics(getTodayShiftMetrics());

    // Reset driver to READY
    const updatedDriver = { ...driver, operationalStatus: 'READY' as const };
    setDriver(updatedDriver);
    saveDriverProfile(updatedDriver);
  };

  const handleSummaryDone = () => {
    setCompletedSummary(null);
    setActiveTab('home');
  };

  return (
    <div className="min-h-screen bg-[#0b1329] text-slate-100 flex flex-col font-sans select-none antialiased">
      {/* Top App Header */}
      <header className="bg-[#111c38]/90 border-b border-slate-800/80 px-4 py-3 sticky top-0 z-30 backdrop-blur-md shadow-md">
        <div className="max-w-md mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <button
              type="button"
              onClick={() => setShowHamburgerMenu(true)}
              className="w-9 h-9 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 text-sky-400 flex items-center justify-center transition border border-slate-700/60 active:scale-95 shadow-sm"
              aria-label="Open Navigation Menu"
            >
              <Menu className="w-5 h-5 text-sky-400" />
            </button>
            <div>
              <h1 className="text-base font-black tracking-tight text-white leading-tight">
                SBS Travels
              </h1>
              <p className="text-[10px] tracking-wider text-sky-400 font-extrabold uppercase">
                Driver Application
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => setShowDispatchModal(true)}
              className="px-3 py-1 rounded-full text-xs font-bold bg-sky-950/80 hover:bg-sky-900 border border-sky-500/40 text-sky-300 transition flex items-center space-x-1.5 shadow-sm"
              title="Admin Dispatcher"
            >
              <Radio className="w-3.5 h-3.5 text-sky-400 animate-pulse" />
              <span>Dispatch</span>
            </button>
          </div>
        </div>
      </header>

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
                  onClick={() => { setShowDriverEditModal(true); setShowHamburgerMenu(false); }}
                  className="w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-xl hover:bg-slate-800/60 text-slate-300 transition"
                >
                  <User className="w-4 h-4 text-slate-400" />
                  <span>MY PROFILE</span>
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
                  onClick={() => { setShowDispatchModal(true); setShowHamburgerMenu(false); }}
                  className="w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-xl hover:bg-slate-800/60 text-slate-300 transition"
                >
                  <Radio className="w-4 h-4 text-sky-400" />
                  <span>DISPATCH CONSOLE</span>
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
              {isConfigured && driverSession?.user && (
                <button
                  type="button"
                  onClick={() => { handleDriverSignOut(); setShowHamburgerMenu(false); }}
                  className="w-full flex items-center justify-center space-x-2 py-2.5 bg-rose-950/40 text-rose-300 font-bold rounded-xl border border-rose-800/50 hover:bg-rose-900/40 transition text-xs shadow-sm"
                >
                  <LogOut className="w-4 h-4" />
                  <span>LOGOUT DRIVER</span>
                </button>
              )}
              <div className="text-center text-[10px] text-slate-500 font-semibold">
                SBS Travels Driver App v2.3.4
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
            {/* 1. DRIVER PROFILE CARD */}
            <div className="bg-gradient-to-br from-[#1e293b] via-[#0f172a] to-[#1e293b] border border-slate-700/60 rounded-2xl p-4 shadow-lg space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      Driver Profile
                    </span>
                    {isConfigured && (
                      driverSession?.user && driver.authUserId ? (
                        <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                          <UserCheck className="w-3 h-3 text-emerald-400" />
                          <span>Verified</span>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setDriverAuthError(null);
                            setShowDriverLoginModal(true);
                          }}
                          className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/30 text-sky-400 transition"
                        >
                          <LogIn className="w-3 h-3 text-sky-400" />
                          <span>Sign In</span>
                        </button>
                      )
                    )}
                    <button
                      onClick={() => {
                        setEditDriverName(driver.name);
                        setEditDriverMobile(driver.mobile);
                        setEditVehicleNumber(driver.vehicleNumber);
                        setEditVehicleModel(driver.vehicleModel || '');
                        setEditDriverCode(driver.driverCode);
                        setShowDriverEditModal(true);
                      }}
                      className="text-[10px] text-sky-400 hover:text-sky-300 flex items-center space-x-0.5 font-bold transition"
                    >
                      <UserCog className="w-3 h-3" />
                      <span>Edit</span>
                    </button>
                  </div>
                  <h2 className="text-xl font-black text-white tracking-tight mt-0.5">
                    {driver.name}
                  </h2>
                  <div className="flex items-center space-x-2 mt-1">
                    <span className="bg-slate-900 text-sky-300 border border-slate-700 px-2 py-0.5 rounded text-xs font-mono font-bold tracking-wider">
                      {driver.vehicleNumber}
                    </span>
                    <span className="text-xs text-slate-300 font-bold">
                      {driver.driverCode}
                    </span>
                    {driver.vehicleModel && (
                      <span className="text-xs text-slate-400 truncate max-w-[130px]">
                        • {driver.vehicleModel}
                      </span>
                    )}
                  </div>
                </div>

                {/* Status indicator */}
                <div className="text-right flex flex-col items-end">
                  <div
                    className={`inline-flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-black border ${
                      driver.operationalStatus === 'READY'
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                        : 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${driver.operationalStatus === 'READY' ? 'bg-emerald-400 animate-ping' : 'bg-amber-400'}`} />
                    <span>{driver.operationalStatus}</span>
                  </div>

                  <div className="text-[11px] font-semibold text-slate-400 mt-1 flex items-center justify-end space-x-1">
                    {driver.activationStatus === 'ACTIVE' ? (
                      <>
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-emerald-400 font-bold">Device Active</span>
                      </>
                    ) : (
                      <>
                        <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
                        <span className="text-amber-400 font-bold">{driver.activationStatus}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Shift Duty Toggle */}
              <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs">
                <div className="flex items-center space-x-1.5">
                  <span className="text-[11px] text-slate-400 font-medium">Duty Status:</span>
                  <span className={`font-black ${driver.operationalStatus === 'READY' ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {driver.operationalStatus === 'READY' ? 'ONLINE (READY)' : 'OFFLINE (BREAK)'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleToggleShiftStatus}
                  className={`px-3 py-1 rounded-xl text-xs font-bold transition shadow-sm ${
                    driver.operationalStatus === 'READY'
                      ? 'bg-amber-950/60 hover:bg-amber-900 text-amber-300 border border-amber-700/60'
                      : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-900/20'
                  }`}
                >
                  {driver.operationalStatus === 'READY' ? 'Go Offline' : 'Go Online'}
                </button>
              </div>
            </div>

            {/* 2. TODAY'S SUMMARY (4 Metric Cards) */}
            <div className="bg-gradient-to-br from-[#1e293b] via-[#0f172a] to-[#1e293b] border border-slate-700/60 rounded-2xl p-3.5 shadow-lg space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  Today's Shift Summary
                </span>
                <span className="text-xs font-bold text-emerald-400">
                  {shiftMetrics.totalTripsToday} {shiftMetrics.totalTripsToday === 1 ? 'Trip' : 'Trips'}
                </span>
              </div>

              <div className="grid grid-cols-4 gap-1.5 text-center pt-0.5">
                <div className="bg-slate-900/90 p-2 rounded-xl border border-emerald-500/20">
                  <span className="text-[9px] text-emerald-400/80 block uppercase font-bold">Revenue</span>
                  <p className="text-sm font-black font-mono text-emerald-400">
                    ₹{shiftMetrics.totalEarningsToday}
                  </p>
                </div>
                <div className="bg-slate-900/90 p-2 rounded-xl border border-cyan-500/20">
                  <span className="text-[9px] text-cyan-400/80 block uppercase font-bold">Trips</span>
                  <p className="text-sm font-black font-mono text-cyan-400">
                    {shiftMetrics.totalTripsToday}
                  </p>
                </div>
                <div className="bg-slate-900/90 p-2 rounded-xl border border-sky-500/20">
                  <span className="text-[9px] text-sky-400/80 block uppercase font-bold">Distance</span>
                  <p className="text-sm font-black font-mono text-sky-400">
                    {shiftMetrics.totalDistanceKmToday} <span className="text-[9px] text-slate-400">km</span>
                  </p>
                </div>
                <div className="bg-slate-900/90 p-2 rounded-xl border border-violet-500/20">
                  <span className="text-[9px] text-violet-400/80 block uppercase font-bold">Time</span>
                  <p className="text-sm font-black font-mono text-violet-400">
                    {shiftMetrics.totalDurationMinutesToday} <span className="text-[9px] text-slate-400">m</span>
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

            {/* Device Activation Warning if not ACTIVE */}
            {driver.activationStatus !== 'ACTIVE' && (
              <div className="bg-rose-950/60 border border-rose-700/60 rounded-2xl p-3.5 flex items-center space-x-3 text-rose-200 text-xs">
                <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0" />
                <div className="flex-1">
                  <p className="font-bold text-white">Device Not Authorized ({driver.activationStatus})</p>
                  <p className="text-[11px] text-rose-300/80">
                    Contact dispatch or use the Dispatcher Console to authorize this device before claiming trips.
                  </p>
                </div>
              </div>
            )}

            {/* 3. GET TRIP (PRIMARY OPERATIONAL ACTION CARD) */}
            <div className="bg-gradient-to-br from-[#1e293b] via-[#0f172a] to-[#131f37] border-2 border-sky-500/40 rounded-3xl p-6 text-center shadow-xl space-y-3">
              <div className="w-14 h-14 rounded-2xl bg-sky-500/10 border border-sky-500/30 text-sky-400 flex items-center justify-center mx-auto mb-1 shadow-md">
                <Radio className="w-7 h-7 text-sky-400 animate-pulse" />
              </div>
              <h3 className="text-lg font-black text-white tracking-wide">GET TRIP</h3>
              <p className="text-xs text-slate-300 max-w-xs mx-auto leading-relaxed font-medium">
                Enter your 6-digit Trip Access OTP provided by dispatch to claim and execute your trip.
              </p>

              <div className="pt-2">
                <button
                  disabled={isConfigured && driverSession?.user && driver.activationStatus !== 'ACTIVE'}
                  onClick={() => {
                    if (isConfigured && (!driverSession?.user || !driver.authUserId)) {
                      setDriverAuthError('Please sign in with your authorized Driver account before getting trips.');
                      setShowDriverLoginModal(true);
                      return;
                    }
                    setTripAccessOtp('');
                    setClaimError(null);
                    setLoadTripModal(true);
                  }}
                  className={`w-full py-4 px-6 rounded-2xl font-black text-base tracking-wider shadow-lg active:scale-[0.98] transition flex items-center justify-center space-x-2 ${
                    !isConfigured || (driverSession?.user && driver.activationStatus === 'ACTIVE')
                      ? 'bg-gradient-to-r from-sky-600 via-blue-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white shadow-sky-600/30'
                      : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                  }`}
                >
                  <Key className="w-5 h-5" />
                  <span>GET TRIP</span>
                </button>
              </div>
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

            {/* About Us Footer Branding */}
            <div className="pt-4 pb-2 text-center space-y-1">
              <h4 className="text-lg font-black tracking-tight text-white uppercase">
                SBS Travels
              </h4>
              <p className="text-[10px] font-bold text-slate-400 tracking-wider uppercase">
                Powered by
              </p>
              <div className="pt-0.5 inline-flex items-center space-x-1.5 px-3.5 py-1.5 bg-slate-950 border border-red-600/80 rounded-xl shadow-lg">
                <span className="text-red-500 font-black tracking-wider text-xs uppercase">GET TAXI</span>
                <span className="bg-white text-slate-950 px-1.5 py-0.2 rounded font-black text-[11px] tracking-wide uppercase">BASHEER</span>
              </div>
            </div>
          </div>
        )}

        {/* Footer Credit with Refined Hierarchy GET TAXI BASHEER Branding */}
        <footer className="pt-6 pb-4 text-center space-y-1">
          <h4 className="text-lg font-black tracking-tight text-white uppercase">
            SBS Travels
          </h4>
          <p className="text-[10px] font-bold text-slate-400 tracking-wider uppercase">
            Powered by
          </p>
          <div className="pt-0.5 inline-flex items-center space-x-1.5 px-3.5 py-1.5 bg-slate-950 border border-red-600/80 rounded-xl shadow-lg">
            <span className="text-red-500 font-black tracking-wider text-xs uppercase">GET TAXI</span>
            <span className="bg-white text-slate-950 px-1.5 py-0.2 rounded font-black text-[11px] tracking-wide uppercase">BASHEER</span>
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

      {/* DRIVER & VEHICLE PROFILE MODAL */}
      {showDriverEditModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0f172a] border border-slate-800 w-full max-w-sm rounded-3xl p-5 shadow-2xl space-y-4 animate-in zoom-in-95 duration-150 text-slate-100">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <UserCog className="w-4 h-4 text-sky-400" />
                <h3 className="font-bold text-sm text-white">Edit Driver &amp; Vehicle</h3>
              </div>
              <button
                onClick={() => setShowDriverEditModal(false)}
                className="w-6 h-6 rounded-full bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center text-xs font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveDriverProfile} className="space-y-3 text-xs">
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
                    placeholder="DRV-101"
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
                  placeholder="e.g. Toyota Innova Crysta"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-sky-500"
                />
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  className="w-full py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs shadow-md transition active:scale-[0.98]"
                >
                  Save Profile &amp; Vehicle
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DRIVER AUTHENTICATION MODAL */}
      {showDriverLoginModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0f172a] border border-slate-800 w-full max-w-sm rounded-3xl p-6 shadow-2xl space-y-4 animate-in zoom-in-95 duration-150 text-slate-100">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 rounded-xl bg-sky-500/10 text-sky-400 flex items-center justify-center">
                  <Lock className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-white">Driver Sign-In</h3>
                  <p className="text-[11px] text-slate-400">Sign in to your SBS Travels Driver Account</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowDriverLoginModal(false);
                  setDriverAuthError(null);
                }}
                className="w-7 h-7 rounded-full bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center text-xs font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleDriverLogin} className="space-y-3.5 text-xs">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                  Driver Email / Login
                </label>
                <input
                  type="email"
                  required
                  autoFocus
                  value={driverLoginEmail}
                  onChange={(e) => setDriverLoginEmail(e.target.value)}
                  placeholder="driver@sbstravels.com"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                  Password
                </label>
                <input
                  type="password"
                  required
                  value={driverLoginPassword}
                  onChange={(e) => setDriverLoginPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 font-mono"
                />
              </div>

              {driverAuthError && (
                <div className="p-2.5 rounded-xl bg-rose-950/60 border border-rose-700/60 text-rose-300 text-xs flex items-start space-x-2">
                  <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <p className="leading-snug text-[11px]">{driverAuthError}</p>
                </div>
              )}

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isDriverLoggingIn}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-500 hover:to-blue-500 text-white font-bold text-xs shadow-md transition active:scale-[0.98] flex items-center justify-center space-x-1.5"
                >
                  {isDriverLoggingIn ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Verifying Credentials...</span>
                    </>
                  ) : (
                    <>
                      <LogIn className="w-3.5 h-3.5" />
                      <span>Authenticate Driver Session</span>
                    </>
                  )}
                </button>
              </div>

              <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-[10px] text-slate-400 text-center leading-relaxed font-medium">
                Your driver account is securely connected to your assigned driver profile.
              </div>
            </form>
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

              {/* Account Status */}
              <div className="p-3 bg-slate-950 border border-slate-800 rounded-2xl space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white">Driver Account</span>
                  <span className="font-mono text-sky-400 font-bold">{driver.driverCode}</span>
                </div>
                <p className="text-[11px] text-slate-300 font-medium">{driver.name} • {driver.vehicleNumber}</p>
                <p className="text-[10px] text-slate-500">
                  {driverSession?.user ? `Signed in as ${driverSession.user.email}` : 'Local driver profile'}
                </p>
              </div>

              {/* Version & About */}
              <div className="p-3 bg-slate-950 border border-slate-800 rounded-2xl text-center space-y-1">
                <p className="font-bold text-slate-200 text-xs">SBS Travels Driver Application</p>
                <p className="text-[11px] text-slate-400 font-medium">Version 2.3.4 (Production Build)</p>
                <div className="pt-1 flex flex-col items-center">
                  <span className="text-[10px] text-slate-400 font-bold uppercase">Powered by</span>
                  <div className="inline-flex items-center space-x-1 px-2 py-0.5 bg-slate-900 border border-red-600/80 rounded mt-0.5">
                    <span className="text-red-500 font-black text-[10px]">GET TAXI</span>
                    <span className="bg-white text-slate-950 px-1 py-0.2 rounded font-black text-[9px]">BASHEER</span>
                  </div>
                </div>
              </div>

              {/* Sign out button */}
              {driverSession?.user && (
                <button
                  type="button"
                  onClick={() => { handleDriverSignOut(); setShowSettingsModal(false); }}
                  className="w-full py-2.5 bg-rose-950/40 hover:bg-rose-900/40 text-rose-300 font-bold rounded-xl border border-rose-800/50 transition text-xs flex items-center justify-center space-x-1.5"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Log Out Driver Session</span>
                </button>
              )}
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
      />
    </div>
  );
}
