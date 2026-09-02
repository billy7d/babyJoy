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
  submissionToken?: string;
  clipboardStatus?: "COPIED" | "FAILED";
  cartRequest: {
    code: string;
    itemLineCount: number;
    totalQuantity: number;
    subtotalVnd: number;
    promotionDiscountVnd?: number;
    finalTotalVnd?: number;
    createdAt: string;
    checkoutState?: string;
    reservationStartedAt?: string | null;
    reservationExpiresAt?: string | null;
    reservationDurationMinutes?: number | null;
  };
  share: {
    title: string;
    text: string;
    url: string;
    copyText: string;
    expiresAt: string;
    promotions?: Array<{
      promotionName: string;
      discountAmountVnd: number;
    }>;
    gifts?: Array<{
      productName: string;
      variantName: string;
      quantity: number;
      isPromotionGift: true;
    }>;
  };
  seller: SellerContact;
  serverNow?: string;
};

export type CartShareRequestItem = {
  variantId: string;
  quantity: number;
  displayedPrice?: number;
};

export type CartShareApiIssue = {
  code?: string;
  message?: string;
  items?: Array<{
    variantId: string;
    displayedPrice: number;
    currentPrice: number;
  }>;
  variantIds?: string[];
  subtotalVnd?: number;
  discountTotalVnd?: number;
  finalTotalVnd?: number;
  gifts?: Array<{
    productName?: string;
    variantName?: string;
    quantity: number;
  }>;
};

export type CartShareApiSuccess = Omit<
  PreparedCartShare,
  "fingerprint" | "submissionToken" | "clipboardStatus"
> & { success: true };

export type CartShareFetcher = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

export class CartShareApiError extends Error {
  constructor(
    readonly issue: CartShareApiIssue,
    readonly status: number,
    fallbackMessage: string,
  ) {
    super(issue.message || fallbackMessage);
    this.name = "CartShareApiError";
  }

  get code() {
    return this.issue.code;
  }
}

export function buildPreparedCartShare(
  fingerprint: string,
  submissionToken: string,
  response: CartShareApiSuccess,
): PreparedCartShare {
  return {
    fingerprint,
    submissionToken,
    cartRequest: response.cartRequest,
    share: response.share,
    seller: response.seller,
    serverNow: response.serverNow,
  };
}

export function cartShareErrorMessage(error: unknown, fallbackMessage: string) {
  if (!(error instanceof CartShareApiError)) {
    const message = error instanceof Error ? error.message.trim() : "";
    return message &&
      !/Failed to fetch|NetworkError|Load failed|AbortError/i.test(message) &&
      !/[A-Z][A-Z0-9_]{2,}/.test(message) &&
      !/SQL|sqlite|database/i.test(message)
      ? message
      : fallbackMessage;
  }
  const messages: Record<string, string> = {
    ORDER_CANCELLED: "Đơn hàng trước đã bị hủy. Vui lòng thử lại để tạo lượt chốt giỏ hàng mới.",
    ORDER_EXPIRED: "Đơn hàng đã hết thời gian giữ hàng. Vui lòng chốt lại giỏ hàng.",
    VARIANT_UNAVAILABLE: "Một số sản phẩm hiện không còn sẵn sàng.",
    INSUFFICIENT_STOCK: "Một số sản phẩm vừa hết hàng. Vui lòng kiểm tra lại giỏ hàng.",
    PRICE_CHANGED: "Giá của một số sản phẩm vừa thay đổi.",
    PROMOTION_CHANGED: "Khuyến mãi hoặc quà tặng vừa thay đổi. Vui lòng kiểm tra lại.",
    PROMOTION_USAGE_LIMIT: "Một chương trình khuyến mãi vừa hết lượt áp dụng. Vui lòng thử lại.",
    SELLER_NOT_CONFIGURED: "Người bán chưa được cấu hình.",
    CART_SHARE_NOT_CONFIGURED: "Chia sẻ giỏ hàng chưa được cấu hình.",
    FEATURE_DISABLED: "Tính năng chốt giỏ hàng hiện chưa được bật.",
  };
  if (error.code && messages[error.code]) return messages[error.code];
  const message = error.issue.message?.trim();
  if (message && !/[A-Z][A-Z0-9_]{2,}/.test(message) && !/SQL|sqlite|database/i.test(message))
    return message;
  return fallbackMessage;
}

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

export function isPreparedCartShareCurrent(
  prepared: PreparedCartShare,
  items: CartLine[],
) {
  return prepared.fingerprint === cartShareFingerprint(items);
}

