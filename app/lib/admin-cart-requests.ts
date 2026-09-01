import {
  ADMIN_DEFAULT_PAGE_SIZE,
  ADMIN_PAGE_SIZE_OPTIONS,
  normalizeLimit,
  normalizePage,
} from "../../shared/pagination";
import {
  CART_CHECKOUT_STATES,
  CART_REQUEST_CHANNELS,
  CART_REQUEST_SCOPES,
  CART_REQUEST_SORT_KEYS,
  CART_REQUEST_STATUSES,
  MESSENGER_DELIVERY_STATUSES,
  type CartCheckoutState,
  type CartRequestChannel,
  type CartRequestSort,
  type CartRequestStatus,
  type MessengerDeliveryStatus,
} from "../../shared/cart-requests";

export type AdminCartRequestScope = (typeof CART_REQUEST_SCOPES)[number];
export type AdminCartRequestDatePreset =
  | "today"
  | "yesterday"
  | "sevenDays"
  | "thirtyDays"
  | "thisMonth"
  | "lastMonth"
  | "custom";

export type AdminCartRequestRow = {
  id: string;
  publicCode: string;
  customerName: string | null;
  customerPhone: string | null;
  itemLineCount: number;
  totalQuantity: number;
  subtotalVnd: number;
  status: string;
  contactChannel: CartRequestChannel;
  messengerDeliveryStatus: MessengerDeliveryStatus;
  messengerSessionStatus: string | null;
  createdAt: string;
  checkoutState?: CartCheckoutState;
  reservationStartedAt?: string | null;
  reservationExpiresAt?: string | null;
  reservationDurationMinutes?: number | null;
};

export type AdminCartRequestAdvancedFilters = {
  datePreset: AdminCartRequestDatePreset | null;
  dateFrom: string | null;
  dateTo: string | null;
  statuses: CartRequestStatus[];
  checkoutStates: CartCheckoutState[];
  channels: CartRequestChannel[];
  messengerDeliveryStatuses: MessengerDeliveryStatus[];
  subtotalMin: number | null;
  subtotalMax: number | null;
  itemCountMin: number | null;
  itemCountMax: number | null;
};

export type AdminCartRequestUrlState = AdminCartRequestAdvancedFilters & {
  scope: AdminCartRequestScope;
  page: number;
  limit: number;
  q: string;
  sort: CartRequestSort | null;
  order: "asc" | "desc";
};

export type AdminCartRequestFilterChip = {
  key: string;
  label: string;
};

export const CART_REQUEST_SORT_OPTIONS: Array<{
  value: string;
  label: string;
}> = [
  { value: "", label: "Ưu tiên xử lý" },
  { value: "createdAt:desc", label: "Mới nhất" },
  { value: "createdAt:asc", label: "Cũ nhất" },
  { value: "customerName:asc", label: "Tên khách A → Z" },
  { value: "customerName:desc", label: "Tên khách Z → A" },
  { value: "publicCode:asc", label: "Mã giỏ A → Z" },
  { value: "publicCode:desc", label: "Mã giỏ Z → A" },
  { value: "subtotal:desc", label: "Giá trị cao → thấp" },
  { value: "subtotal:asc", label: "Giá trị thấp → cao" },
  { value: "itemCount:desc", label: "Nhiều mặt hàng → ít" },
  { value: "itemCount:asc", label: "Ít mặt hàng → nhiều" },
  { value: "reservationExpiry:asc", label: "Sắp hết thời gian giữ" },
];

export const CART_REQUEST_STATUS_LABELS: Record<CartRequestStatus, string> = {
  SUBMITTED: "Mới gửi",
  CONTACTED: "Đã liên hệ",
  CONFIRMED: "Đã xác nhận",
  COMPLETED: "Hoàn tất",
  CANCELLED: "Đã hủy",
};

export const CART_CHECKOUT_STATE_LABELS: Record<CartCheckoutState, string> = {
  LEGACY: "Legacy",
  READY_TO_SEND: "Sẵn sàng gửi",
  WAITING_SELLER_CONFIRM: "Chờ seller xác nhận",
  CONFIRMED: "Đã xác nhận",
  EXPIRED: "Hết hạn",
  CANCELLED: "Đã hủy",
};

