import {
  ADMIN_DEFAULT_PAGE_SIZE,
  ADMIN_PAGE_SIZE_OPTIONS,
  normalizeLimit,
  normalizePage,
} from "../shared/pagination";
import {
  CART_CHECKOUT_STATES,
  CART_REQUEST_API_SCOPES,
  CART_REQUEST_CHANNELS,
  CART_REQUEST_SORT_KEYS,
  CART_REQUEST_STATUSES,
  MESSENGER_DELIVERY_STATUSES,
  MESSENGER_SESSION_STATUSES,
  type CartCheckoutState,
  type CartRequestChannel,
  type CartRequestScope,
  type CartRequestSort,
  type CartRequestSortOrder,
  type CartRequestStatus,
  type MessengerDeliveryStatus,
  type MessengerSessionStatus,
} from "../shared/cart-requests";

export type CartRequestListParams = {
  scope: CartRequestScope;
  page: number;
  limit: number;
  q: string;
  sort: CartRequestSort | null;
  order: CartRequestSortOrder;
  statuses: CartRequestStatus[];
  checkoutStates: CartCheckoutState[];
  channels: CartRequestChannel[];
  messengerDeliveryStatuses: MessengerDeliveryStatus[];
  messengerSessionStatuses: MessengerSessionStatus[];
  dateFrom: string | null;
  dateTo: string | null;
  subtotalMin: number | null;
  subtotalMax: number | null;
  itemCountMin: number | null;
  itemCountMax: number | null;
  invalid: string[];
};

export type CartRequestListQuery = {
  whereSql: string;
  values: Array<string | number>;
  orderSql: string;
};

// Chỉ các cột nằm trong whitelist này mới được phép đi vào ORDER BY.
export const CART_REQUEST_SORTS: Record<CartRequestSort, string> = {
  createdAt: "cr.created_at",
  customerName: "NULLIF(TRIM(cr.customer_name), '')",
  publicCode: "cr.public_code",
  subtotal: "cr.subtotal_vnd",
  itemCount: "cr.item_line_count",
  reservationExpiry: "cr.reservation_expires_at",
};

const CART_REQUEST_SORT_SET = new Set<string>(CART_REQUEST_SORT_KEYS);
const CART_REQUEST_SCOPE_SET = new Set<string>(CART_REQUEST_API_SCOPES);
const CART_REQUEST_STATUS_SET = new Set<string>(CART_REQUEST_STATUSES);
const CART_CHECKOUT_STATE_SET = new Set<string>(CART_CHECKOUT_STATES);
const CART_REQUEST_CHANNEL_SET = new Set<string>(CART_REQUEST_CHANNELS);
const MESSENGER_DELIVERY_STATUS_SET = new Set<string>(MESSENGER_DELIVERY_STATUSES);
const MESSENGER_SESSION_STATUS_SET = new Set<string>(MESSENGER_SESSION_STATUSES);

function uniqueQueryValues(searchParams: URLSearchParams, key: string) {
  return [
    ...new Set(
      searchParams
        .getAll(key)
        .flatMap((value) => value.split(","))
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
}

function validValues<T extends string>(
  values: string[],
  allowed: Set<string>,
) {
  return values.filter((value): value is T => allowed.has(value));
}

function parseDateOnly(
  searchParams: URLSearchParams,
  key: "dateFrom" | "dateTo",
  invalid: string[],
) {
  const raw = searchParams.get(key)?.trim() ?? "";
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    invalid.push(key);
    return null;
  }
  const [year, month, day] = raw.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    invalid.push(key);
    return null;
  }
  return raw;
}

function parseNonNegativeInteger(
  searchParams: URLSearchParams,
  key: "subtotalMin" | "subtotalMax" | "itemCountMin" | "itemCountMax",
  invalid: string[],
) {
  const raw = searchParams.get(key)?.trim() ?? "";
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    invalid.push(key);
    return null;
  }
  return parsed;
}

