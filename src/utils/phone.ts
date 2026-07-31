import { parsePhoneNumber, isValidPhoneNumber, type CountryCode } from "libphonenumber-js";

export function normalizePhone(value: string): string {
  const cleaned = value.replace(/[^\d+]/g, "");
  const hasPlus = cleaned.startsWith("+");
  const digits = cleaned.replace(/\+/g, "");
  return (hasPlus ? "+" : "") + digits.slice(0, 15);
}

export function digitsOnly(phone: string): string {
  return phone.replace(/\D/g, "");
}

export function isValidE164(phone: string): boolean {
  try {
    return isValidPhoneNumber(phone);
  } catch {
    return false;
  }
}

export function parseE164(phone: string): string | null {
  try {
    const parsed = parsePhoneNumber(phone);
    if (parsed && parsed.isPossible()) return parsed.number;
    return null;
  } catch {
    return null;
  }
}

export function formatInternational(phone: string): string {
  try {
    const parsed = parsePhoneNumber(phone);
    if (parsed) return parsed.formatInternational();
    return normalizePhone(phone);
  } catch {
    return normalizePhone(phone);
  }
}

export function getCountryCode(phone: string): string | null {
  try {
    const parsed = parsePhoneNumber(phone);
    if (parsed) return `+${parsed.countryCallingCode}`;
    return null;
  } catch {
    return null;
  }
}
