import { readFileSync } from "node:fs";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import worker from "../workers/app";
import {
  buildCartRequestListQuery,
  parseCartRequestListParams,
} from "../workers/cart-requests";

function migration(name: string) {
  return readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8");
}

class SqliteStatementAdapter {
  private values: unknown[] = [];

  constructor(private readonly statement: StatementSync) {}

  bind(...values: unknown[]) {
    const next = new SqliteStatementAdapter(this.statement);
    next.values = values;
    return next;
  }

  all<T>() {
    return Promise.resolve({ results: this.statement.all(...this.values) as T[] });
  }

  first<T>() {
    return Promise.resolve((this.statement.get(...this.values) as T | undefined) ?? null);
  }

  run() {
    const result = this.statement.run(...this.values);
    return Promise.resolve({ meta: { changes: Number(result.changes) } });
  }
}

class SqliteD1Adapter {
  constructor(readonly database: DatabaseSync) {}

  prepare(sql: string) {
    return new SqliteStatementAdapter(this.database.prepare(sql));
  }
}

const databases: DatabaseSync[] = [];
const migrations = [
  "0001_initial.sql",
  "0002_seed.sql",
  "0003_messenger_checkout_v1.sql",
  "0004_direct_seller_cart_share_v1.sql",
  "0005_remove_demo_cart_request.sql",
  "0006_product_taxonomy_v1.sql",
  "0007_storefront_access_gate_v1.sql",
  "0008_cleanup_test_products.sql",
  "0009_cleanup_seed_test_products.sql",
  "0010_storefront_brand_v1.sql",
  "0011_promotion_management_p0_p1.sql",
  "0012_inventory_messenger_reservation.sql",
];

function createEnv() {
  const database = new DatabaseSync(":memory:");
  migrations.forEach((name) => database.exec(migration(name)));
  databases.push(database);
  return {
    database,
    env: {
      DB: new SqliteD1Adapter(database),
      ENVIRONMENT: "development",
      PRODUCT_IMAGES: { head: async () => ({}) },
      STOREFRONT_ACCESS_GATE_ENABLED: "false",
    } as unknown as Env,
  };
}

afterEach(() => {
  while (databases.length) databases.pop()?.close();
});

function api(env: Env, path: string) {
  return worker.fetch(
    new Request(`https://metraphuong.com${path}`),
    env,
    {} as ExecutionContext,
  );
}

type ListBody = {
  data: Array<Record<string, unknown>>;
  pagination: {
    page: number;
    limit: number;
    totalItems: number;
    totalPages: number;
    hasPrevious: boolean;
    hasNext: boolean;
  };
};

async function list(env: Env, path: string) {
  return (await (await api(env, path)).json()) as ListBody;
}

function isoDate(index: number) {
  return new Date(Date.UTC(2026, 7, index)).toISOString();
}

function insertRequest(
  database: DatabaseSync,
  index: number,
  options: {
    checkoutState?: string;
    contactChannel?: "LEGACY" | "MESSENGER" | "SHARE";
    customerName?: string | null;
    customerPhone?: string | null;
    itemLineCount?: number;
    subtotalVnd?: number;
    status?: string;
    messengerDeliveryStatus?: string;
    createdAt?: string;
    reservationExpiresAt?: string | null;
  } = {},
) {
  const id = `admin-list-${index}`;
  const contactChannel = options.contactChannel ?? (index % 3 === 0 ? "MESSENGER" : index % 3 === 1 ? "SHARE" : "LEGACY");
  const deliveryStatus = options.messengerDeliveryStatus ?? (contactChannel === "MESSENGER" ? index % 2 ? "PENDING" : "SENT" : "NOT_APPLICABLE");
  const checkoutState = options.checkoutState ?? "WAITING_SELLER_CONFIRM";
  const itemLineCount = options.itemLineCount ?? (index % 5) + 1;
  database
    .prepare(
      `INSERT INTO cart_requests (
        id, public_code, submission_token, customer_name, customer_phone,
        item_line_count, total_quantity, subtotal_vnd, status, telegram_status,
        contact_channel, messenger_delivery_status, checkout_state,
        reservation_started_at, reservation_expires_at, reservation_duration_minutes,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'NOT_APPLICABLE', ?, ?, ?, ?, ?, 15, ?, ?)`,
    )
    .run(
      id,
      `GH-P0-${String(index).padStart(3, "0")}`,
      `admin-list-token-${index}`,
      options.customerName === undefined
        ? `Customer ${String(index).padStart(2, "0")}`
        : options.customerName,
      options.customerPhone === undefined
        ? `0988 000 ${String(index).padStart(3, "0")}`
        : options.customerPhone,
      itemLineCount,
      itemLineCount + 5,
      options.subtotalVnd ?? 100000 + index * 10000,
      options.status ?? (index % 5 === 0 ? "CONFIRMED" : "SUBMITTED"),
      contactChannel,
      deliveryStatus,
      checkoutState,
      checkoutState === "WAITING_SELLER_CONFIRM" ? isoDate(2) : null,
      options.reservationExpiresAt ?? "2026-12-31T00:00:00.000Z",
      options.createdAt ?? isoDate(index),
      options.createdAt ?? isoDate(index),
    );
  return id;
}