export function parseCartRequestListParams(
  searchParams: URLSearchParams,
): CartRequestListParams {
  const invalid: string[] = [];
  const rawScope = searchParams.get("scope")?.trim() ?? "";
  const scope = CART_REQUEST_SCOPE_SET.has(rawScope)
    ? (rawScope as CartRequestScope)
    : "queue";
  const rawSort = searchParams.get("sort")?.trim() ?? "";
  const sort = CART_REQUEST_SORT_SET.has(rawSort)
    ? (rawSort as CartRequestSort)
    : null;
  const rawOrder = searchParams.get("order")?.trim();
  const order: CartRequestSortOrder = rawOrder === "asc" ? "asc" : "desc";
  const dateFrom = parseDateOnly(searchParams, "dateFrom", invalid);
  const dateTo = parseDateOnly(searchParams, "dateTo", invalid);
  const subtotalMin = parseNonNegativeInteger(searchParams, "subtotalMin", invalid);
  const subtotalMax = parseNonNegativeInteger(searchParams, "subtotalMax", invalid);
  const itemCountMin = parseNonNegativeInteger(searchParams, "itemCountMin", invalid);
  const itemCountMax = parseNonNegativeInteger(searchParams, "itemCountMax", invalid);
  if (dateFrom && dateTo && dateFrom > dateTo) invalid.push("dateRange");
  if (subtotalMin !== null && subtotalMax !== null && subtotalMax < subtotalMin)
    invalid.push("subtotalRange");
  if (itemCountMin !== null && itemCountMax !== null && itemCountMax < itemCountMin)
    invalid.push("itemCountRange");
  return {
    scope,
    page: normalizePage(searchParams.get("page")),
    limit: normalizeLimit(searchParams.get("limit"), {
      defaultLimit: ADMIN_DEFAULT_PAGE_SIZE,
      allowedLimits: ADMIN_PAGE_SIZE_OPTIONS,
    }),
    q: (searchParams.get("q") ?? "").trim(),
    sort,
    order,
    statuses: validValues<CartRequestStatus>(
      uniqueQueryValues(searchParams, "status"),
      CART_REQUEST_STATUS_SET,
    ),
    checkoutStates: validValues<CartCheckoutState>(
      uniqueQueryValues(searchParams, "checkoutState"),
      CART_CHECKOUT_STATE_SET,
    ),
    channels: validValues<CartRequestChannel>(
      uniqueQueryValues(searchParams, "channel"),
      CART_REQUEST_CHANNEL_SET,
    ),
    messengerDeliveryStatuses: validValues<MessengerDeliveryStatus>(
      uniqueQueryValues(searchParams, "messengerDeliveryStatus"),
      MESSENGER_DELIVERY_STATUS_SET,
    ),
    messengerSessionStatuses: validValues<MessengerSessionStatus>(
      uniqueQueryValues(searchParams, "messengerSessionStatus"),
      MESSENGER_SESSION_STATUS_SET,
    ),
    dateFrom,
    dateTo,
    subtotalMin,
    subtotalMax,
    itemCountMin,
    itemCountMax,
    invalid: [...new Set(invalid)],
  };
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function placeholders(values: readonly unknown[]) {
  return values.map(() => "?").join(",");
}

function addInFilter(
  where: string[],
  values: Array<string | number>,
  column: string,
  selected: readonly string[],
) {
  if (!selected.length) return;
  where.push(`${column} IN (${placeholders(selected)})`);
  values.push(...selected);
}

function vietnamDateBoundary(dateOnly: string, addDays = 0) {
  const [year, month, day] = dateOnly.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + addDays));
  return `${date.toISOString().slice(0, 10)}T00:00:00+07:00`;
}

function buildDefaultOrder(inventorySchema: boolean) {
  if (inventorySchema)
    return [
      "CASE WHEN cr.checkout_state = 'WAITING_SELLER_CONFIRM' THEN 0 ELSE 1 END ASC",
      "CASE WHEN cr.reservation_expires_at IS NULL THEN 1 ELSE 0 END ASC",
      "cr.reservation_expires_at ASC",
      "cr.created_at DESC",
      "cr.id DESC",
    ].join(", ");
  return [
    "CASE WHEN cr.contact_channel = 'MESSENGER' AND cr.messenger_delivery_status != 'SENT' THEN 1 ELSE 0 END ASC",
    "cr.created_at DESC",
    "cr.id DESC",
  ].join(", ");
}