export const CART_REQUEST_CHANNEL_LABELS: Record<CartRequestChannel, string> = {
  LEGACY: "Legacy",
  MESSENGER: "Messenger",
  SHARE: "Chia sẻ thủ công",
};

export const MESSENGER_DELIVERY_STATUS_LABELS: Record<MessengerDeliveryStatus, string> = {
  NOT_APPLICABLE: "Không áp dụng",
  PENDING: "Đang chờ gửi",
  SENDING: "Đang gửi",
  SENT: "Đã gửi",
  FAILED: "Gửi lỗi",
};

const DATE_PRESET_LABELS: Record<AdminCartRequestDatePreset, string> = {
  today: "Hôm nay",
  yesterday: "Hôm qua",
  sevenDays: "7 ngày gần nhất",
  thirtyDays: "30 ngày gần nhất",
  thisMonth: "Tháng này",
  lastMonth: "Tháng trước",
  custom: "Khoảng ngày tùy chỉnh",
};

const DATE_PRESETS = new Set<string>(Object.keys(DATE_PRESET_LABELS));
const SCOPE_SET = new Set<string>(CART_REQUEST_SCOPES);
const SORT_SET = new Set<string>(CART_REQUEST_SORT_KEYS);
const STATUS_SET = new Set<string>(CART_REQUEST_STATUSES);
const CHECKOUT_STATE_SET = new Set<string>(CART_CHECKOUT_STATES);
const CHANNEL_SET = new Set<string>(CART_REQUEST_CHANNELS);
const DELIVERY_STATUS_SET = new Set<string>(MESSENGER_DELIVERY_STATUSES);

