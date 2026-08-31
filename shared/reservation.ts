export const DEFAULT_CHECKOUT_RESERVATION_MINUTES = 15;
export const MIN_CHECKOUT_RESERVATION_MINUTES = 3;
export const MAX_CHECKOUT_RESERVATION_MINUTES = 24 * 60;

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