function buildCustomOrder(
  sort: CartRequestSort,
  order: CartRequestSortOrder,
) {
  const direction = order === "asc" ? "ASC" : "DESC";
  const field = CART_REQUEST_SORTS[sort];
  const clauses: string[] = [];
  if (sort === "customerName" || sort === "reservationExpiry")
    clauses.push(`CASE WHEN ${field} IS NULL THEN 1 ELSE 0 END ASC`);
  clauses.push(`${field} ${direction}`, "cr.created_at DESC", "cr.id DESC");
  return clauses.join(", ");
}

export function buildCartRequestListQuery(
  params: CartRequestListParams,
  options: { inventorySchema: boolean; messengerSessionSchema: boolean },
): CartRequestListQuery {
  const where: string[] = [];
  const values: Array<string | number> = [];
  const { inventorySchema, messengerSessionSchema } = options;

  if (inventorySchema) {
    if (params.scope === "messenger")
      where.push("cr.contact_channel = 'MESSENGER'");
    else if (params.scope === "share")
      where.push(
        "cr.contact_channel = 'SHARE' AND cr.checkout_state != 'READY_TO_SEND'",
      );
    else if (params.scope === "all")
      where.push("cr.checkout_state != 'READY_TO_SEND'");
    else where.push("cr.checkout_state = 'WAITING_SELLER_CONFIRM'");
  } else if (params.scope === "messenger") {
    where.push("cr.contact_channel = 'MESSENGER'");
  } else if (params.scope === "share") {
    where.push("cr.contact_channel = 'SHARE'");
  } else if (params.scope === "all") {
    where.push("1 = 1");
  } else {
    where.push(
      "(cr.contact_channel IN ('LEGACY', 'SHARE') OR cr.messenger_delivery_status = 'SENT')",
    );
  }

  if (params.q) {
    const pattern = `%${escapeLike(params.q.toLocaleLowerCase("vi-VN"))}%`;
    where.push(
      "(LOWER(COALESCE(cr.public_code, '')) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(cr.customer_name, '')) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(cr.customer_phone, '')) LIKE ? ESCAPE '\\')",
    );
    values.push(pattern, pattern, pattern);
  }
  addInFilter(where, values, "cr.status", params.statuses);
  if (inventorySchema) {
    addInFilter(where, values, "cr.checkout_state", params.checkoutStates);
  } else if (params.checkoutStates.length) {
    where.push(`? IN (${placeholders(params.checkoutStates)})`);
    values.push("LEGACY", ...params.checkoutStates);
  }
  addInFilter(where, values, "cr.contact_channel", params.channels);
  addInFilter(
    where,
    values,
    "cr.messenger_delivery_status",
    params.messengerDeliveryStatuses,
  );
  if (params.messengerSessionStatuses.length) {
    if (messengerSessionSchema) {
      addInFilter(
        where,
        values,
        "(SELECT status FROM messenger_checkout_sessions WHERE cart_request_id = cr.id ORDER BY created_at DESC LIMIT 1)",
        params.messengerSessionStatuses,
      );
    } else where.push("0 = 1");
  }
  if (params.dateFrom) {
    where.push("julianday(cr.created_at) >= julianday(?)");
    values.push(vietnamDateBoundary(params.dateFrom));
  }
  if (params.dateTo) {
    where.push("julianday(cr.created_at) < julianday(?)");
    values.push(vietnamDateBoundary(params.dateTo, 1));
  }
  if (params.subtotalMin !== null) {
    where.push("cr.subtotal_vnd >= ?");
    values.push(params.subtotalMin);
  }
  if (params.subtotalMax !== null) {
    where.push("cr.subtotal_vnd <= ?");
    values.push(params.subtotalMax);
  }
  if (params.itemCountMin !== null) {
    where.push("cr.item_line_count >= ?");
    values.push(params.itemCountMin);
  }
  if (params.itemCountMax !== null) {
    where.push("cr.item_line_count <= ?");
    values.push(params.itemCountMax);
  }

  return {
    whereSql: `WHERE ${where.join(" AND ")}`,
    values,
    orderSql: params.sort
      ? buildCustomOrder(params.sort, params.order)
      : buildDefaultOrder(inventorySchema),
  };
}
