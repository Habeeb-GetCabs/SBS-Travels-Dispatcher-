import React, { useState, useEffect, useRef } from 'react';
import { Trip, DriverProfile, CompletedTripData } from '../types';
import {
  Navigation,
  Clock,
  Timer,
  Gauge,
  ShieldAlert,
  Phone,
  AlertTriangle,
  Volume2,
  VolumeX,
  Plus,
  Minus,
  Maximize2,
  Minimize2,
  Receipt,
  LifeBuoy,
  X,
  FlipHorizontal,
  CheckCircle2,
  MapPin,
  Car
} from 'lucide-react';
import {
  completeTripAtomic,
  saveActiveMeterSnapshot,
  getActiveMeterSnapshot,
  clearActiveMeterSnapshot,
} from '../services/tripService';
import { calculateCustomTripFare, validateTariffConfig } from '../services/tariffService';
import { soundEngine, getStoredWelcomeMessage } from '../services/audioService';
import { GpsHardeningEngine, GpsSignalState } from '../services/gpsFilter';

interface Props {
  trip: Trip;
  driver: DriverProfile;
  onTripCompleted: (summary: CompletedTripData) => void;
  onExitDemo?: () => void;
}

export const ActiveTripMeter: React.FC<Props> = ({ trip, driver, onTripCompleted, onExitDemo }) => {
  // Validate custom tariff config
  const tariffCheck = validateTariffConfig(trip.tariffConfig);

  // Meter State (Initialized from crash/background snapshot if available)
  const [distanceKm, setDistanceKm] = useState<number>(() => {
    const snap = getActiveMeterSnapshot(trip.id);
    return snap ? snap.distanceKm : 0;
  });
  const [durationSeconds, setDurationSeconds] = useState<number>(() => {
    const snap = getActiveMeterSnapshot(trip.id);
    return snap ? snap.durationSeconds : 0;
  });
  const [waitingSeconds, setWaitingSeconds] = useState<number>(() => {
    const snap = getActiveMeterSnapshot(trip.id);
    return snap ? snap.waitingSeconds : 0;
  });
  const [currentSpeedKmh, setCurrentSpeedKmh] = useState<number>(0);
  const [gpsStatus, setGpsStatus] = useState<GpsSignalState>('SEARCHING');

  // Toll & Parking / Extra Charges
  const [extraTolls, setExtraTolls] = useState<number>(() => {
    const snap = getActiveMeterSnapshot(trip.id);
    return snap ? snap.extraTolls : 0;
  });
  const [extraParking, setExtraParking] = useState<number>(() => {
    const snap = getActiveMeterSnapshot(trip.id);
    return snap ? snap.extraParking : 0;
  });
  const [showTollModal, setShowTollModal] = useState<boolean>(false);
  const [customTollInput, setCustomTollInput] = useState<string>('');

  // Audio & Layout State
  const [isSoundMuted, setIsSoundMuted] = useState<boolean>(!soundEngine.isEnabled());
  const [isMiniPipMode, setIsMiniPipMode] = useState<boolean>(false);
  const [isHudMode, setIsHudMode] = useState<boolean>(false);
  const [showSosModal, setShowSosModal] = useState<boolean>(false);

  // End Trip confirmation
  const [showEndConfirm, setShowEndConfirm] = useState<boolean>(false);
  const [isFinishing, setIsFinishing] = useState<boolean>(false);

  // References for GPS, stationary detection, wake lock & speed warning
  const gpsEngineRef = useRef<GpsHardeningEngine>(new GpsHardeningEngine());
  const stationaryTicksRef = useRef<number>(0);
  const watchIdRef = useRef<number | null>(null);
  const wakeLockRef = useRef<any>(null);
  const lastSpeedAlertRef = useRef<number>(0);
  const announcedMilestones = useRef<Set<number>>(new Set());
  const hasAnnouncedWaitingThreshold = useRef<boolean>(false);

  // Dynamic Fare Calculation via authoritative Per-Trip Tariff
  const fareResult = calculateCustomTripFare({
    tariff: trip.tariffConfig,
    distanceKm,
    durationSeconds,
    waitingSeconds,
    extraTolls,
    extraParking,
  });

  // Start Chime, Voice Announcement & Android Foreground Service Bridge
  useEffect(() => {
    soundEngine.playMeterStart();
    const welcomeText = getStoredWelcomeMessage();
    soundEngine.speak(welcomeText);

    // Start Native Android Foreground Service for persistent GPS tracking
    if (typeof window !== 'undefined' && (window as any).AndroidMeterBridge?.startForegroundMeter) {
      try {
        (window as any).AndroidMeterBridge.startForegroundMeter(
          trip.tripNumber,
          trip.customerName
        );
      } catch (err) {
        console.warn('Native foreground bridge notice:', err);
      }
    }

    return () => {
      // Stop Native Android Foreground Service on unmount
      if (typeof window !== 'undefined' && (window as any).AndroidMeterBridge?.stopForegroundMeter) {
        try {
          (window as any).AndroidMeterBridge.stopForegroundMeter();
        } catch (err) {
          console.warn('Native foreground bridge stop notice:', err);
        }
      }
    };
  }, [trip.tripNumber, trip.customerName]);

  // Periodic Telemetry Snapshot (Saved every 10 seconds for crash / background recovery)
  useEffect(() => {
    const snapshotInterval = setInterval(() => {
      saveActiveMeterSnapshot({
        tripId: trip.id,
        tripNumber: trip.tripNumber,
        status: 'STARTED',
        startTime: Date.now() - durationSeconds * 1000,
        distanceKm,
        durationSeconds,
        waitingSeconds,
        currentFare: fareResult.totalFare,
        extraTolls,
        extraParking,
        lastLocationTimestamp: Date.now(),
        tariffConfig: trip.tariffConfig,
      });
    }, 10000);

    return () => clearInterval(snapshotInterval);
  }, [trip, distanceKm, durationSeconds, waitingSeconds, extraTolls, extraParking, fareResult.totalFare]);

  // Screen Wake Lock API to prevent phone screen sleep while driving
  useEffect(() => {
    const requestWakeLock = async () => {
      if ('wakeLock' in navigator) {
        try {
          wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
        } catch {
          // Gracefully continue if wake lock is denied
        }
      }
    };

    requestWakeLock();

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        requestWakeLock();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
    };
  }, []);

  // Distance calculation helper (Haversine formula)
  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371; // Earth radius in km
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

  // Timer loop for trip duration
  useEffect(() => {
    const timer = setInterval(() => {
      setDurationSeconds((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // Hardened GPS Geolocation Engine & Liveness Monitor
  useEffect(() => {
    // Liveness heartbeat to detect signal loss/recovery
    const livenessTimer = setInterval(() => {
      const state = gpsEngineRef.current.checkSignalLiveness();
      setGpsStatus((prev) => {
        if (state === 'GPS_LOST' && prev !== 'GPS_LOST') {
          return 'GPS_LOST';
        }
        return prev;
      });
    }, 3000);

    if ('geolocation' in navigator) {
      watchIdRef.current = navigator.geolocation.watchPosition(
        (position) => {
          const raw = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            speed: position.coords.speed,
            heading: position.coords.heading,
            timestamp: position.timestamp || Date.now(),
          };

          const fix = gpsEngineRef.current.processRawGps(raw);

          // Update GPS signal status & speed
          setGpsStatus(fix.signalState);
          setCurrentSpeedKmh(fix.speedKmh);

          // Over-speed caution alert (exceeding 80 km/h)
          const now = Date.now();
          if (fix.speedKmh > 80 && now - lastSpeedAlertRef.current > 10000) {
            soundEngine.playOverSpeedWarning();
            lastSpeedAlertRef.current = now;
          }

          // Movement vs Stationary handling
          if (!fix.isStationary && fix.distanceDeltaKm > 0.005) {
            setDistanceKm((prev) => {
              const nextDist = Number((prev + fix.distanceDeltaKm).toFixed(2));

              // Milestone Audio Announcements (5, 10, 25, 50, 75, 100 km)
              const milestones = [5, 10, 25, 50, 75, 100];
              for (const m of milestones) {
                if (nextDist >= m && !announcedMilestones.current.has(m)) {
                  announcedMilestones.current.add(m);
                  soundEngine.speak(`${m} kilometers completed.`);
                }
              }

              return nextDist;
            });
            stationaryTicksRef.current = 0;
          } else if (fix.isStationary) {
            // Stationary Waiting Detection
            stationaryTicksRef.current += 1;
            if (stationaryTicksRef.current >= 2) {
              setWaitingSeconds((prev) => {
                const nextWait = prev + 1;
                // Grace period notification
                const graceSecs = (trip.tariffConfig?.waitingGraceMinutes || 15) * 60;
                if (nextWait >= graceSecs && !hasAnnouncedWaitingThreshold.current) {
                  hasAnnouncedWaitingThreshold.current = true;
                  soundEngine.speak('Waiting time has exceeded grace period.');
                }
                // Audible cue for every full 5 minutes of waiting
                if (nextWait > 0 && nextWait % 300 === 0) {
                  soundEngine.playWaitingBeep();
                }
                return nextWait;
              });
            }
          }
        },
        (error) => {
          console.warn('GPS location tracking error:', error.message);
          setGpsStatus('SEARCHING');
        },
        {
          enableHighAccuracy: true,
          maximumAge: 1000,
          timeout: 5000,
        }
      );
    }

    return () => {
      clearInterval(livenessTimer);
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, [trip.tariffConfig]);

  // If tariff is missing or corrupt, block execution
  if (!tariffCheck.valid) {
    return (
      <div className="bg-rose-950/80 border border-rose-600 rounded-3xl p-6 text-center space-y-4">
        <ShieldAlert className="w-12 h-12 text-rose-400 mx-auto" />
        <h2 className="text-lg font-bold text-white">Meter Configuration Error</h2>
        <p className="text-xs text-rose-200">{tariffCheck.error}</p>
        <p className="text-[11px] text-slate-400">
          This trip cannot proceed without a valid server tariff. Please contact dispatch.
        </p>
      </div>
    );
  }

  // Navigation to Drop Address
  const handleNavigateDrop = () => {
    let dest = trip.dropAddress;
    if (trip.dropLatitude && trip.dropLongitude) {
      dest = `${trip.dropLatitude},${trip.dropLongitude}`;
    }
    const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`;

    // Invoke native Android PiP where supported, or enable mini in-app floating meter
    if (typeof window !== 'undefined' && (window as any).AndroidMeterBridge?.enterPiP) {
      try {
        (window as any).AndroidMeterBridge.enterPiP();
      } catch (e) {
        setIsMiniPipMode(true);
      }
    } else {
      setIsMiniPipMode(true);
    }

    window.open(mapsUrl, '_blank');
  };

  // Toggle Sound
  const handleToggleSound = () => {
    const isNowEnabled = soundEngine.toggleSound();
    setIsSoundMuted(!isNowEnabled);
  };

  // Simulation controls for testing
  const handleSimulateMovement = () => {
    setDistanceKm((prev) => Number((prev + 1.2).toFixed(2)));
    setCurrentSpeedKmh(48);
    setGpsStatus('GOOD');
  };

  const handleSimulateWaiting = () => {
    setWaitingSeconds((prev) => prev + 60);
    setCurrentSpeedKmh(0);
    soundEngine.playWaitingBeep();
  };

  const handleAddToll = (amount: number) => {
    setExtraTolls((prev) => Math.max(0, prev + amount));
  };

  const handleAddParking = (amount: number) => {
    setExtraParking((prev) => Math.max(0, prev + amount));
  };

  // Authoritative Safe End Trip
  const handleFinalizeTrip = async () => {
    setIsFinishing(true);
    soundEngine.playTripCompleted();
    soundEngine.speak(`Trip completed. Total fare is ${fareResult.totalFare} rupees.`);
    const now = new Date().toISOString();

    const summary: CompletedTripData = {
      id: `comp-${Date.now()}`,
      tripId: trip.id,
      tripNumber: trip.tripNumber,
      driverId: driver.id,
      deviceId: driver.deviceId,
      customerName: trip.customerName,
      customerMobile: trip.customerMobile,
      pickupAddress: trip.pickupAddress,
      dropAddress: trip.dropAddress,
      distanceKm,
      durationSeconds,
      waitingSeconds,
      baseFare: fareResult.baseFare,
      distanceFare: fareResult.distanceFare,
      waitingFare: fareResult.waitingFare,
      driverBata: fareResult.driverBata,
      toll: fareResult.toll,
      parking: fareResult.parking,
      interstateTax: fareResult.interstateTax,
      additionalCharges: fareResult.additionalCharges,
      discount: fareResult.discount,
      totalFare: fareResult.totalFare,
      completedAt: now,
      isSynced: false,
      tariffConfig: trip.tariffConfig,
    };

    // Stop Native Foreground Service
    if (typeof window !== 'undefined' && (window as any).AndroidMeterBridge?.stopForegroundMeter) {
      try {
        (window as any).AndroidMeterBridge.stopForegroundMeter();
      } catch (err) {
        console.warn('Native bridge stop notice:', err);
      }
    }

    // For demo simulation trips, complete locally without remote Supabase RPC
    if (trip.id === 'demo-trip-999' || trip.tripNumber?.startsWith('DEMO')) {
      clearActiveMeterSnapshot(trip.id);
      setIsFinishing(false);
      onTripCompleted(summary);
      return;
    }

    // Atomic server-authoritative trip completion
    const res = await completeTripAtomic(trip.id, driver, summary);
    if (!res.success) {
      alert(res.error || 'Failed to complete trip on server.');
      setIsFinishing(false);
      return;
    }
    clearActiveMeterSnapshot(trip.id);

    setIsFinishing(false);
    onTripCompleted(summary);
  };

  const formatTime = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // MINI PIP COMPACT FLOATING VIEW
  if (isMiniPipMode) {
    return (
      <div className="fixed bottom-4 right-4 z-50 bg-slate-900 border-2 border-emerald-500 rounded-3xl p-3.5 shadow-2xl w-68 space-y-2.5 animate-in fade-in zoom-in-95">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
            <span className="font-mono font-bold text-xs text-sky-400">{trip.tripNumber}</span>
          </div>

          <div className="flex items-center space-x-1.5">
            {/* GPS Signal Status Badge */}
            <span
              className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase flex items-center space-x-1 ${
                gpsStatus === 'GOOD'
                  ? 'bg-emerald-950 text-emerald-400 border border-emerald-700/50'
                  : gpsStatus === 'FAIR'
                  ? 'bg-amber-950 text-amber-400 border border-amber-700/50'
                  : gpsStatus === 'GPS_LOST'
                  ? 'bg-rose-950 text-rose-400 border border-rose-700/50 animate-pulse'
                  : 'bg-slate-800 text-slate-400'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  gpsStatus === 'GOOD'
                    ? 'bg-emerald-400'
                    : gpsStatus === 'FAIR'
                    ? 'bg-amber-400'
                    : 'bg-rose-400 animate-ping'
                }`}
              />
              <span>{gpsStatus === 'GPS_LOST' ? 'LOST' : gpsStatus}</span>
            </span>

            <button
              onClick={() => setIsMiniPipMode(false)}
              className="w-6 h-6 rounded-full bg-slate-800 text-slate-300 hover:text-white flex items-center justify-center text-xs"
              title="Expand Full Meter"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="text-center bg-slate-950/70 p-2 rounded-2xl border border-slate-800">
          <span className="text-[10px] text-slate-400 uppercase font-semibold block">Live Fare</span>
          <p className="text-3xl font-black font-mono text-white tracking-tight">₹{fareResult.totalFare}</p>
        </div>

        <div className="grid grid-cols-4 gap-1 text-[11px] text-slate-300 font-mono bg-slate-950 p-2 rounded-xl text-center border border-slate-800/80">
          <div>
            <span className="text-[9px] text-slate-500 block uppercase">Dist</span>
            <span className="font-bold text-white">{distanceKm.toFixed(1)}k</span>
          </div>
          <div>
            <span className="text-[9px] text-slate-500 block uppercase">Time</span>
            <span className="font-bold text-white">{formatTime(durationSeconds)}</span>
          </div>
          <div>
            <span className="text-[9px] text-slate-500 block uppercase">Wait</span>
            <span className="font-bold text-amber-400">{formatTime(waitingSeconds)}</span>
          </div>
          <div>
            <span className="text-[9px] text-slate-500 block uppercase">Speed</span>
            <span className="font-bold text-emerald-400">{currentSpeedKmh}</span>
          </div>
        </div>

        <div className="flex space-x-1.5">
          <button
            onClick={() => setIsMiniPipMode(false)}
            className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition text-center shadow-lg"
          >
            Expand Meter
          </button>
          <button
            onClick={() => {
              setIsMiniPipMode(false);
              setShowEndConfirm(true);
            }}
            className="px-3 py-2 bg-rose-600/90 hover:bg-rose-500 text-white rounded-xl text-xs font-bold transition text-center"
            title="Stop Meter"
          >
            End
          </button>
        </div>
      </div>
    );
  }

  // WINDSHIELD HUD MIRROR MODE FOR NIGHT DRIVING
  if (isHudMode) {
    return (
      <div className="fixed inset-0 z-50 bg-black flex flex-col justify-between p-6 text-emerald-400 select-none overflow-hidden">
        {/* Top bar with unmirrored exit button */}
        <div className="flex items-center justify-between">
          <div className="text-xs font-bold tracking-widest uppercase opacity-75">
            SBS Travels • HUD Mode
          </div>
          <button
            onClick={() => setIsHudMode(false)}
            className="px-4 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white text-xs font-bold flex items-center space-x-1.5 hover:bg-slate-800"
          >
            <FlipHorizontal className="w-4 h-4 text-emerald-400" />
            <span>Exit HUD</span>
          </button>
        </div>

        {/* Mirrored container designed to reflect legibly in windshield glass */}
        <div
          style={{ transform: 'scaleX(-1)' }}
          className="my-auto flex flex-col items-center justify-center space-y-4"
        >
          <div className="text-center">
            <span className="text-2xl font-mono tracking-widest text-emerald-500 block uppercase">
              Current Fare
            </span>
            <span className="text-8xl sm:text-9xl font-black font-mono text-white tracking-tighter drop-shadow-[0_0_35px_rgba(16,185,129,0.5)]">
              ₹{fareResult.totalFare}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-8 pt-4 text-center font-mono">
            <div>
              <span className="text-xl text-emerald-500/80 block">KM</span>
              <span className="text-5xl font-black text-white">{distanceKm.toFixed(1)}</span>
            </div>
            <div>
              <span className="text-xl text-emerald-500/80 block">SPEED</span>
              <span className="text-5xl font-black text-white">{currentSpeedKmh}</span>
            </div>
            <div>
              <span className="text-xl text-emerald-500/80 block">TIME</span>
              <span className="text-5xl font-black text-white">{formatTime(durationSeconds)}</span>
            </div>
          </div>
        </div>

        <div className="text-center text-xs text-slate-500 tracking-wider">
          Place phone flat on dashboard beneath windshield for reflection
        </div>
      </div>
    );
  }

  // STANDARD HIGH-CONTRAST DIGITAL TAXI METER
  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {/* Demo Mode Exit Bar */}
      {(trip.id === 'demo-trip-999' || trip.tripNumber?.startsWith('DEMO') || onExitDemo) && (
        <div className="bg-gradient-to-r from-rose-900 via-rose-950 to-slate-900 border border-rose-500/50 rounded-2xl p-3 flex items-center justify-between shadow-lg">
          <div className="flex items-center space-x-2">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-400 animate-pulse" />
            <span className="font-extrabold text-xs text-rose-200 uppercase tracking-wider">
              Demo Simulation Active
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              if (onExitDemo) onExitDemo();
              else clearActiveMeterSnapshot(trip.id);
            }}
            className="px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white font-black text-xs uppercase shadow transition flex items-center space-x-1.5"
          >
            <X className="w-3.5 h-3.5" />
            <span>EXIT DEMO MODE</span>
          </button>
        </div>
      )}

      {/* Top Status & Controls Bar */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-3 shadow-sm flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <span className="bg-sky-500/10 text-sky-400 border border-sky-500/20 px-2 py-0.5 rounded text-xs font-mono font-bold">
            {trip.tripNumber}
          </span>
          <div className="flex items-center space-x-1.5 bg-slate-950 px-2 py-0.5 rounded-full border border-slate-800 text-[10px] font-mono">
            <span
              className={`w-2 h-2 rounded-full ${
                gpsStatus === 'GOOD'
                  ? 'bg-emerald-400'
                  : gpsStatus === 'FAIR'
                  ? 'bg-amber-400'
                  : 'bg-rose-400 animate-pulse'
              }`}
            />
            <span className="text-slate-400 font-bold">{gpsStatus}</span>
          </div>
        </div>

        {/* Quick Utility Actions */}
        <div className="flex items-center space-x-1.5">
          <button
            onClick={handleNavigateDrop}
            className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-sky-400 border border-slate-700 transition"
            title="Navigate to Drop"
          >
            <Navigation className="w-4 h-4" />
          </button>

          <button
            onClick={() => setIsHudMode(true)}
            className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
            title="Windshield HUD Night Mode"
          >
            <FlipHorizontal className="w-4 h-4 text-emerald-400" />
          </button>

          <button
            onClick={() => setIsMiniPipMode(true)}
            className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
            title="Compact Floating Mini-PiP"
          >
            <Minimize2 className="w-4 h-4" />
          </button>

          <button
            onClick={handleToggleSound}
            className={`p-2 rounded-xl border transition ${
              isSoundMuted
                ? 'bg-slate-800/80 border-slate-700 text-slate-500'
                : 'bg-emerald-950/60 border-emerald-600/40 text-emerald-400'
            }`}
            title={isSoundMuted ? 'Unmute Audio Voice Chimes' : 'Mute Voice Announcements'}
          >
            {isSoundMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>

          <button
            onClick={() => setShowSosModal(true)}
            className="p-2 rounded-xl bg-rose-950/80 border border-rose-600/60 text-rose-400 hover:bg-rose-900 transition"
            title="SOS Emergency Assistance"
          >
            <LifeBuoy className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* PRIMARY FARE DISPLAY (Hardware Taxi Meter Design) */}
      <div className="relative bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 border-2 border-emerald-500/40 rounded-3xl p-5 shadow-2xl overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 via-teal-400 to-sky-500 animate-pulse" />

        <div className="flex items-center justify-between text-slate-400 text-xs pb-1">
          <div className="flex items-center space-x-1 font-semibold uppercase tracking-wider text-[11px]">
            <Receipt className="w-3.5 h-3.5 text-emerald-400" />
            <span>Digital Fare Meter</span>
          </div>
          <div className="text-[11px] font-mono text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
            ₹{trip.tariffConfig.ratePerKm}/km
          </div>
        </div>

        {/* Large High-Contrast Digital Amount */}
        <div className="text-center py-3">
          <div className="inline-flex items-baseline justify-center space-x-1">
            <span className="text-3xl font-extrabold text-emerald-400 font-mono">₹</span>
            <span className="text-6xl sm:text-7xl font-black font-mono tracking-tighter text-white drop-shadow-[0_0_25px_rgba(16,185,129,0.3)]">
              {fareResult.totalFare}
            </span>
          </div>
          <p className="text-[11px] text-slate-400 uppercase tracking-widest mt-1">
            Base ₹{fareResult.baseFare} • Running Total
          </p>
        </div>

        {/* Live Metrics Grid (Distance, Duration, Waiting, Speed) */}
        <div className="grid grid-cols-4 gap-2 pt-3 border-t border-slate-800/80 text-center font-mono">
          <div className="bg-slate-950/80 p-2.5 rounded-xl border border-slate-800/60">
            <span className="text-[10px] text-slate-400 uppercase font-sans block">Distance</span>
            <p className="text-lg font-bold text-white mt-0.5">{distanceKm.toFixed(2)}</p>
            <span className="text-[9px] text-slate-400">KM</span>
          </div>

          <div className="bg-slate-950/80 p-2.5 rounded-xl border border-slate-800/60">
            <span className="text-[10px] text-slate-400 uppercase font-sans block">Duration</span>
            <p className="text-lg font-bold text-white mt-0.5">{formatTime(durationSeconds)}</p>
            <span className="text-[9px] text-slate-400">MIN</span>
          </div>

          <div className="bg-slate-950/80 p-2.5 rounded-xl border border-slate-800/60">
            <span className="text-[10px] text-slate-400 uppercase font-sans block">Waiting</span>
            <p className="text-lg font-bold text-amber-400 mt-0.5">{formatTime(waitingSeconds)}</p>
            <span className="text-[9px] text-slate-400">
              {trip.tariffConfig.waitingGraceMinutes}m grace
            </span>
          </div>

          <div className="bg-slate-950/80 p-2.5 rounded-xl border border-slate-800/60">
            <span className="text-[10px] text-slate-400 uppercase font-sans block">Speed</span>
            <p
              className={`text-lg font-bold mt-0.5 ${
                currentSpeedKmh > 80 ? 'text-rose-400 animate-pulse' : 'text-emerald-400'
              }`}
            >
              {currentSpeedKmh}
            </p>
            <span className="text-[9px] text-slate-400">KM/H</span>
          </div>
        </div>
      </div>

      {/* Itemized Fare Breakdown Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 space-y-2 text-xs">
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
          Fare Breakdown (Trip Tariff)
        </span>

        <div className="space-y-1.5 text-slate-300">
          <div className="flex justify-between">
            <span className="text-slate-400">Base Fare ({trip.tariffConfig.includedKm} km incl.)</span>
            <span className="font-mono font-bold text-white">₹{fareResult.baseFare}</span>
          </div>

          <div className="flex justify-between">
            <span className="text-slate-400">
              Distance Fare ({Math.max(0, distanceKm - trip.tariffConfig.includedKm).toFixed(1)} km extra)
            </span>
            <span className="font-mono font-bold text-white">₹{fareResult.distanceFare}</span>
          </div>

          <div className="flex justify-between">
            <span className="text-slate-400">Waiting Fare</span>
            <span className="font-mono font-bold text-white">₹{fareResult.waitingFare}</span>
          </div>

          {fareResult.driverBata > 0 && (
            <div className="flex justify-between">
              <span className="text-slate-400">Driver Bata</span>
              <span className="font-mono font-bold text-white">₹{fareResult.driverBata}</span>
            </div>
          )}

          {(fareResult.toll > 0 || fareResult.parking > 0) && (
            <div className="flex justify-between">
              <span className="text-slate-400">Tolls &amp; Parking</span>
              <span className="font-mono font-bold text-white">
                ₹{fareResult.toll + fareResult.parking}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Extra Charges (Toll & Parking Controls) */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 space-y-2 text-xs">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            Toll &amp; Parking Extras
          </span>
          <span className="font-mono font-bold text-emerald-400">
            +₹{extraTolls + extraParking}
          </span>
        </div>

        <div className="grid grid-cols-4 gap-2 pt-1">
          <button
            type="button"
            onClick={() => handleAddToll(50)}
            className="py-2 bg-slate-800 hover:bg-slate-700 text-sky-300 font-bold rounded-xl transition text-center"
          >
            +₹50 Toll
          </button>
          <button
            type="button"
            onClick={() => handleAddToll(100)}
            className="py-2 bg-slate-800 hover:bg-slate-700 text-sky-300 font-bold rounded-xl transition text-center"
          >
            +₹100 Toll
          </button>
          <button
            type="button"
            onClick={() => handleAddParking(50)}
            className="py-2 bg-slate-800 hover:bg-slate-700 text-teal-300 font-bold rounded-xl transition text-center"
          >
            +₹50 Park
          </button>
          <button
            type="button"
            onClick={() => setShowTollModal(true)}
            className="py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-xl transition text-center"
          >
            Custom
          </button>
        </div>
      </div>

      {/* Testing Simulation Bar (Available for browser testing) */}
      <div className="bg-slate-950 p-2.5 rounded-2xl border border-slate-800/80 flex items-center justify-between text-xs">
        <span className="text-[10px] text-slate-400 uppercase font-semibold">
          Simulation Controls:
        </span>
        <div className="flex space-x-1.5">
          <button
            type="button"
            onClick={handleSimulateMovement}
            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-sky-300 rounded-lg text-[10px] font-bold transition"
          >
            +1.2 km GPS
          </button>
          <button
            type="button"
            onClick={handleSimulateWaiting}
            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-amber-300 rounded-lg text-[10px] font-bold transition"
          >
            +1 min Wait
          </button>
        </div>
      </div>

      {/* Customer & Destination Info */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 space-y-2.5 text-xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <span className="font-bold text-white">{trip.customerName}</span>
            <span className="text-slate-400 font-mono text-[11px]">{trip.customerMobile}</span>
          </div>
          <a
            href={`tel:${trip.customerMobile.replace(/\s+/g, '')}`}
            className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
          >
            <Phone className="w-3.5 h-3.5" />
          </a>
        </div>

        <div className="flex items-start space-x-2 text-slate-300 pt-1 border-t border-slate-800/60">
          <MapPin className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
          <span className="truncate">{trip.dropAddress}</span>
        </div>
      </div>

      {/* END TRIP / COMPLETE FLOW */}
      <div className="pt-2">
        {!showEndConfirm ? (
          <button
            type="button"
            onClick={() => setShowEndConfirm(true)}
            className="w-full py-4 rounded-2xl bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white font-extrabold text-sm tracking-wider uppercase shadow-xl shadow-rose-600/25 active:scale-[0.98] transition flex items-center justify-center space-x-2"
          >
            <CheckCircle2 className="w-5 h-5" />
            <span>FINALIZE &amp; END TRIP</span>
          </button>
        ) : (
          <div className="bg-slate-900 border-2 border-rose-500/50 rounded-2xl p-4 space-y-3 animate-in fade-in zoom-in-95">
            <div className="flex items-center space-x-2 text-rose-400 font-bold text-xs">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>Confirm Trip Completion</span>
            </div>
            <p className="text-xs text-slate-300 leading-snug">
              Are you sure customer has reached destination? Final fare will be calculated at{' '}
              <span className="font-bold text-white">₹{fareResult.totalFare}</span>.
            </p>

            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowEndConfirm(false)}
                className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition"
              >
                Continue Trip
              </button>

              <button
                type="button"
                disabled={isFinishing}
                onClick={handleFinalizeTrip}
                className="py-2.5 px-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-extrabold shadow-md transition"
              >
                {isFinishing ? 'Finalizing...' : 'YES, COMPLETE'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* CUSTOM TOLL / PARKING MODAL */}
      {showTollModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-xs rounded-3xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-white text-sm">Add Custom Toll / Parking</h3>
              <button
                onClick={() => setShowTollModal(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <input
              type="number"
              min="0"
              autoFocus
              value={customTollInput}
              onChange={(e) => setCustomTollInput(e.target.value)}
              placeholder="Enter amount (₹)"
              className="w-full text-center text-xl font-mono font-bold py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-sky-500"
            />

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => {
                  const val = Number(customTollInput);
                  if (val > 0) handleAddToll(val);
                  setCustomTollInput('');
                  setShowTollModal(false);
                }}
                className="py-2 bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs rounded-xl transition"
              >
                Add as Toll
              </button>
              <button
                onClick={() => {
                  const val = Number(customTollInput);
                  if (val > 0) handleAddParking(val);
                  setCustomTollInput('');
                  setShowTollModal(false);
                }}
                className="py-2 bg-teal-600 hover:bg-teal-500 text-white font-bold text-xs rounded-xl transition"
              >
                Add as Parking
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SOS EMERGENCY MODAL */}
      {showSosModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-rose-600 rounded-3xl p-5 w-full max-w-xs space-y-4 shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2 text-rose-400">
                <LifeBuoy className="w-5 h-5" />
                <span className="font-bold text-sm text-white">Emergency Assistance</span>
              </div>
              <button
                onClick={() => setShowSosModal(false)}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              If you or your passenger are facing an immediate safety issue or road breakdown:
            </p>

            <div className="space-y-2">
              <a
                href="tel:112"
                className="w-full py-3 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-extrabold text-xs flex items-center justify-center space-x-2 transition shadow-lg"
              >
                <Phone className="w-4 h-4" />
                <span>Call Emergency Services (112)</span>
              </a>

              <a
                href="tel:+919876543210"
                className="w-full py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-sky-300 font-bold text-xs flex items-center justify-center space-x-2 transition border border-slate-700"
              >
                <Phone className="w-4 h-4" />
                <span>Call SBS Dispatch Control</span>
              </a>
            </div>

            <button
              onClick={() => setShowSosModal(false)}
              className="w-full py-2 text-slate-400 hover:text-slate-200 text-xs text-center"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