function getCsvValues(params: URLSearchParams, key: string) {
  return [
    ...new Set(
      params
        .getAll(key)
        .flatMap((value) => value.split(","))
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
}

function parseValidValues<T extends string>(
  values: string[],
  allowed: Set<string>,
) {
  return values.filter((value): value is T => allowed.has(value));
}

function parseOptionalInteger(params: URLSearchParams, key: string) {
  const raw = params.get(key)?.trim() ?? "";
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parseDatePreset(value: string | null) {
  return value && DATE_PRESETS.has(value)
    ? (value as AdminCartRequestDatePreset)
    : null;
}

export function emptyAdminCartRequestAdvancedFilters(): AdminCartRequestAdvancedFilters {
  return {
    datePreset: null,
    dateFrom: null,
    dateTo: null,
    statuses: [],
    checkoutStates: [],
    channels: [],
    messengerDeliveryStatuses: [],
    subtotalMin: null,
    subtotalMax: null,
    itemCountMin: null,
    itemCountMax: null,
  };
}

export function parseAdminCartRequestUrl(search: string): AdminCartRequestUrlState {
  const params = new URLSearchParams(search);
  const rawSort = params.get("sort")?.trim() ?? "";
  const sort = SORT_SET.has(rawSort) ? (rawSort as CartRequestSort) : null;
  const dateFrom = params.get("dateFrom")?.trim() || null;
  const dateTo = params.get("dateTo")?.trim() || null;
  const datePreset = parseDatePreset(params.get("datePreset"));
  return {
    scope: SCOPE_SET.has(params.get("scope") ?? "")
      ? (params.get("scope") as AdminCartRequestScope)
      : "queue",
    page: normalizePage(params.get("page")),
    limit: normalizeLimit(params.get("limit"), {
      defaultLimit: ADMIN_DEFAULT_PAGE_SIZE,
      allowedLimits: ADMIN_PAGE_SIZE_OPTIONS,
    }),
    q: (params.get("q") ?? "").trim(),
    sort,
    order: params.get("order") === "asc" ? "asc" : "desc",
    datePreset: dateFrom || dateTo ? datePreset ?? "custom" : null,
    dateFrom,
    dateTo,
    statuses: parseValidValues<CartRequestStatus>(
      getCsvValues(params, "status"),
      STATUS_SET,
    ),
    checkoutStates: parseValidValues<CartCheckoutState>(
      getCsvValues(params, "checkoutState"),
      CHECKOUT_STATE_SET,
    ),
    channels: parseValidValues<CartRequestChannel>(
      getCsvValues(params, "channel"),
      CHANNEL_SET,
    ),
    messengerDeliveryStatuses: parseValidValues<MessengerDeliveryStatus>(
      getCsvValues(params, "messengerDeliveryStatus"),
      DELIVERY_STATUS_SET,
    ),
    subtotalMin: parseOptionalInteger(params, "subtotalMin"),
    subtotalMax: parseOptionalInteger(params, "subtotalMax"),
    itemCountMin: parseOptionalInteger(params, "itemCountMin"),
    itemCountMax: parseOptionalInteger(params, "itemCountMax"),
  };
}

function setCsvParam(
  params: URLSearchParams,
  key: string,
  values: readonly string[],
) {
  if (values.length) params.set(key, values.join(","));
}

function setOptionalParam(
  params: URLSearchParams,
  key: string,
  value: number | string | null,
) {
  if (value !== null && value !== "") params.set(key, String(value));
}

function appendAdminCartRequestParams(
  params: URLSearchParams,
  state: AdminCartRequestUrlState,
  includePagination: boolean,
) {
  if (state.scope !== "queue") params.set("scope", state.scope);
  if (includePagination) {
    if (state.page > 1) params.set("page", String(state.page));
    if (state.limit !== ADMIN_DEFAULT_PAGE_SIZE)
      params.set("limit", String(state.limit));
  }
  if (state.q) params.set("q", state.q);
  if (state.sort) {
    params.set("sort", state.sort);
    params.set("order", state.order);
  }
  if (state.dateFrom || state.dateTo) {
    // datePreset chỉ là state hiển thị của trang, không cần gửi vào API.
    if (includePagination && state.datePreset)
      params.set("datePreset", state.datePreset);
    setOptionalParam(params, "dateFrom", state.dateFrom);
    setOptionalParam(params, "dateTo", state.dateTo);
  }
  setCsvParam(params, "status", state.statuses);
  setCsvParam(params, "checkoutState", state.checkoutStates);
  setCsvParam(params, "channel", state.channels);
  setCsvParam(
    params,
    "messengerDeliveryStatus",
    state.messengerDeliveryStatuses,
  );
  setOptionalParam(params, "subtotalMin", state.subtotalMin);
  setOptionalParam(params, "subtotalMax", state.subtotalMax);
  setOptionalParam(params, "itemCountMin", state.itemCountMin);
  setOptionalParam(params, "itemCountMax", state.itemCountMax);
}

export function buildAdminCartRequestUrl(state: AdminCartRequestUrlState) {
  const params = new URLSearchParams();
  appendAdminCartRequestParams(params, state, true);
  const query = params.toString();
  return `/admin/cart-requests${query ? `?${query}` : ""}`;
}

export function buildAdminCartRequestApiUrl(state: AdminCartRequestUrlState) {
  const params = new URLSearchParams();
  params.set("scope", state.scope);
  params.set("page", String(state.page));
  params.set("limit", String(state.limit));
  appendAdminCartRequestParams(params, state, false);
  return `/api/admin/cart-requests?${params.toString()}`;
}

function localDateValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shiftLocalDate(date: Date, days: number) {
  const next = new Date(date);
  next.setHours(12, 0, 0, 0);
  next.setDate(next.getDate() + days);
  return next;
}

export function getAdminCartRequestDateRange(
  preset: AdminCartRequestDatePreset,
  now = new Date(),
) {
  const today = new Date(now);
  today.setHours(12, 0, 0, 0);
  if (preset === "today") {
    const value = localDateValue(today);
    return { dateFrom: value, dateTo: value };
  }
  if (preset === "yesterday") {
    const value = localDateValue(shiftLocalDate(today, -1));
    return { dateFrom: value, dateTo: value };
  }
  if (preset === "sevenDays" || preset === "thirtyDays") {
    const days = preset === "sevenDays" ? 6 : 29;
    return {
      dateFrom: localDateValue(shiftLocalDate(today, -days)),
      dateTo: localDateValue(today),
    };
  }
  if (preset === "thisMonth") {
    const first = new Date(today.getFullYear(), today.getMonth(), 1, 12);
    return { dateFrom: localDateValue(first), dateTo: localDateValue(today) };
  }
  if (preset === "lastMonth") {
    const first = new Date(today.getFullYear(), today.getMonth() - 1, 1, 12);
    const last = new Date(today.getFullYear(), today.getMonth(), 0, 12);
    return { dateFrom: localDateValue(first), dateTo: localDateValue(last) };
  }
  return { dateFrom: null, dateTo: null };
}

export function formatAdminCartRequestFilterNumber(value: number | null) {
  return value === null ? "" : new Intl.NumberFormat("vi-VN").format(value);
}

export function parseAdminCartRequestFilterNumber(value: string) {
  const digits = value.replace(/[^0-9]/g, "");
  if (!digits) return null;
  const parsed = Number(digits);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function formatRange(min: number | null, max: number | null, suffix = "") {
  if (min !== null && max !== null)
    return `${formatAdminCartRequestFilterNumber(min)}–${formatAdminCartRequestFilterNumber(max)}${suffix}`;
  if (min !== null)
    return `Từ ${formatAdminCartRequestFilterNumber(min)}${suffix}`;
  return `Đến ${formatAdminCartRequestFilterNumber(max ?? 0)}${suffix}`;
}

export function getAdminCartRequestFilterChips(
  state: AdminCartRequestUrlState,
): AdminCartRequestFilterChip[] {
  const chips: AdminCartRequestFilterChip[] = [];
  if (state.dateFrom || state.dateTo) {
    const dateLabel = state.datePreset
      ? DATE_PRESET_LABELS[state.datePreset]
      : "Khoảng ngày tùy chỉnh";
    chips.push({ key: "date", label: dateLabel });
  }
  if (state.statuses.length)
    chips.push({
      key: "status",
      label: state.statuses.map((value) => CART_REQUEST_STATUS_LABELS[value]).join(", "),
    });
  if (state.checkoutStates.length)
    chips.push({
      key: "checkoutState",
      label: state.checkoutStates
        .map((value) => CART_CHECKOUT_STATE_LABELS[value])
        .join(", "),
    });
  if (state.channels.length)
    chips.push({
      key: "channel",
      label: state.channels.map((value) => CART_REQUEST_CHANNEL_LABELS[value]).join(", "),
    });
  if (state.messengerDeliveryStatuses.length)
    chips.push({
      key: "messengerDeliveryStatus",
      label: state.messengerDeliveryStatuses
        .map((value) => MESSENGER_DELIVERY_STATUS_LABELS[value])
        .join(", "),
    });
  if (state.subtotalMin !== null || state.subtotalMax !== null)
    chips.push({
      key: "subtotal",
      label: `${formatRange(state.subtotalMin, state.subtotalMax)} ₫`,
    });
  if (state.itemCountMin !== null || state.itemCountMax !== null)
    chips.push({
      key: "itemCount",
      label: `${formatRange(state.itemCountMin, state.itemCountMax, " mặt hàng")}`,
    });
  return chips;
}

export function removeAdminCartRequestFilter(
  state: AdminCartRequestUrlState,
  key: string,
): AdminCartRequestUrlState {
  const next = { ...state };
  if (key === "date") {
    next.datePreset = null;
    next.dateFrom = null;
    next.dateTo = null;
  } else if (key === "status") next.statuses = [];
  else if (key === "checkoutState") next.checkoutStates = [];
  else if (key === "channel") next.channels = [];
  else if (key === "messengerDeliveryStatus") next.messengerDeliveryStatuses = [];
  else if (key === "subtotal") {
    next.subtotalMin = null;
    next.subtotalMax = null;
  } else if (key === "itemCount") {
    next.itemCountMin = null;
    next.itemCountMax = null;
  }
  next.page = 1;
  return next;
}
