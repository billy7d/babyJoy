import type { CartLine } from "./cart";

export const pendingMessengerCartKey = "babyjoy.pendingMessengerCart.v1";
export const messengerSubmissionKey = "babyjoy.messengerSubmission.v1";

export type PendingMessengerCart = {
  code: string;
  messengerUrl: string;
  statusToken: string;
  expiresAt: string;
  fingerprint: string;
  cartRequest: {
    code: string;
    itemLineCount: number;
    totalQuantity: number;
    subtotalVnd: number;
    createdAt: string;
  };
};

export function cartFingerprint(items: CartLine[]) {
  return items
    .map((item) => ({ variantId: item.variantId, quantity: item.quantity }))
    .sort((left, right) => left.variantId.localeCompare(right.variantId))
    .map((item) => `${item.variantId}:${item.quantity}`)
    .join("|");
}

export function readPendingMessengerCart(): PendingMessengerCart | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(pendingMessengerCartKey);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as PendingMessengerCart;
    return value.code && value.statusToken && value.fingerprint ? value : null;
  } catch {
    return null;
  }
}

export function writePendingMessengerCart(value: PendingMessengerCart) {
  window.localStorage.setItem(pendingMessengerCartKey, JSON.stringify(value));
}

export function clearPendingMessengerCart() {
  window.localStorage.removeItem(pendingMessengerCartKey);
  window.sessionStorage.removeItem(messengerSubmissionKey);
}

export function getMessengerSubmissionToken(fingerprint: string, forceNew = false) {
  if (!forceNew) {
    const raw = window.sessionStorage.getItem(messengerSubmissionKey);
    if (raw) {
      try {
        const value = JSON.parse(raw) as { fingerprint?: string; token?: string };
        if (value.fingerprint === fingerprint && value.token) return value.token;
      } catch {
        /* Tạo token mới nếu dữ liệu session bị hỏng. */
      }
    }
  }
  const token = crypto.randomUUID();
  window.sessionStorage.setItem(
    messengerSubmissionKey,
    JSON.stringify({ fingerprint, token }),
  );
  return token;
}