function seedRequests(database: DatabaseSync) {
  for (let index = 1; index <= 47; index += 1) {
    insertRequest(database, index, {
      customerName: index === 47 ? null : index === 1 ? "Alice" : undefined,
      customerPhone: index === 1 ? "0988 123 456" : undefined,
      itemLineCount: index === 1 ? 2 : undefined,
      subtotalVnd: index === 1 ? 110000 : undefined,
      createdAt: index === 1 ? "2026-08-01T01:00:00.000Z" : isoDate(index),
      reservationExpiresAt: `2026-09-${String(Math.min(index + 1, 28)).padStart(2, "0")}T00:00:00.000Z`,
    });
  }
  insertRequest(database, 101, {
    checkoutState: "LEGACY",
    contactChannel: "LEGACY",
    customerName: "Legacy row",
    createdAt: "2026-08-20T00:00:00.000Z",
  });
  insertRequest(database, 102, {
    checkoutState: "READY_TO_SEND",
    contactChannel: "SHARE",
    customerName: "Ready row",
    createdAt: "2026-08-21T00:00:00.000Z",
  });
  insertRequest(database, 103, {
    checkoutState: "CONFIRMED",
    contactChannel: "SHARE",
    customerName: "Confirmed row",
    createdAt: "2026-08-22T00:00:00.000Z",
  });
  insertRequest(database, 104, {
    checkoutState: "EXPIRED",
    contactChannel: "SHARE",
    customerName: "Expired row",
    createdAt: "2026-08-23T00:00:00.000Z",
  });
  insertRequest(database, 105, {
    checkoutState: "CANCELLED",
    contactChannel: "SHARE",
    customerName: "Cancelled row",
    createdAt: "2026-08-24T00:00:00.000Z",
  });
  database
    .prepare(
      `INSERT INTO messenger_checkout_sessions (
        id, cart_request_id, ref_hash, status_token_hash, status,
        expires_at, created_at, updated_at
      ) VALUES ('admin-session-1', 'admin-list-3', 'admin-ref-hash', 'admin-status-hash', 'IDENTIFIED', '2026-12-31T00:00:00.000Z', '2026-08-03T00:00:00.000Z', '2026-08-03T00:00:00.000Z')`,
    )
    .run();
}

