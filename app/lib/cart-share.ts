import type { CartLine } from "./cart";

export const preparedCartShareKey = "babyjoy.preparedCartShare.v1";
export const cartShareSubmissionKey = "babyjoy.cartShareSubmission.v1";
export const cartShareAttemptKey = "babyjoy.cartShareAttempt.v1";

export type SellerContact = {
  displayName: string;
  label: string;
  messengerUrl: string;
  avatarKey: string | null;
  avatarUrl: string | null;
};

export type PreparedCartShare = {
  fingerprint: string;
  clipboardStatus?: "COPIED" | "FAILED";
  cartRequest: {
    code: string;
    itemLineCount: number;
    totalQuantity: number;
    subtotalVnd: number;
    createdAt: string;
  };
  share: {
    title: string;
    text: string;
    url: string;
    copyText: string;
    expiresAt: string;
  };
  seller: SellerContact;
};

export async function copyCartText(
  text: string,
  options: {
    clipboard?: Pick<Clipboard, "writeText"> | null;
    fallback?: (() => boolean) | null;
  } = {},
) {
  const clipboard =
    options.clipboard === undefined
      ? typeof navigator === "undefined"
        ? null
        : navigator.clipboard
      : options.clipboard;
  try {
    if (!clipboard?.writeText) throw new Error("CLIPBOARD_UNAVAILABLE");
    await clipboard.writeText(text);
    return true;
  } catch {
    if (options.fallback) {
      try {
        return options.fallback();
      } catch {
        return false;
      }
    }
    if (typeof document === "undefined") return false;
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.readOnly = true;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    } finally {
      textarea.remove();
    }
    return copied;
  }
}

export function cartShareFingerprint(items: CartLine[]) {
  return items
    .map((item) => ({ variantId: item.variantId, quantity: item.quantity }))
    .sort((left, right) => left.variantId.localeCompare(right.variantId))
    .map((item) => `${item.variantId}:${item.quantity}`)
    .join("|");
}

export function readPreparedCartShare(): PreparedCartShare | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(preparedCartShareKey);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as PreparedCartShare;
    return value.fingerprint && value.share?.copyText && value.seller?.messengerUrl
      ? value
      : null;
  } catch {
    return null;
  }
}

export function writePreparedCartShare(value: PreparedCartShare) {
  window.sessionStorage.setItem(preparedCartShareKey, JSON.stringify(value));
}

export function clearPreparedCartShare() {
  window.sessionStorage.removeItem(preparedCartShareKey);
}

export function getCartShareSubmissionToken(
  fingerprint: string,
  forceNew = false,
) {
  if (!forceNew) {
    const raw = window.localStorage.getItem(cartShareSubmissionKey);
    if (raw) {
      try {
        const value = JSON.parse(raw) as { fingerprint?: string; token?: string };
        if (value.fingerprint === fingerprint && value.token) return value.token;
      } catch {
        /* Tạo association mới nếu localStorage bị hỏng. */
      }
    }
  }
  const token = crypto.randomUUID();
  window.localStorage.setItem(
    cartShareSubmissionKey,
    JSON.stringify({ fingerprint, token }),
  );
  return token;
}

export function recordSellerMessengerOpened(code: string) {
  window.localStorage.setItem(
    cartShareAttemptKey,
    JSON.stringify({ code, action: "seller_messenger_opened", at: new Date().toISOString() }),
  );
  console.info(JSON.stringify({ event: "seller_messenger_opened", publicCode: code }));
}

export async function copyAndOpenSeller(input: {
  copyText: string;
  messengerUrl: string;
  code: string;
  clipboard?: Pick<Clipboard, "writeText">;
  navigate?: (url: string) => void;
  record?: (code: string) => void;
  onCopied?: () => void;
}) {
  const clipboard = input.clipboard ?? navigator.clipboard;
  if (!clipboard?.writeText) throw new DOMException("Clipboard unavailable", "NotAllowedError");
  await clipboard.writeText(input.copyText);
  input.onCopied?.();
  (input.record ?? recordSellerMessengerOpened)(input.code);
  (input.navigate ?? ((url) => window.location.assign(url)))(input.messengerUrl);
}

export async function runNativeCartShare(input: {
  title: string;
  text: string;
  url: string;
  share?: Navigator["share"];
}) {
  const share = input.share ?? navigator.share?.bind(navigator);
  if (!share) return "UNAVAILABLE" as const;
  try {
    await share({ title: input.title, text: input.text, url: input.url });
    return "SHARED" as const;
  } catch (caught) {
    if (caught instanceof DOMException && caught.name === "AbortError")
      return "CANCELLED" as const;
    return "FAILED" as const;
  }
}
