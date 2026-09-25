// Custom Per-Trip Tariff Engine for SBS Travels (Powered by Get Taxi Basheer)
// Every trip has its own server-authoritative fare configuration.
// No trip may run on a free or default meter.

import { TariffConfig } from '../types';

export interface CustomFareCalculationInput {
  tariff: TariffConfig;
  distanceKm: number;
  durationSeconds: number;
  waitingSeconds: number;
  extraTolls?: number;
  extraParking?: number;
}

export interface CustomFareCalculationResult {
  baseFare: number;
  distanceFare: number;
  waitingFare: number;
  driverBata: number;
  toll: number;
  parking: number;
  interstateTax: number;
  additionalCharges: number;
  discount: number;
  subtotal: number;
  totalFare: number;
}

// Dispatcher convenience templates ONLY (Used to pre-fill dispatch inputs; NOT for meter defaults)
export const DISPATCH_TARIFF_PRESETS: Record<string, Partial<TariffConfig>> = {
  ONE_WAY: {
    pricingType: 'PER_KM',
    baseFare: 2080,
    includedKm: 130,
    minimumKm: 130,
    ratePerKm: 16,
    waitingRatePerMinute: 2,
    waitingGraceMinutes: 15,
    driverBata: 400,
    toll: 0,
    parking: 0,
    interstateTax: 0,
    additionalCharges: 0,
    discount: 0,
    roundingRule: 'ROUND_NEAREST',
    quotedAmount: 2480
  },
  LOCAL: {
    pricingType: 'PACKAGE',
    baseFare: 3000,
    includedKm: 100,
    minimumKm: 100,
    ratePerKm: 18,
    waitingRatePerMinute: 2.5,
    waitingGraceMinutes: 30,
    driverBata: 0,
    toll: 0,
    parking: 0,
    interstateTax: 0,
    additionalCharges: 0,
    discount: 0,
    roundingRule: 'ROUND_NEAREST',
    quotedAmount: 3000
  },
  HOURLY: {
    pricingType: 'PER_KM',
    baseFare: 350,
    includedKm: 10,
    minimumKm: 10,
    ratePerKm: 18,
    waitingRatePerMinute: 3,
    waitingGraceMinutes: 10,
    driverBata: 0,
    toll: 0,
    parking: 0,
    interstateTax: 0,
    additionalCharges: 0,
    discount: 0,
    roundingRule: 'ROUND_NEAREST',
    quotedAmount: 350
  },
  ROUND_TRIP: {
    pricingType: 'PER_KM',
    baseFare: 3500,
    includedKm: 250,
    minimumKm: 250,
    ratePerKm: 14,
    waitingRatePerMinute: 2,
    waitingGraceMinutes: 30,
    driverBata: 500,
    toll: 0,
    parking: 0,
    interstateTax: 0,
    additionalCharges: 0,
    discount: 0,
    roundingRule: 'ROUND_NEAREST',
    quotedAmount: 4000
  },
  AIRPORT: {
    pricingType: 'FLAT',
    baseFare: 650,
    includedKm: 25,
    minimumKm: 25,
    ratePerKm: 19,
    waitingRatePerMinute: 2,
    waitingGraceMinutes: 15,
    driverBata: 0,
    toll: 0,
    parking: 0,
    interstateTax: 0,
    additionalCharges: 0,
    discount: 0,
    roundingRule: 'ROUND_NEAREST',
    quotedAmount: 650
  }
};

// Create a blank or pre-filled TariffConfig for dispatch forms
export const createDefaultTariffConfig = (presetKey: string = 'ONE_WAY'): TariffConfig => {
  const preset = DISPATCH_TARIFF_PRESETS[presetKey] || DISPATCH_TARIFF_PRESETS.ONE_WAY;
  return {
    pricingType: preset.pricingType || 'PER_KM',
    baseFare: preset.baseFare ?? 500,
    includedKm: preset.includedKm ?? 25,
    minimumKm: preset.minimumKm ?? 25,
    ratePerKm: preset.ratePerKm ?? 16,
    waitingRatePerMinute: preset.waitingRatePerMinute ?? 2,
    waitingGraceMinutes: preset.waitingGraceMinutes ?? 15,
    driverBata: preset.driverBata ?? 0,
    toll: preset.toll ?? 0,
    parking: preset.parking ?? 0,
    interstateTax: preset.interstateTax ?? 0,
    additionalCharges: preset.additionalCharges ?? 0,
    commissionCharge: (preset as any).commissionCharge ?? 0,
    discount: preset.discount ?? 0,
    roundingRule: (preset.roundingRule as any) || 'ROUND_NEAREST',
    quotedAmount: preset.quotedAmount ?? preset.baseFare ?? 500,
  };
};