export function runWithCurrentPreparedCartShare(
  prepared: PreparedCartShare,
  items: CartLine[],
  action: () => void,
  canSend: () => boolean = () => true,
) {
  if (!isPreparedCartShareCurrent(prepared, items) || !canSend()) return false;
  action();
  return true;
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
  if (typeof window === "undefined") return;
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

export function invalidateCartShareSubmission(
  fingerprint: string,
  expectedToken?: string,
) {
  if (typeof window === "undefined") return false;
  const raw = window.localStorage.getItem(cartShareSubmissionKey);
  if (!raw) return false;
  try {
    const value = JSON.parse(raw) as { fingerprint?: string; token?: string };
    if (
      value.fingerprint !== fingerprint ||
      !value.token ||
      (expectedToken !== undefined && value.token !== expectedToken)
    )
      return false;
    window.localStorage.removeItem(cartShareSubmissionKey);
    return true;
  } catch {
    window.localStorage.removeItem(cartShareSubmissionKey);
    return true;
  }
}

async function postCartShare<T extends CartShareApiSuccess>(
  path: string,
  body: {
    submissionToken: string;
    acceptCurrentPrices: boolean;
    items: CartShareRequestItem[];
  },
  fallbackMessage: string,
  fetcher?: CartShareFetcher,
) {
  const send = fetcher ?? ((input, init) => fetch(input, init));
  const response = await send(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    /* Giữ lỗi ở dạng có cấu trúc ngay cả khi server không trả JSON. */
  }
  const record = payload && typeof payload === "object"
    ? payload as Record<string, unknown>
    : null;
  if (!response.ok || record?.success !== true) {
    const issue = record?.error && typeof record.error === "object"
      ? record.error as CartShareApiIssue
      : {};
    throw new CartShareApiError(issue, response.status, fallbackMessage);
  }
  return record as T;
}

export function prepareCartShareRequest(input: {
  submissionToken: string;
  acceptCurrentPrices?: boolean;
  items: CartShareRequestItem[];
  fetcher?: CartShareFetcher;
}) {
  return postCartShare(
    "/api/cart/share/prepare",
    {
      submissionToken: input.submissionToken,
      acceptCurrentPrices: input.acceptCurrentPrices === true,
      items: input.items,
    },
    "Chưa thể chốt giỏ hàng. Vui lòng thử lại.",
    input.fetcher,
  );
}

export function activateCartShareRequest(input: {
  submissionToken: string;
  acceptCurrentPrices?: boolean;
  items: CartShareRequestItem[];
  fetcher?: CartShareFetcher;
}) {
  return postCartShare(
    "/api/cart/share/activate",
    {
      submissionToken: input.submissionToken,
      acceptCurrentPrices: input.acceptCurrentPrices === true,
      items: input.items,
    },
    "Chưa thể giữ hàng trước khi mở Messenger.",
    input.fetcher,
  );
}

export async function prepareCartShareWithRecovery(input: {
  fingerprint: string;
  items: CartShareRequestItem[];
  acceptCurrentPrices?: boolean;
  forceNew?: boolean;
  fetcher?: CartShareFetcher;
  onRecoveryStarted?: () => void;
}) {
  if (input.forceNew) clearPreparedCartShare();
  let submissionToken = getCartShareSubmissionToken(
    input.fingerprint,
    input.forceNew === true,
  );
  try {
    const response = await prepareCartShareRequest({ ...input, submissionToken });
    return { submissionToken, response, recovered: false as const };
  } catch (caught) {
    if (!(caught instanceof CartShareApiError) || caught.code !== "ORDER_CANCELLED")
      throw caught;

    clearPreparedCartShare();
    invalidateCartShareSubmission(input.fingerprint, submissionToken);
    input.onRecoveryStarted?.();
    submissionToken = getCartShareSubmissionToken(input.fingerprint, true);
    const response = await prepareCartShareRequest({ ...input, submissionToken });
    return { submissionToken, response, recovered: true as const };
  }
}

export async function activateCartShareWithRecovery(input: {
  fingerprint: string;
  submissionToken: string;
  items: CartShareRequestItem[];
  acceptCurrentPrices?: boolean;
  fetcher?: CartShareFetcher;
  onRecoveryStarted?: () => void;
  onRecoveredPrepare?: (
    response: CartShareApiSuccess,
    submissionToken: string,
  ) => void;
}) {
  try {
    const response = await activateCartShareRequest(input);
    return {
      submissionToken: input.submissionToken,
      response,
      recovered: false as const,
    };
  } catch (caught) {
    if (!(caught instanceof CartShareApiError) || caught.code !== "ORDER_CANCELLED")
      throw caught;

    clearPreparedCartShare();
    invalidateCartShareSubmission(input.fingerprint, input.submissionToken);
    input.onRecoveryStarted?.();
    const submissionToken = getCartShareSubmissionToken(input.fingerprint, true);
    const prepared = await prepareCartShareRequest({ ...input, submissionToken });
    input.onRecoveredPrepare?.(prepared, submissionToken);
    const response = await activateCartShareRequest({ ...input, submissionToken });
    return {
      submissionToken,
      response,
      preparedResponse: prepared,
      recovered: true as const,
    };
  }
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
