import React, { useState } from 'react';
import { CompletedTripData, DriverProfile } from '../types';
import { getStoredDriverProfile } from '../services/tripService';
import {
  CheckCircle2,
  Navigation,
  Clock,
  Timer,
  Share2,
  Copy,
  Check,
  ArrowRight,
  MessageCircle,
  Printer,
  QrCode,
  CreditCard,
  Car
} from 'lucide-react';

interface Props {
  summary: CompletedTripData;
  driver?: DriverProfile;
  onDone: () => void;
}

export const TripSummaryModal: React.FC<Props> = ({ summary, driver: passedDriver, onDone }) => {
  const driver = passedDriver || getStoredDriverProfile();
  const [copied, setCopied] = useState<boolean>(false);
  const [showUpiQr, setShowUpiQr] = useState<boolean>(false);
  const [upiVpa, setUpiVpa] = useState<string>('basheer222@okaxis');

  // Format standard text invoice with full itemized custom tariff breakdown
  const formatBillText = (): string => {
    return (
      `*SBS TRAVELS — TRIP INVOICE*\n` +
      `_Powered by Get Taxi Basheer_\n\n` +
      `*Trip No:* ${summary.tripNumber}\n` +
      `*Customer:* ${summary.customerName}\n` +
      `*Driver:* ${driver.name} (${driver.driverCode})\n` +
      `*Vehicle:* ${driver.vehicleNumber} ${driver.vehicleModel ? `(${driver.vehicleModel})` : ''}\n` +
      `*Pickup:* ${summary.pickupAddress}\n` +
      `*Drop:* ${summary.dropAddress}\n` +
      `--------------------------------\n` +
      `• *Total Distance:* ${summary.distanceKm.toFixed(2)} km\n` +
      `• *Trip Duration:* ${Math.ceil(summary.durationSeconds / 60)} mins\n` +
      `• *Waiting Time:* ${Math.floor(summary.waitingSeconds / 60)} mins\n` +
      `--------------------------------\n` +
      `• Base Fare: ₹${summary.baseFare}\n` +
      `• Distance Fare: ₹${summary.distanceFare}\n` +
      `• Waiting Charges: ₹${summary.waitingFare}\n` +
      (summary.driverBata > 0 ? `• Driver Bata: ₹${summary.driverBata}\n` : '') +
      (summary.toll > 0 ? `• Toll Charges: ₹${summary.toll}\n` : '') +
      (summary.parking > 0 ? `• Parking Charges: ₹${summary.parking}\n` : '') +
      (summary.interstateTax > 0 ? `• Interstate Tax: ₹${summary.interstateTax}\n` : '') +
      (summary.additionalCharges > 0 ? `• Extra Charges: ₹${summary.additionalCharges}\n` : '') +
      (summary.discount > 0 ? `• Discount: -₹${summary.discount}\n` : '') +
      `--------------------------------\n` +
      `*TOTAL FARE: ₹${summary.totalFare}*\n` +
      `--------------------------------\n` +
      `Thank you for traveling with SBS Travels!`
    );
  };

  const handleShareWhatsApp = () => {
    const rawNumber = (summary.customerMobile || '').replace(/\D/g, '');
    const cleanNumber = rawNumber.length === 10 ? `91${rawNumber}` : rawNumber;
    const text = encodeURIComponent(formatBillText());

    if (cleanNumber) {
      window.open(`https://wa.me/${cleanNumber}?text=${text}`, '_blank');
    } else {
      window.open(`https://wa.me/?text=${text}`, '_blank');
    }
  };

  const handleCopyReceipt = () => {
    navigator.clipboard.writeText(formatBillText());
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  // Generate standard NPCI UPI Payment URI
  const upiUri = `upi://pay?pa=${encodeURIComponent(upiVpa)}&pn=${encodeURIComponent('SBS Travels')}&am=${summary.totalFare}&cu=INR&tn=${encodeURIComponent(`Trip ${summary.tripNumber}`)}`;
  const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(upiUri)}`;

  const handlePrintReceipt = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 w-full max-w-sm rounded-3xl p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-200 max-h-[95vh] overflow-y-auto">
        {/* Header Icon */}
        <div className="text-center">
          <div className="w-14 h-14 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center mx-auto mb-2">
            <CheckCircle2 className="w-8 h-8" />
          </div>
          <span className="text-xs font-bold text-emerald-400 uppercase tracking-widest">
            Trip Completed
          </span>
          <h2 className="text-xl font-black text-white font-mono mt-0.5">
            {summary.tripNumber}
          </h2>
          <p className="text-xs text-slate-400">
            {summary.customerName}
          </p>
        </div>

        {/* Telemetry Summary Cards */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="bg-slate-950 border border-slate-800/80 rounded-xl p-2.5">
            <Navigation className="w-3.5 h-3.5 text-sky-400 mx-auto mb-1" />
            <span className="text-[10px] text-slate-400 uppercase block">Distance</span>
            <span className="text-sm font-bold font-mono text-white">
              {summary.distanceKm.toFixed(1)} km
            </span>
          </div>

          <div className="bg-slate-950 border border-slate-800/80 rounded-xl p-2.5">
            <Clock className="w-3.5 h-3.5 text-teal-400 mx-auto mb-1" />
            <span className="text-[10px] text-slate-400 uppercase block">Duration</span>
            <span className="text-sm font-bold font-mono text-white">
              {Math.ceil(summary.durationSeconds / 60)} min
            </span>
          </div>

          <div className="bg-slate-950 border border-slate-800/80 rounded-xl p-2.5">
            <Timer className="w-3.5 h-3.5 text-amber-400 mx-auto mb-1" />
            <span className="text-[10px] text-slate-400 uppercase block">Waiting</span>
            <span className="text-sm font-bold font-mono text-white">
              {Math.floor(summary.waitingSeconds / 60)} min
            </span>
          </div>
        </div>

        {/* Driver & Vehicle Receipt Info */}
        <div className="bg-slate-950 border border-slate-800/90 rounded-2xl p-3 flex items-center justify-between text-xs">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-sky-400">
              <Car className="w-4 h-4" />
            </div>
            <div>
              <p className="font-bold text-white leading-tight">{driver.vehicleNumber}</p>
              <p className="text-[11px] text-slate-400">{driver.name} ({driver.driverCode})</p>
            </div>
          </div>
          {driver.vehicleModel && (
            <span className="text-[10px] font-medium text-slate-300 bg-slate-900 px-2 py-1 rounded-lg border border-slate-800/80">
              {driver.vehicleModel}
            </span>
          )}
        </div>

        {/* Itemized Fare Breakdown */}
        <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 space-y-2 text-xs">
          <div className="flex items-center justify-between text-slate-400">
            <span>Base Fare</span>
            <span className="font-mono text-slate-200">₹{summary.baseFare}</span>
          </div>
          <div className="flex items-center justify-between text-slate-400">
            <span>Distance Charge</span>
            <span className="font-mono text-slate-200">₹{summary.distanceFare}</span>
          </div>
          <div className="flex items-center justify-between text-slate-400">
            <span>Waiting Charge</span>
            <span className="font-mono text-slate-200">₹{summary.waitingFare}</span>
          </div>
          {summary.driverBata > 0 && (
            <div className="flex items-center justify-between text-slate-400">
              <span>Driver Bata</span>
              <span className="font-mono text-slate-200">₹{summary.driverBata}</span>
            </div>
          )}
          {summary.toll > 0 && (
            <div className="flex items-center justify-between text-slate-400">
              <span>Toll Charges</span>
              <span className="font-mono text-slate-200">₹{summary.toll}</span>
            </div>
          )}
          {summary.parking > 0 && (
            <div className="flex items-center justify-between text-slate-400">
              <span>Parking Charges</span>
              <span className="font-mono text-slate-200">₹{summary.parking}</span>
            </div>
          )}
          {summary.interstateTax > 0 && (
            <div className="flex items-center justify-between text-slate-400">
              <span>Interstate Tax</span>
              <span className="font-mono text-slate-200">₹{summary.interstateTax}</span>
            </div>
          )}
          {summary.additionalCharges > 0 && (
            <div className="flex items-center justify-between text-slate-400">
              <span>Extra Charges</span>
              <span className="font-mono text-slate-200">₹{summary.additionalCharges}</span>
            </div>
          )}
          {summary.discount > 0 && (
            <div className="flex items-center justify-between text-emerald-400">
              <span>Discount</span>
              <span className="font-mono">-₹{summary.discount}</span>
            </div>
          )}

          <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-sm">
            <span className="font-bold text-white uppercase tracking-wider">TOTAL FARE</span>
            <span className="text-xl font-black font-mono text-emerald-400">
              ₹{summary.totalFare}
            </span>
          </div>
        </div>

        {/* UPI QR Payment Modal / Drawer */}
        {showUpiQr && (
          <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 text-center space-y-3 animate-in fade-in duration-150">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-300">Scan to Pay via UPI</span>
              <span className="text-xs font-mono font-bold text-emerald-400">₹{summary.totalFare}</span>
            </div>

            <div className="bg-white p-3 rounded-2xl inline-block shadow-inner">
              <img
                src={qrImageUrl}
                alt="UPI QR Code"
                className="w-44 h-44 mx-auto rounded-lg"
              />
            </div>

            <div className="space-y-1">
              <p className="text-[11px] text-slate-400">
                Supports GPay, PhonePe, Paytm, BHIM &amp; Banking Apps
              </p>
              <div className="flex items-center justify-center space-x-1.5 text-[10px] text-slate-500 font-mono">
                <span>VPA:</span>
                <input
                  type="text"
                  value={upiVpa}
                  onChange={(e) => setUpiVpa(e.target.value)}
                  className="bg-slate-900 border border-slate-800 rounded px-1.5 py-0.5 text-slate-300 text-center text-[10px] focus:outline-none focus:border-sky-500"
                />
              </div>
            </div>
          </div>
        )}

        {/* Share & Actions */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setShowUpiQr(!showUpiQr)}
            className={`py-2.5 px-3 rounded-xl font-bold text-xs flex items-center justify-center space-x-1.5 transition shadow ${
              showUpiQr
                ? 'bg-amber-500 text-slate-950 font-extrabold'
                : 'bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-500/20'
            }`}
          >
            <QrCode className="w-3.5 h-3.5" />
            <span>{showUpiQr ? 'Hide QR' : 'UPI Payment'}</span>
          </button>

          <button
            onClick={handleShareWhatsApp}
            className="py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center space-x-1.5 transition shadow-lg shadow-emerald-600/20"
          >
            <MessageCircle className="w-3.5 h-3.5" />
            <span>WhatsApp Bill</span>
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={handleCopyReceipt}
            className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold flex items-center justify-center space-x-1.5 transition border border-slate-700"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Copied Bill' : 'Copy Text Bill'}</span>
          </button>

          <button
            onClick={handlePrintReceipt}
            className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold flex items-center justify-center space-x-1.5 transition border border-slate-700"
          >
            <Printer className="w-3.5 h-3.5 text-sky-400" />
            <span>Print Invoice</span>
          </button>
        </div>

        {/* Clear & Return to Home */}
        <div className="pt-2">
          <button
            onClick={onDone}
            className="w-full py-3.5 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white font-extrabold text-sm tracking-wider uppercase shadow-xl shadow-sky-600/20 active:scale-[0.98] transition flex items-center justify-center space-x-2"
          >
            <span>CLOSE &amp; RETURN HOME</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