// Normalize raw object (e.g. from JSONB with snake_case) into TariffConfig
export const normalizeTariffConfig = (raw: any): TariffConfig => {
  if (!raw || typeof raw !== 'object') {
    return createDefaultTariffConfig();
  }
  return {
    pricingType: raw.pricingType || raw.pricing_type || 'PER_KM',
    baseFare: Number(raw.baseFare ?? raw.base_fare ?? 0),
    includedKm: Number(raw.includedKm ?? raw.included_km ?? raw.baseKm ?? 0),
    minimumKm: Number(raw.minimumKm ?? raw.minimum_km ?? 0),
    ratePerKm: Number(raw.ratePerKm ?? raw.rate_per_km ?? raw.perKmRate ?? 0),
    waitingRatePerMinute: Number(raw.waitingRatePerMinute ?? raw.waiting_rate_per_minute ?? 0),
    waitingGraceMinutes: Number(raw.waitingGraceMinutes ?? raw.waiting_grace_minutes ?? raw.waitingGracePeriodMinutes ?? 0),
    driverBata: Number(raw.driverBata ?? raw.driver_bata ?? 0),
    toll: Number(raw.toll ?? raw.extraTolls ?? 0),
    parking: Number(raw.parking ?? raw.extraParking ?? 0),
    interstateTax: Number(raw.interstateTax ?? raw.interstate_tax ?? 0),
    additionalCharges: Number(raw.additionalCharges ?? raw.additional_charges ?? 0),
    commissionCharge: Number(raw.commissionCharge ?? raw.commission_charge ?? 0),
    discount: Number(raw.discount ?? 0),
    roundingRule: raw.roundingRule || raw.rounding_rule || 'ROUND_NEAREST',
    quotedAmount: Number(raw.quotedAmount ?? raw.quoted_amount ?? 0),
  };
};

// Strict Validator for Trip Tariff Configuration
export const validateTariffConfig = (config: any): { valid: boolean; error?: string } => {
  if (!config || typeof config !== 'object') {
    return { valid: false, error: 'Tariff configuration is missing from trip record.' };
  }
  const norm = normalizeTariffConfig(config);
  if (isNaN(norm.baseFare) || norm.baseFare < 0) {
    return { valid: false, error: 'Invalid Base Fare in trip tariff configuration.' };
  }
  if (isNaN(norm.ratePerKm) || norm.ratePerKm < 0) {
    return { valid: false, error: 'Invalid Rate per KM in trip tariff configuration.' };
  }
  return { valid: true };
};

// Authoritative Custom Trip Fare Calculation
export const calculateCustomTripFare = (input: CustomFareCalculationInput): CustomFareCalculationResult => {
  const { tariff, distanceKm, waitingSeconds, extraTolls = 0, extraParking = 0 } = input;

  const baseFare = Number(tariff.baseFare) || 0;
  const ratePerKm = Number(tariff.ratePerKm) || 0;
  const includedKm = Number(tariff.includedKm) || 0;
  const minimumKm = Number(tariff.minimumKm) || 0;

  // 1. Distance Calculation (Applies Minimum KM rule and Included KM)
  const effectiveDistance = Math.max(distanceKm, minimumKm);
  const extraKm = Math.max(0, effectiveDistance - includedKm);
  const distanceFare = Math.round(extraKm * ratePerKm);

  // 2. Waiting Calculation (Beyond grace period)
  const totalWaitingMinutes = Math.floor(waitingSeconds / 60);
  const graceMinutes = Number(tariff.waitingGraceMinutes) || 0;
  const chargeableWaitingMinutes = Math.max(0, totalWaitingMinutes - graceMinutes);
  const waitingRate = Number(tariff.waitingRatePerMinute) || 0;
  const waitingFare = Math.round(chargeableWaitingMinutes * waitingRate);

  // 3. Allowances & Surcharges
  const driverBata = Number(tariff.driverBata) || 0;
  const toll = (Number(tariff.toll) || 0) + extraTolls;
  const parking = (Number(tariff.parking) || 0) + extraParking;
  const interstateTax = Number(tariff.interstateTax) || 0;
  const additionalCharges = Number(tariff.additionalCharges) || 0;
  const discount = Number(tariff.discount) || 0;

  // 4. Subtotal & Rounding
  const subtotal = baseFare + distanceFare + waitingFare + driverBata + toll + parking + interstateTax + additionalCharges - discount;

  let totalFare = subtotal;
  if (tariff.roundingRule === 'CEIL') {
    totalFare = Math.ceil(subtotal);
  } else if (tariff.roundingRule === 'FLOOR') {
    totalFare = Math.floor(subtotal);
  } else if (tariff.roundingRule === 'NONE') {
    totalFare = Number(subtotal.toFixed(2));
  } else {
    // Default ROUND_NEAREST
    totalFare = Math.round(subtotal);
  }

  return {
    baseFare,
    distanceFare,
    waitingFare,
    driverBata,
    toll,
    parking,
    interstateTax,
    additionalCharges,
    discount,
    subtotal,
    totalFare: Math.max(0, totalFare),
  };
};
