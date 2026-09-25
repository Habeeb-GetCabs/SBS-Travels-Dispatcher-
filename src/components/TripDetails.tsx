import React, { useState, useRef } from 'react';
import { Trip, DriverProfile, PassengerVerificationStatus } from '../types';
import {
  Phone,
  Navigation,
  Play,
  ShieldAlert,
  ShieldCheck,
  CheckCircle2,
  MapPin,
  ChevronRight,
  Check,
  KeyRound,
  Shield,
  AlertCircle
} from 'lucide-react';
import { markTripArrived, startTripWithPin, verifyPassengerOtp } from '../services/tripService';
import { soundEngine } from '../services/audioService';

interface Props {
  trip: Trip;
  driver: DriverProfile;
  onTripStarted: () => void;
  onCancelClaim?: () => void;
}

export const TripDetails: React.FC<Props> = ({ trip, driver, onTripStarted, onCancelClaim }) => {
  const [showPinModal, setShowPinModal] = useState<boolean>(false);
  const [pin, setPin] = useState<string>('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [isAuthorizingPin, setIsAuthorizingPin] = useState<boolean>(false);

  // Swipe to Arrived state
  const [swipeProgress, setSwipeProgress] = useState<number>(0);
  const [isSwiping, setIsSwiping] = useState<boolean>(false);
  const [isArriving, setIsArriving] = useState<boolean>(false);
  const [arrivedSuccess, setArrivedSuccess] = useState<boolean>(trip.status === 'ARRIVED');
  const sliderRef = useRef<HTMLDivElement>(null);

  // Passenger Verification OTP state (Credential 4)
  const [passengerOtpInput, setPassengerOtpInput] = useState<string>('');
  const [passengerOtpError, setPassengerOtpError] = useState<string | null>(null);
  const [isVerifyingPassenger, setIsVerifyingPassenger] = useState<boolean>(false);
  const [passengerStatus, setPassengerStatus] = useState<PassengerVerificationStatus>(
    trip.passengerVerificationStatus || (trip.passengerOtpRequired ? 'PENDING' : 'NOT_REQUIRED')
  );
  const [remainingAttempts, setRemainingAttempts] = useState<number>(
    5 - (trip.passengerVerificationAttempts || 0)
  );

  const isPassengerVerified = !trip.passengerOtpRequired || passengerStatus === 'VERIFIED';
  const isArrived = arrivedSuccess || trip.status === 'ARRIVED';

  const handleCallCustomer = () => {
    if (trip.customerMobile) {
      window.location.href = `tel:${trip.customerMobile.replace(/\s+/g, '')}`;
    }
  };

  const handleNavigatePickup = () => {
    let dest = trip.pickupAddress;
    if (trip.pickupLatitude && trip.pickupLongitude) {
      dest = `${trip.pickupLatitude},${trip.pickupLongitude}`;
    }
    const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`;
    window.open(mapsUrl, '_blank');
  };

  const handleTouchStart = () => {
    if (arrivedSuccess || isArriving) return;
    setIsSwiping(true);
  };

  const handleTouchMove = (e: React.TouchEvent | React.MouseEvent) => {
    if (!isSwiping || !sliderRef.current || arrivedSuccess) return;
    const rect = sliderRef.current.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const offset = Math.max(0, clientX - rect.left);
    const maxOffset = rect.width - 56;
    const progress = Math.min(1, Math.max(0, offset / maxOffset));
    setSwipeProgress(progress);

    if (progress >= 0.95) {
      triggerArrived();
    }
  };

  const handleTouchEnd = () => {
    if (swipeProgress < 0.95) {
      setSwipeProgress(0);
    }
    setIsSwiping(false);
  };

  const triggerArrived = async () => {
    setIsSwiping(false);
    setIsArriving(true);
    soundEngine.triggerHaptic([80, 40, 80]);

    const res = await markTripArrived(trip.id, driver);
    setIsArriving(false);

    if (res.success) {
      setArrivedSuccess(true);
      setSwipeProgress(1);
      soundEngine.playClaimSuccess();
    } else {
      setSwipeProgress(0);
      alert(res.error || 'Failed to mark arrived');
    }
  };

  const handleVerifyPassengerOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setPassengerOtpError(null);

    if (passengerOtpInput.trim().length !== 4) {
      setPassengerOtpError('Please enter a valid 4-digit code.');
      return;
    }

    setIsVerifyingPassenger(true);
    const res = await verifyPassengerOtp(trip.id, driver, passengerOtpInput);
    setIsVerifyingPassenger(false);

    if (res.success) {
      setPassengerStatus('VERIFIED');
      soundEngine.playClaimSuccess();
      soundEngine.triggerHaptic([50, 50, 100]);
    } else {
      if (res.remainingAttempts !== undefined) {
        setRemainingAttempts(res.remainingAttempts);
      }
      if (res.status === 'FAILED_BLOCKED') {
        setPassengerStatus('FAILED_BLOCKED');
      }
      setPassengerOtpError(res.error || 'Incorrect OTP code.');
      soundEngine.triggerHaptic([150, 80, 150]);
    }
  };

  const handleVerifyAndStartTrip = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinError(null);
    setIsAuthorizingPin(true);

    const res = await startTripWithPin(trip.id, driver, pin);
    setIsAuthorizingPin(false);

    if (res.success) {
      setShowPinModal(false);
      onTripStarted();
    } else {
      setPinError(res.error || 'Authorization failed. Please verify Start Meter PIN.');
    }
  };

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {/* Top Banner */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="bg-sky-50 text-sky-700 border border-sky-300 px-2.5 py-1 rounded-full text-xs font-mono font-black tracking-wider">
            {trip.tripNumber}
          </span>
          <span
            className={`text-xs font-extrabold px-2.5 py-1 rounded-full ${
              isArrived
                ? 'bg-purple-50 text-purple-700 border border-purple-300'
                : 'bg-emerald-50 text-emerald-700 border border-emerald-300'
            }`}
          >
            {isArrived ? 'DRIVER ARRIVED AT PICKUP' : 'TRIP CLAIMED'}
          </span>
        </div>

        <div className="mt-3">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
            Customer
          </span>
          <h2 className="text-xl font-black text-slate-900 tracking-tight flex items-center space-x-2">
            <span>{trip.customerName}</span>
          </h2>
          <p className="text-xs text-slate-600 mt-0.5 font-mono font-bold">
            {trip.customerMobile}
          </p>
        </div>
      </div>

      {/* Route Addresses */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3.5 shadow-sm">
        <div className="flex items-start space-x-3">
          <div className="w-6 h-6 rounded-full bg-sky-50 border border-sky-300 text-sky-600 flex items-center justify-center shrink-0 mt-0.5">
            <div className="w-2.5 h-2.5 rounded-full bg-sky-600" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              Pickup Point
            </span>
            <p className="text-xs font-bold text-slate-900 leading-relaxed mt-0.5">
              {trip.pickupAddress}
            </p>
          </div>
        </div>

        <div className="border-t border-slate-100 pt-3 flex items-start space-x-3">
          <div className="w-6 h-6 rounded-full bg-emerald-50 border border-emerald-300 text-emerald-600 flex items-center justify-center shrink-0 mt-0.5">
            <MapPin className="w-3.5 h-3.5 text-emerald-600" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              Drop Destination
            </span>
            <p className="text-xs font-bold text-slate-900 leading-relaxed mt-0.5">
              {trip.dropAddress}
            </p>
          </div>
        </div>
      </div>

      {/* Tariff & Estimate Card */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white border border-slate-200 rounded-2xl p-3 shadow-sm">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
            Rate / Pricing
          </span>
          <p className="text-sm font-black text-slate-900 mt-1">
            ₹{trip.tariffConfig.baseFare} Base
          </p>
          <span className="text-[10px] text-slate-500 font-medium">
            incl. {trip.tariffConfig.includedKm} km • ₹{trip.tariffConfig.ratePerKm}/km
          </span>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-3 shadow-sm">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
            Est. Total Fare
          </span>
          <p className="text-sm font-black text-emerald-700 font-mono mt-1">
            ₹{trip.estimatedFare}
          </p>
          <span className="text-[10px] text-slate-500 font-medium">
            {trip.estimatedDistanceKm ? `~${trip.estimatedDistanceKm} km` : 'Meter calculated'}
          </span>
        </div>
      </div>

      {/* Communication & Navigation Bar */}
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={handleCallCustomer}
          className="py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center space-x-2 border border-emerald-600 shadow-sm active:scale-95 transition"
        >
          <Phone className="w-4 h-4 text-white" />
          <span>CALL CUSTOMER</span>
        </button>

        <button
          onClick={handleNavigatePickup}
          className="py-3 px-4 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs flex items-center justify-center space-x-2 border border-sky-600 shadow-sm active:scale-95 transition"
        >
          <Navigation className="w-4 h-4 text-white" />
          <span>NAV TO PICKUP</span>
        </button>
      </div>

      {/* REQUIRED LIFECYCLE GATE: SWIPE TO ARRIVED */}
      {!isArrived ? (
        <div className="pt-2">
          <div
            ref={sliderRef}
            onMouseMove={handleTouchMove}
            onMouseUp={handleTouchEnd}
            onMouseLeave={handleTouchEnd}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            className="relative h-14 bg-slate-950 border border-purple-500/40 rounded-2xl p-1 select-none overflow-hidden flex items-center"
          >
            {/* Background shimmer text */}
            <div className="w-full text-center pointer-events-none">
              <span className="text-xs font-black tracking-widest text-purple-300 uppercase animate-pulse">
                {isArriving ? 'RECORDING ARRIVAL...' : 'SWIPE TO ARRIVED ❯❯❯'}
              </span>
            </div>

            {/* Slider Thumb Handle */}
            <div
              onMouseDown={handleTouchStart}
              onTouchStart={handleTouchStart}
              style={{
                transform: `translateX(${swipeProgress * (sliderRef.current ? sliderRef.current.clientWidth - 56 : 0)}px)`,
                transition: isSwiping ? 'none' : 'transform 0.25s ease-out',
              }}
              className="absolute left-1 top-1 bottom-1 w-12 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 flex items-center justify-center text-white shadow-lg cursor-grab active:cursor-grabbing active:scale-95"
            >
              <ChevronRight className="w-5 h-5 font-bold" />
            </div>
          </div>
          <p className="text-[10px] text-center text-slate-400 mt-1.5">
            Swipe when physically arrived at customer pickup point
          </p>
        </div>
      ) : (
        /* ARRIVED STATE: PASSENGER VERIFICATION OTP GATE & START TRIP */
        <div className="pt-2 space-y-3">
          <div className="p-3 bg-purple-500/10 border border-purple-500/30 rounded-2xl flex items-center justify-between text-xs">
            <div className="flex items-center space-x-2 text-purple-300 font-bold">
              <Check className="w-4 h-4 text-purple-400" />
              <span>Arrived at Pickup Location</span>
            </div>
            <span className="text-[10px] text-slate-400">At Pickup</span>
          </div>

          {/* GATE: Passenger Verification OTP (Credential 4) */}
          {trip.passengerOtpRequired && !isPassengerVerified && (
            <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-xs space-y-3">
              <div className="flex items-center space-x-2 text-amber-400 font-bold">
                <Shield className="w-4 h-4 shrink-0" />
                <span className="uppercase tracking-wider">Passenger Verification Required</span>
              </div>
              <p className="text-slate-300 text-[11px] leading-relaxed">
                Ask customer <strong>{trip.customerName}</strong> for the 4-digit verification code sent to them by dispatch.
              </p>

              <form onSubmit={handleVerifyPassengerOtp} className="space-y-2.5">
                <div className="flex space-x-2">
                  <input
                    type="number"
                    pattern="[0-9]*"
                    maxLength={4}
                    value={passengerOtpInput}
                    onChange={(e) => setPassengerOtpInput(e.target.value.slice(0, 4))}
                    placeholder="Enter 4-Digit Customer OTP"
                    disabled={passengerStatus === 'FAILED_BLOCKED' || isVerifyingPassenger}
                    className="flex-1 py-2.5 px-3 bg-slate-950 border border-amber-500/40 rounded-xl text-white font-mono text-center tracking-[0.3em] font-bold text-base focus:outline-none focus:border-amber-400"
                  />
                  <button
                    type="submit"
                    disabled={isVerifyingPassenger || passengerOtpInput.length !== 4 || passengerStatus === 'FAILED_BLOCKED'}
                    className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-xs tracking-wider uppercase disabled:opacity-50 transition active:scale-95 flex items-center space-x-1"
                  >
                    <span>{isVerifyingPassenger ? 'Verifying...' : 'Verify'}</span>
                  </button>
                </div>

                {passengerOtpError && (
                  <div className="flex items-center space-x-1.5 text-rose-400 text-[11px]">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>{passengerOtpError}</span>
                  </div>
                )}

                {passengerStatus === 'FAILED_BLOCKED' ? (
                  <p className="text-rose-400 font-bold text-[10px]">
                    Verification attempts exceeded. Trip is locked. Please contact dispatch.
                  </p>
                ) : (
                  <p className="text-[10px] text-slate-400">
                    Remaining attempts: <strong className="text-white">{remainingAttempts}</strong>
                  </p>
                )}
              </form>
            </div>
          )}

          {/* Passenger Verified Success Badge */}
          {trip.passengerOtpRequired && isPassengerVerified && (
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl flex items-center space-x-2 text-xs text-emerald-400 font-bold">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>Customer Verified with Passenger OTP ✓</span>
            </div>
          )}

          {/* START TRIP BUTTON: Only enabled if arrived and passenger verified */}
          <button
            onClick={() => {
              setPin('');
              setPinError(null);
              setShowPinModal(true);
            }}
            disabled={!isPassengerVerified}
            className="w-full py-4 px-6 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-extrabold text-base tracking-wide shadow-xl shadow-emerald-600/25 active:scale-[0.98] transition flex items-center justify-center space-x-2"
          >
            <Play className="w-5 h-5 fill-current" />
            <span>START TRIP (ENTER PIN)</span>
          </button>
        </div>
      )}

      {/* Start Meter PIN Verification Modal (Server-Authoritative Validation) */}
      {showPinModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-sm rounded-3xl p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-white">Enter Start Meter PIN</h3>
                <p className="text-xs text-slate-400">
                  Server-Authoritative Driver PIN
                </p>
              </div>
              <button
                onClick={() => setShowPinModal(false)}
                className="w-7 h-7 rounded-full bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center text-xs"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleVerifyAndStartTrip} className="space-y-4 pt-1">
              <div>
                <label className="text-xs font-bold text-slate-300 block mb-2">
                  4-Digit Authorization PIN
                </label>
                <input
                  type="password"
                  maxLength={4}
                  autoFocus
                  required
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  placeholder="••••"
                  className="w-full text-center text-2xl tracking-[0.5em] font-mono font-bold py-3 bg-slate-950 border border-slate-700 rounded-2xl text-white focus:outline-none focus:border-emerald-500 shadow-inner"
                />
              </div>

              {pinError && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs flex items-center space-x-2">
                  <ShieldAlert className="w-4 h-4 shrink-0" />
                  <span>{pinError}</span>
                </div>
              )}

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isAuthorizingPin || pin.length !== 4}
                  className="w-full py-3.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 disabled:opacity-50 text-white font-bold text-sm tracking-wider uppercase shadow-lg shadow-emerald-600/20 active:scale-[0.98] transition flex items-center justify-center space-x-2"
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span>{isAuthorizingPin ? 'Authorizing...' : 'Authorize & Start Meter'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