describe("Admin Cart Requests parser và query builder", () => {
  it("chuẩn hóa page/limit, trim search, enum arrays và range", () => {
    const parsed = parseCartRequestListParams(
      new URLSearchParams(
        "scope=share&page=0&limit=999&q=%20098%20&sort=subtotal&order=asc&status=SUBMITTED,CONFIRMED&checkoutState=WAITING_SELLER_CONFIRM&channel=SHARE&messengerDeliveryStatus=PENDING&dateFrom=2026-08-01&dateTo=2026-08-31&subtotalMin=100000&subtotalMax=500000&itemCountMin=2&itemCountMax=7",
      ),
    );
    expect(parsed).toMatchObject({
      scope: "share",
      page: 1,
      limit: 20,
      q: "098",
      sort: "subtotal",
      order: "asc",
      statuses: ["SUBMITTED", "CONFIRMED"],
      checkoutStates: ["WAITING_SELLER_CONFIRM"],
      channels: ["SHARE"],
      messengerDeliveryStatuses: ["PENDING"],
      dateFrom: "2026-08-01",
      dateTo: "2026-08-31",
      subtotalMin: 100000,
      subtotalMax: 500000,
      itemCountMin: 2,
      itemCountMax: 7,
      invalid: [],
    });
  });

  it("unknown sort/order fallback an toàn và range lỗi fail closed", () => {
    const parsed = parseCartRequestListParams(
      new URLSearchParams(
        "sort=created_at;DROP TABLE cart_requests&order=sideways&dateFrom=2026-02-30&subtotalMin=-1&itemCountMin=8&itemCountMax=2",
      ),
    );
    expect(parsed.sort).toBeNull();
    expect(parsed.order).toBe("desc");
    expect(parsed.invalid).toEqual(
      expect.arrayContaining(["dateFrom", "subtotalMin", "itemCountRange"]),
    );
    const query = buildCartRequestListQuery(
      parseCartRequestListParams(new URLSearchParams("sort=not-valid")),
      { inventorySchema: true, messengerSessionSchema: true },
    );
    expect(query.orderSql).toContain("WAITING_SELLER_CONFIRM");
    expect(query.orderSql).not.toContain("DROP TABLE");
    expect(query.whereSql).toContain("cr.checkout_state = 'WAITING_SELLER_CONFIRM'");
  });

  it("chỉ nhận các page size admin đã công bố", () => {
    expect(parseCartRequestListParams(new URLSearchParams("limit=50")).limit).toBe(50);
    expect(parseCartRequestListParams(new URLSearchParams("limit=100")).limit).toBe(100);
    expect(parseCartRequestListParams(new URLSearchParams("limit=49")).limit).toBe(20);
  });

  it("mọi sort hợp lệ đều chỉ dùng whitelist và có tie-breaker", () => {
    for (const sort of [
      "createdAt",
      "customerName",
      "publicCode",
      "subtotal",
      "itemCount",
      "reservationExpiry",
    ]) {
      const params = parseCartRequestListParams(
        new URLSearchParams(`sort=${sort}&order=desc`),
      );
      const query = buildCartRequestListQuery(params, {
        inventorySchema: true,
        messengerSessionSchema: true,
      });
      expect(query.orderSql).toContain("cr.created_at DESC");
      expect(query.orderSql).toContain("cr.id DESC");
    }
  });
});

