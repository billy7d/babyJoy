export const CART_REQUEST_SCOPES = [
  "queue",
  "share",
  "messenger",
] as const;

export const CART_REQUEST_API_SCOPES = [
  ...CART_REQUEST_SCOPES,
  "all",
] as const;

export type CartRequestScope = (typeof CART_REQUEST_API_SCOPES)[number];

// Đây là các giá trị status đã tồn tại trong schema cart_requests.
export const CART_REQUEST_STATUSES = [
  "SUBMITTED",
  "CONTACTED",
  "CONFIRMED",
  "COMPLETED",
  "CANCELLED",
] as const;

export type CartRequestStatus = (typeof CART_REQUEST_STATUSES)[number];

// Đây là các giá trị checkout_state được migration inventory định nghĩa.
export const CART_CHECKOUT_STATES = [
  "LEGACY",
  "READY_TO_SEND",
  "WAITING_SELLER_CONFIRM",
  "CONFIRMED",
  "EXPIRED",
  "CANCELLED",
] as const;

export type CartCheckoutState = (typeof CART_CHECKOUT_STATES)[number];

export const CART_REQUEST_CHANNELS = ["LEGACY", "MESSENGER", "SHARE"] as const;
export type CartRequestChannel = (typeof CART_REQUEST_CHANNELS)[number];

export const MESSENGER_DELIVERY_STATUSES = [
  "NOT_APPLICABLE",
  "PENDING",
  "SENDING",
  "SENT",
  "FAILED",
] as const;

export type MessengerDeliveryStatus = (typeof MESSENGER_DELIVERY_STATUSES)[number];

export const MESSENGER_SESSION_STATUSES = [
  "CREATED",
  "IDENTIFIED",
  "CONFIRMED",
  "EXPIRED",
  "CANCELLED",
] as const;

export type MessengerSessionStatus = (typeof MESSENGER_SESSION_STATUSES)[number];

export const CART_REQUEST_SORT_KEYS = [
  "createdAt",
  "customerName",
  "publicCode",
  "subtotal",
  "itemCount",
  "reservationExpiry",
] as const;

export type CartRequestSort = (typeof CART_REQUEST_SORT_KEYS)[number];
export type CartRequestSortOrder = "asc" | "desc";
