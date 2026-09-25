// WhatsApp Communication Service for SBS Travels
// Generates normalized click-to-chat links using https://wa.me/<NUMBER>?text=<MESSAGE>
// Note: Opening WhatsApp is purely a communication action and NEVER alters trip status or bypasses security RPCs.

import { Trip, DriverProfile } from '../types';

/**
 * Normalizes phone numbers specifically for WhatsApp wa.me links.
 * Handles 10-digit Indian mobile numbers (+91 / 91) cleanly without duplicate country codes.
 */
export const normalizePhoneNumberForWhatsApp = (phone: string): string => {
  if (!phone) return '';
  // Remove all non-digit characters
  const digitsOnly = phone.replace(/\D/g, '');

  if (!digitsOnly) return '';

  // 10-digit Indian mobile number starting with 6, 7, 8, or 9
  if (digitsOnly.length === 10 && /^[6-9]/.test(digitsOnly)) {
    return `91${digitsOnly}`;
  }

  // 12-digit number starting with 91 followed by a 10-digit Indian mobile
  if (digitsOnly.length === 12 && digitsOnly.startsWith('91')) {
    return digitsOnly;
  }

  // 11-digit number starting with 0 (e.g., 09840122481)
  if (digitsOnly.length === 11 && digitsOnly.startsWith('0')) {
    return `91${digitsOnly.substring(1)}`;
  }

  // Fallback to raw digits for international or non-standard formats
  return digitsOnly;
};

/**
 * Generates structured driver dispatch message containing trip details and 6-digit access OTP.
 * Security rule: Excludes internal database UUIDs, auth_user_id, and private credentials.
 */
export const generateDriverDispatchMessage = (trip: Trip, driver?: DriverProfile): string => {
  const pickup = trip.pickupAddress || 'As specified';
  const drop = trip.dropAddress || 'As specified';
  const customer = trip.customerName || 'Passenger';
  const fare = trip.estimatedFare ? `₹${trip.estimatedFare}` : 'As per meter';
  const otp = trip.tripAccessOtp || 'N/A';

  let msg = `🚕 *NEW TRIP DISPATCH*\n\n`;
  msg += `*Trip #:* ${trip.tripNumber}\n`;
  msg += `*Pickup:* ${pickup}\n`;
  msg += `*Drop:* ${drop}\n`;
  msg += `*Passenger:* ${customer}\n`;
  if (trip.estimatedDistanceKm) {
    msg += `*Distance:* ~${trip.estimatedDistanceKm} km\n`;
  }
  msg += `*Est. Fare:* ${fare}\n`;
  msg += `*Trip Access OTP:* *${otp}*\n\n`;
  if (driver?.name) {
    msg += `Assigned Driver: ${driver.name}\n`;
  }
  msg += `Please open your Driver App, select *GET TRIP*, enter OTP *${otp}* to claim this trip.`;

  return msg;
};

/**
 * Generates structured customer booking confirmation message.
 * Keep brand-neutral unless specifically specified.
 */
export const generateCustomerBookingMessage = (trip: Trip, driver?: DriverProfile): string => {
  const pickup = trip.pickupAddress || 'As specified';
  const drop = trip.dropAddress || 'As specified';
  const fare = trip.estimatedFare ? `₹${trip.estimatedFare}` : 'As per meter';

  let msg = `✅ *TAXI BOOKING CONFIRMED*\n\n`;
  msg += `*Trip #:* ${trip.tripNumber}\n`;
  msg += `*Pickup Location:* ${pickup}\n`;
  msg += `*Drop Location:* ${drop}\n`;
  msg += `*Estimated Fare:* ${fare}\n\n`;

  if (driver?.name) {
    msg += `*Driver Name:* ${driver.name}\n`;
    msg += `*Vehicle:* ${driver.vehicleNumber} (${driver.vehicleModel || 'Taxi'})\n`;
    msg += `*Driver Contact:* ${driver.mobile}\n\n`;
  } else {
    msg += `Driver details will be shared shortly upon dispatch.\n\n`;
  }

  msg += `Please be ready at the pickup location. Thank you!`;

  return msg;
};

/**
 * Constructs valid wa.me URL and triggers click-to-chat.
 * Does NOT mutate database state or bypass backend verification.
 */
export const openWhatsApp = (
  phone: string,
  message: string
): { success: boolean; url?: string; error?: string } => {
  const normalizedPhone = normalizePhoneNumberForWhatsApp(phone);
  if (!normalizedPhone) {
    return {
      success: false,
      error: 'Invalid or missing phone number for WhatsApp sharing.',
    };
  }

  try {
    const encodedText = encodeURIComponent(message);
    const url = `https://wa.me/${normalizedPhone}?text=${encodedText}`;

    if (typeof window !== 'undefined') {
      window.open(url, '_blank');
    }

    return { success: true, url };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Failed to generate WhatsApp URL.',
    };
  }
};
