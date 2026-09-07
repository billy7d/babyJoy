export const DEFAULT_CHECKOUT_RESERVATION_MINUTES = 15;
export const MIN_CHECKOUT_RESERVATION_MINUTES = 3;
export const MAX_CHECKOUT_RESERVATION_MINUTES = 24 * 60;

// Giới hạn mặc định chống lạm dụng reservation được dùng chung bởi app và trigger D1.
export const DEFAULT_MAX_ACTIVE_RESERVATIONS_PER_SESSION = 2;
export const DEFAULT_MAX_TOTAL_RESERVED_UNITS_PER_SESSION = 100;
export const MAX_ACTIVE_RESERVATIONS_PER_SESSION = 10;
export const MAX_TOTAL_RESERVED_UNITS_PER_SESSION = 9999;
export const MAX_ACTIVE_RESERVATIONS_SETTING_KEY =
  "storefront_max_active_reservations_per_session";
export const MAX_TOTAL_RESERVED_UNITS_SETTING_KEY =
  "storefront_max_total_reserved_units_per_session";

export function formatReservationDuration(minutes: number) {
  if (!Number.isSafeInteger(minutes) || minutes < 1) return "0 phút";
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (!hours) return `${minutes} phút`;
  if (!remainingMinutes) return `${hours} giờ`;
  return `${hours} giờ ${remainingMinutes} phút`;
}

export function reservationDurationMs(minutes: number) {
  return minutes * 60 * 1000;
}