describe("GET /api/admin/cart-requests authoritative pagination", () => {
  it("COUNT và SELECT cùng filter, page 1/2/3 và page out-of-range được clamp", async () => {
    const { database, env } = createEnv();
    seedRequests(database);
    const pageOne = await list(env, "/api/admin/cart-requests?scope=queue&limit=20&page=1");
    expect(pageOne.data).toHaveLength(20);
    expect(pageOne.pagination).toEqual({
      page: 1,
      limit: 20,
      totalItems: 47,
      totalPages: 3,
      hasPrevious: false,
      hasNext: true,
    });
    const pageTwo = await list(env, "/api/admin/cart-requests?scope=queue&limit=20&page=2");
    expect(pageTwo.data).toHaveLength(20);
    expect(pageTwo.pagination).toMatchObject({ page: 2, totalItems: 47, hasPrevious: true, hasNext: true });
    const pageThree = await list(env, "/api/admin/cart-requests?scope=queue&limit=20&page=3");
    expect(pageThree.data).toHaveLength(7);
    expect(pageThree.pagination).toMatchObject({ page: 3, totalItems: 47, totalPages: 3, hasNext: false });
    const clamped = await list(env, "/api/admin/cart-requests?scope=queue&limit=20&page=999");
    expect(clamped.data).toHaveLength(7);
    expect(clamped.pagination.page).toBe(3);
  });

  it("search code/phone/customer và sort deterministic theo field được chọn", async () => {
    const { database, env } = createEnv();
    seedRequests(database);
    expect((await list(env, "/api/admin/cart-requests?scope=queue&q=GH-P0-001")).data.map((row) => row.publicCode)).toEqual(["GH-P0-001"]);
    expect((await list(env, "/api/admin/cart-requests?scope=queue&q=0988%20123")).data.map((row) => row.publicCode)).toEqual(["GH-P0-001"]);
    expect((await list(env, "/api/admin/cart-requests?scope=queue&q=alice")).data.map((row) => row.publicCode)).toEqual(["GH-P0-001"]);

    const newest = await list(env, "/api/admin/cart-requests?scope=queue&sort=createdAt&order=desc");
    const oldest = await list(env, "/api/admin/cart-requests?scope=queue&sort=createdAt&order=asc");
    expect(newest.data[0]?.publicCode).toBe("GH-P0-047");
    expect(oldest.data[0]?.publicCode).toBe("GH-P0-001");
    const highValue = await list(env, "/api/admin/cart-requests?scope=queue&sort=subtotal&order=desc");
    const lowValue = await list(env, "/api/admin/cart-requests?scope=queue&sort=subtotal&order=asc");
    expect(highValue.data[0]?.publicCode).toBe("GH-P0-047");
    expect(lowValue.data[0]?.publicCode).toBe("GH-P0-001");
    const manyLines = await list(env, "/api/admin/cart-requests?scope=queue&sort=itemCount&order=desc");
    expect(manyLines.data[0]?.itemLineCount).toBe(5);
    const codes = await list(env, "/api/admin/cart-requests?scope=queue&sort=publicCode&order=asc");
    expect(codes.data[0]?.publicCode).toBe("GH-P0-001");
    const names = await list(env, "/api/admin/cart-requests?scope=queue&limit=100&sort=customerName&order=asc");
    expect(names.data[0]?.customerName).toBe("Alice");
    expect(names.data.at(-1)?.customerName).toBeNull();
    const namesDesc = await list(env, "/api/admin/cart-requests?scope=queue&limit=100&sort=customerName&order=desc");
    expect(namesDesc.data[0]?.customerName).toBe("Customer 46");
    expect(namesDesc.data.at(-1)?.customerName).toBeNull();
    const lowLines = await list(env, "/api/admin/cart-requests?scope=queue&sort=itemCount&order=asc");
    expect(lowLines.data[0]?.itemLineCount).toBe(1);
    const expiry = await list(env, "/api/admin/cart-requests?scope=queue&sort=reservationExpiry&order=asc");
    expect(expiry.data[0]?.publicCode).toBe("GH-P0-001");
  });

  it("date/status/checkout/channel/Messenger/range compose mà không bỏ scope", async () => {
    const { database, env } = createEnv();
    seedRequests(database);
    const date = await list(env, "/api/admin/cart-requests?scope=share&dateFrom=2026-08-01&dateTo=2026-08-01");
    expect(date.data.map((row) => row.publicCode)).toEqual(["GH-P0-001"]);
    const status = await list(env, "/api/admin/cart-requests?scope=queue&status=CONFIRMED");
    expect(status.pagination.totalItems).toBe(9);
    expect(status.data.every((row) => row.status === "CONFIRMED")).toBe(true);
    const checkout = await list(env, "/api/admin/cart-requests?scope=all&checkoutState=CONFIRMED");
    expect(checkout.data.map((row) => row.publicCode)).toEqual(["GH-P0-103"]);
    const share = await list(env, "/api/admin/cart-requests?scope=share&channel=SHARE");
    expect(share.data.every((row) => row.contactChannel === "SHARE")).toBe(true);
    const messenger = await list(env, "/api/admin/cart-requests?scope=messenger&channel=MESSENGER&messengerDeliveryStatus=PENDING");
    expect(messenger.data.length).toBeGreaterThan(0);
    expect(messenger.data.every((row) => row.contactChannel === "MESSENGER" && row.messengerDeliveryStatus === "PENDING")).toBe(true);
    const session = await list(env, "/api/admin/cart-requests?scope=messenger&messengerSessionStatus=IDENTIFIED");
    expect(session.data.map((row) => row.publicCode)).toEqual(["GH-P0-003"]);
    const combined = await list(env, "/api/admin/cart-requests?scope=share&q=0988%20123&status=SUBMITTED&sort=subtotal&order=desc");
    expect(combined.data.map((row) => row.publicCode)).toEqual(["GH-P0-001"]);
    const range = await list(env, "/api/admin/cart-requests?scope=queue&subtotalMin=110000&subtotalMax=110000&itemCountMin=2&itemCountMax=2");
    expect(range.data.map((row) => row.publicCode)).toEqual(["GH-P0-001"]);
  });

  it("trả lỗi validation cho range/date không hợp lệ và không tạo page giả khi filter rỗng", async () => {
    const { database, env } = createEnv();
    seedRequests(database);
    const invalid = await api(env, "/api/admin/cart-requests?scope=queue&subtotalMin=500000&subtotalMax=100000");
    expect(invalid.status).toBe(422);
    const empty = await list(env, "/api/admin/cart-requests?scope=queue&q=khong-ton-tai");
    expect(empty).toMatchObject({ data: [], pagination: { totalItems: 0, totalPages: 0, page: 1, hasPrevious: false, hasNext: false } });
  });

  it("giữ default operational priority của queue trước expiry rồi mới newest", async () => {
    const { database, env } = createEnv();
    seedRequests(database);
    const defaultOrder = await list(env, "/api/admin/cart-requests?scope=queue&limit=20");
    expect(defaultOrder.data[0]?.publicCode).toBe("GH-P0-001");
    const customNewest = await list(env, "/api/admin/cart-requests?scope=queue&limit=20&sort=createdAt&order=desc");
    expect(customNewest.data[0]?.publicCode).toBe("GH-P0-047");
  });
});
