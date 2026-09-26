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
  Car,
  User,
  Coins,
  Pause,
  Square,
  MoreVertical
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
  const [isSpeedBubbleMode, setIsSpeedBubbleMode] = useState<boolean>(false);
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

          // Update GPS signal status & speed from validated fix
          setGpsStatus(fix.signalState);
          setCurrentSpeedKmh(fix.speedKmh);

          // Over-speed caution alert (exceeding 80 km/h)
          const now = Date.now();
          if (fix.speedKmh > 80 && now - lastSpeedAlertRef.current > 10000) {
            soundEngine.playOverSpeedWarning();
            lastSpeedAlertRef.current = now;
          }

          // Movement vs Stationary handling for valid GPS fixes
          if (fix.isValid) {
            if (!fix.isStationary && fix.distanceDeltaKm > 0) {
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
            } else if (fix.isStationary || fix.isWaitingConfirmed) {
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

  // FLOATING METER OVERLAY WITH SPEED BUBBLE ONLY (NO FARE DETAILS)
  if (isSpeedBubbleMode) {
    return (
      <div className="fixed top-20 right-4 z-50 animate-in fade-in zoom-in-95">
        <div
          onClick={() => setIsSpeedBubbleMode(false)}
          className="bg-gradient-to-tr from-slate-950 via-slate-900 to-slate-950 border-2 border-emerald-400 rounded-full w-24 h-24 shadow-[0_0_30px_rgba(16,185,129,0.75)] flex flex-col items-center justify-center text-white cursor-pointer select-none active:scale-95 transition-all space-y-0.5 relative group"
          title="Click to expand full digital meter"
        >
          {/* Signal Indicator Dot */}
          <span
            className={`w-2.5 h-2.5 rounded-full absolute top-2 right-3 border border-slate-900 ${
              gpsStatus === 'GOOD' ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
            }`}
          />

          <div className="flex items-center space-x-1 text-emerald-400">
            <Gauge className="w-3.5 h-3.5 animate-pulse" />
            <span className="text-[8px] font-black uppercase tracking-wider">SPEED</span>
          </div>

          <span className="text-3xl font-black font-mono tracking-tight text-white leading-none my-0.5">
            {currentSpeedKmh}
          </span>

          <span className="text-[8px] font-black text-emerald-400 uppercase tracking-widest">
            KM/H
          </span>

          {/* Quick Helper Label */}
          <span className="absolute -bottom-6 text-[9px] font-extrabold text-slate-200 bg-slate-900/90 px-2.5 py-0.5 rounded-full border border-slate-700 whitespace-nowrap shadow-md">
            Tap to Expand Meter
          </span>
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

  // STANDARD HIGH-CONTRAST DIGITAL TAXI METER (Screenshot 2 Match)
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

      {/* Top Status & Battery Bar */}
      <div className="flex items-center justify-between text-xs px-1">
        <div className="flex items-center space-x-2">
          <span className="bg-emerald-950/80 border border-emerald-500/50 text-emerald-400 px-2.5 py-1 rounded-full text-[11px] font-bold flex items-center space-x-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>GPS {gpsStatus}</span>
          </span>
          <span className="text-slate-400 font-mono text-xs">🔋 92%</span>
        </div>

        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={() => setIsSpeedBubbleMode(true)}
            className="px-3 py-1.5 bg-emerald-950/90 hover:bg-emerald-900 border border-emerald-500/70 text-emerald-300 rounded-full text-xs font-bold flex items-center space-x-1.5 shadow-md transition active:scale-95"
            title="Floating Speed Bubble Overlay (Speed Only)"
          >
            <Gauge className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
            <span>Speed Bubble</span>
          </button>

          <button
            type="button"
            onClick={() => setShowSosModal(true)}
            className="px-3.5 py-1.5 bg-red-950/80 border border-red-500/70 text-white rounded-full text-xs font-bold flex items-center space-x-1.5 shadow-[0_0_12px_rgba(239,68,68,0.35)]"
          >
            <LifeBuoy className="w-3.5 h-3.5 text-red-400 animate-pulse" />
            <span>Dispatch</span>
          </button>
        </div>
      </div>

      {/* Passenger & Route Info Header Card */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-950 to-slate-900 border border-slate-800 rounded-3xl p-3.5 shadow-xl space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 px-3 py-0.5 rounded-full font-black text-[10px] tracking-wider uppercase">
            ON TRIP
          </span>
          <span className="text-slate-400 font-mono text-xs font-bold">
            TRIP #{trip.tripNumber || '4582'}
          </span>
        </div>

        <div className="grid grid-cols-12 gap-2 items-center text-xs">
          {/* Left: Customer Info */}
          <div className="col-span-5 space-y-1">
            <div className="flex items-center space-x-1.5">
              <User className="w-3.5 h-3.5 text-slate-400" />
              <div className="min-w-0">
                <span className="text-[9px] text-slate-400 uppercase block font-semibold">Customer</span>
                <span className="font-extrabold text-xs text-white truncate block">{trip.customerName || 'Arun Kumar'}</span>
              </div>
            </div>
            <div className="flex items-center space-x-1.5 pt-0.5">
              <div className="p-1 rounded-full bg-red-500/20 text-red-400">
                <Phone className="w-3 h-3" />
              </div>
              <span className="text-slate-300 font-mono text-[11px] font-bold">{trip.customerMobile || '+91 98765 43210'}</span>
              <a
                href={`tel:${(trip.customerMobile || '').replace(/\s+/g, '')}`}
                className="w-7 h-7 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex items-center justify-center hover:bg-emerald-500/30 transition shrink-0 ml-1"
                title="Call Passenger"
              >
                <Phone className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>

          {/* Middle: Pickup & Drop */}
          <div className="col-span-5 space-y-1.5 pl-1 border-l border-slate-800">
            <div className="flex items-start space-x-1.5 min-w-0">
              <MapPin className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <span className="text-[9px] text-slate-400 uppercase block font-semibold">Pickup</span>
                <span className="text-white font-bold text-xs truncate block">{trip.pickupAddress || 'Coimbatore Railway Station'}</span>
              </div>
            </div>
            <div className="flex items-start space-x-1.5 min-w-0">
              <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <span className="text-[9px] text-slate-400 uppercase block font-semibold">Drop</span>
                <span className="text-white font-bold text-xs truncate block">{trip.dropAddress || 'RS Puram'}</span>
              </div>
            </div>
          </div>

          {/* Right: Navigate Button */}
          <div className="col-span-2">
            <button
              type="button"
              onClick={handleNavigateDrop}
              className="w-full h-full py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-2xl flex flex-col items-center justify-center text-white transition shadow-md"
              title="Navigate with Google Maps"
            >
              <Navigation className="w-5 h-5 text-white" />
              <span className="text-[10px] font-extrabold mt-1">Navigate</span>
            </button>
          </div>
        </div>
      </div>

      {/* DIGITAL TAXI METER CONTAINER */}
      <div className="bg-gradient-to-b from-slate-900 via-slate-950 to-slate-900 border border-slate-800/90 rounded-3xl p-4 shadow-2xl space-y-3">
        {/* Meter Header Inside Box */}
        <div className="flex items-center justify-between text-xs pb-1 border-b border-slate-800/80">
          <div>
            <h2 className="text-sm font-extrabold tracking-wider leading-none">
              <span className="text-red-500">SBS</span> <span className="text-white">TRAVELS</span>
            </h2>
            <p className="text-[9px] text-slate-400 font-bold tracking-widest mt-0.5">
              POWERED BY <span className="text-red-500 font-black">GET TAXI</span> <span className="text-white font-black">{driver.name.split(' ')[0] || 'BASHEER'}</span>
            </p>
          </div>

          <div className="flex items-center space-x-2">
            <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 text-[10px] font-black uppercase flex items-center space-x-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
              <span>LIVE</span>
            </span>
            <span className="font-mono text-xs font-bold text-slate-300">
              {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        </div>

        {/* MAIN DIGITAL LED FARE DISPLAY */}
        <div className="bg-slate-950 border-2 border-slate-800 rounded-2xl p-4 flex items-center justify-between shadow-inner">
          <div>
            <span className="text-xs font-extrabold text-slate-400 tracking-wider uppercase block">FARE</span>
            <span className="text-5xl font-black text-white font-mono">₹</span>
          </div>
          <div className="text-right">
            <span className="text-5xl sm:text-6xl font-black font-mono tracking-tight text-white drop-shadow-[0_0_12px_rgba(255,255,255,0.25)]">
              {fareResult.totalFare.toFixed(2)}
            </span>
          </div>
        </div>

        {/* 3 Metrics Cards (Distance, Time, Speed) */}
        <div className="grid grid-cols-3 gap-2.5">
          <div className="bg-slate-950/80 p-3 rounded-2xl border border-slate-800 text-center space-y-1">
            <div className="flex items-center justify-center space-x-1 text-slate-400">
              <Navigation className="w-4 h-4 text-white" />
              <span className="text-[10px] uppercase font-extrabold">Distance</span>
            </div>
            <p className="text-base font-extrabold font-mono text-white">
              {distanceKm.toFixed(1)} <span className="text-xs text-slate-400 font-normal">km</span>
            </p>
          </div>

          <div className="bg-slate-950/80 p-3 rounded-2xl border border-slate-800 text-center space-y-1">
            <div className="flex items-center justify-center space-x-1 text-slate-400">
              <Clock className="w-4 h-4 text-white" />
              <span className="text-[10px] uppercase font-extrabold">Time</span>
            </div>
            <p className="text-base font-extrabold font-mono text-white">
              {formatTime(durationSeconds)}
            </p>
            <span className="text-[9px] text-slate-500 font-mono block">hh:mm:ss</span>
          </div>

          <div className="bg-slate-950/80 p-3 rounded-2xl border border-slate-800 text-center space-y-1">
            <div className="flex items-center justify-center space-x-1 text-slate-400">
              <Gauge className="w-4 h-4 text-white" />
              <span className="text-[10px] uppercase font-extrabold">Speed</span>
            </div>
            <p className="text-base font-extrabold font-mono text-white">
              {currentSpeedKmh} <span className="text-xs text-slate-400 font-normal">km/h</span>
            </p>
          </div>
        </div>

        {/* Trip Tariff Strip */}
        <div className="bg-slate-950/80 p-3 rounded-2xl border border-slate-800 flex items-center justify-between text-xs">
          <div className="flex items-center space-x-2">
            <Coins className="w-5 h-5 text-amber-400 shrink-0" />
            <div>
              <span className="font-extrabold text-white block">Trip Tariff</span>
              <span className="text-[10px] text-slate-400">Custom Rate (This Trip)</span>
            </div>
          </div>

          <div className="text-right text-[11px] font-mono text-slate-300">
            <div>Base Fare: <strong className="text-white">₹{trip.tariffConfig.baseFare || 50}</strong></div>
            <div>Per Km: <strong className="text-white">₹{trip.tariffConfig.ratePerKm || 15}</strong></div>
            <div>Per Min: <strong className="text-white">₹{trip.tariffConfig.waitingRatePerMinute || 2}</strong></div>
          </div>

          <button
            type="button"
            onClick={() => setShowTollModal(true)}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold border border-slate-700/60 transition"
          >
            View Details &gt;
          </button>
        </div>

        {/* Live Route Map Box */}
        <div className="relative h-28 rounded-2xl bg-slate-950 border border-slate-800 overflow-hidden flex items-center justify-center p-2">
          <div className="absolute inset-0 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:12px_12px] opacity-40" />
          <svg className="absolute inset-0 w-full h-full stroke-sky-400 fill-none" strokeWidth="3">
            <path d="M 30 70 Q 120 20 250 50 T 350 40" strokeDasharray="4 2" />
          </svg>
          <div className="absolute left-8 top-16 w-4 h-4 rounded-full bg-emerald-500 border-2 border-white flex items-center justify-center text-[8px] font-black text-white shadow-md">📍</div>
          <div className="absolute left-1/2 top-10 w-6 h-6 rounded-full bg-sky-500 border-2 border-white flex items-center justify-center text-white text-xs shadow-lg animate-pulse">▲</div>
          <div className="absolute right-8 top-10 w-4 h-4 rounded-full bg-red-500 border-2 border-white flex items-center justify-center text-[8px] font-black text-white shadow-md">📍</div>

          <span className="absolute left-3 bottom-2 text-[10px] text-slate-400 font-extrabold tracking-wider">Google</span>
          <button
            type="button"
            onClick={handleNavigateDrop}
            className="absolute right-3 top-2 p-1.5 rounded-lg bg-slate-900/90 border border-slate-700 text-slate-300 hover:text-white"
            title="Full Map View"
          >
            <MapPin className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 3 Bottom Circle Meter Action Controls */}
      <div className="grid grid-cols-3 gap-4 pt-2 items-center text-center">
        {/* Left: Pause / Waiting */}
        <div className="flex flex-col items-center space-y-1.5">
          <button
            type="button"
            onClick={handleSimulateWaiting}
            className="w-16 h-16 rounded-full bg-slate-800 border-2 border-slate-700 hover:bg-slate-700 text-white flex items-center justify-center shadow-lg active:scale-95 transition"
            title="Pause Meter / Add Waiting Time"
          >
            <Pause className="w-7 h-7 text-white fill-white" />
          </button>
          <span className="font-extrabold text-xs text-white uppercase block">PAUSE</span>
          <span className="text-[10px] text-slate-400 uppercase font-semibold block">WAITING</span>
        </div>

        {/* Center: END TRIP (Glowing Red) */}
        <div className="flex flex-col items-center space-y-1.5">
          <button
            type="button"
            onClick={() => setShowEndConfirm(true)}
            className="w-20 h-20 rounded-full bg-gradient-to-b from-red-500 to-rose-600 border-2 border-red-400/80 text-white flex items-center justify-center shadow-[0_0_30px_rgba(239,68,68,0.7)] hover:scale-105 active:scale-95 transition-all"
            title="End Ride and Finalize Bill"
          >
            <Square className="w-8 h-8 text-white fill-white" />
          </button>
          <span className="font-black text-sm text-white tracking-wider uppercase block">END TRIP</span>
          <span className="text-[10px] text-slate-400 uppercase font-semibold block">COMPLETE</span>
        </div>

        {/* Right: More / Options */}
        <div className="flex flex-col items-center space-y-1.5">
          <button
            type="button"
            onClick={() => setShowTollModal(true)}
            className="w-16 h-16 rounded-full bg-slate-800 border-2 border-slate-700 hover:bg-slate-700 text-white flex items-center justify-center shadow-lg active:scale-95 transition"
            title="Tolls, Parking & Custom Extras"
          >
            <MoreVertical className="w-7 h-7 text-white" />
          </button>
          <span className="font-extrabold text-xs text-white uppercase block">MORE</span>
          <span className="text-[10px] text-slate-400 uppercase font-semibold block">OPTIONS</span>
        </div>
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

      {/* END TRIP / COMPLETE TRIP CONFIRMATION MODAL */}
      {showEndConfirm && (
        <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-xs rounded-3xl p-5 shadow-2xl space-y-4 animate-in zoom-in-95">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2 text-rose-500">
                <Square className="w-5 h-5 fill-rose-500" />
                <h3 className="font-extrabold text-white text-sm">End Ride & Complete Trip?</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowEndConfirm(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="bg-slate-950 p-3 rounded-2xl border border-slate-800 text-center space-y-1">
              <span className="text-[10px] text-slate-400 font-extrabold uppercase block">Final Total Fare</span>
              <p className="text-3xl font-black font-mono text-emerald-400">₹{fareResult.totalFare.toFixed(2)}</p>
              <span className="text-[10px] text-slate-400">Dist: {distanceKm.toFixed(1)} km | Time: {formatTime(durationSeconds)}</span>
            </div>

            <p className="text-xs text-slate-300 text-center">
              Are you sure you want to stop the meter and generate the fare bill summary?
            </p>

            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                disabled={isFinishing}
                onClick={() => setShowEndConfirm(false)}
                className="py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-xl transition"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isFinishing}
                onClick={() => {
                  setShowEndConfirm(false);
                  handleFinalizeTrip();
                }}
                className="py-3 bg-gradient-to-r from-red-600 via-rose-600 to-red-600 hover:from-red-500 hover:to-rose-500 text-white font-extrabold text-xs rounded-xl transition shadow-lg shadow-red-600/30 active:scale-95 flex items-center justify-center space-x-1"
              >
                {isFinishing ? (
                  <span>Finishing...</span>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-white" />
                    <span>Complete Trip</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
