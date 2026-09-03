import { readFileSync } from "node:fs";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import worker from "../workers/app";

function migration(name: string) {
  return readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8");
}

class StatementAdapter {
  private values: unknown[] = [];

  constructor(private readonly statement: StatementSync) {}

  bind(...values: unknown[]) {
    const next = new StatementAdapter(this.statement);
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

class D1Adapter {
  constructor(readonly database: DatabaseSync) {}

  prepare(sql: string) {
    return new StatementAdapter(this.database.prepare(sql));
  }

  async batch(statements: StatementAdapter[]) {
    this.database.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec("COMMIT");
      return results;
    } catch (caught) {
      this.database.exec("ROLLBACK");
      throw caught;
    }
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
  "0013_variant_retirement_v1.sql",
];

function createEnv() {
  const database = new DatabaseSync(":memory:");
  migrations.forEach((name) => database.exec(migration(name)));
  databases.push(database);
  return {
    database,
    env: {
      DB: new D1Adapter(database),
      PRODUCT_IMAGES: { head: async () => ({}) },
      ENVIRONMENT: "development",
      DIRECT_SELLER_SHARE_ENABLED: "false",
      MESSENGER_CHECKOUT_ENABLED: "false",
      STOREFRONT_ACCESS_GATE_ENABLED: "false",
    } as unknown as Env,
  };
}

afterEach(() => {
  while (databases.length) databases.pop()?.close();
});

function api(env: Env, path: string, init?: RequestInit) {
  return worker.fetch(
    new Request(`https://metraphuong.com${path}`, init),
    env,
    {} as ExecutionContext,
  );
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

type SeededVariant = {
  id: string;
  name: string;
  sku: string;
  priceVnd: number;
  availability: "AVAILABLE" | "OUT_OF_STOCK" | "HIDDEN";
  sortOrder: number;
  trackInventory: boolean;
  stockOnHand: number;
  reservedQuantity: number;
};

function seedProduct(
  database: DatabaseSync,
  suffix: string,
  options: { targetStock?: number; targetTrackInventory?: boolean } = {},
) {
  const productId = `variant-retirement-product-${suffix}`;
  const slug = `variant-retirement-product-${suffix}`;
  const target: SeededVariant = {
    id: `variant-retirement-target-${suffix}`,
    name: "Variant cần xóa",
    sku: `RETIRE-TARGET-${suffix}`,
    priceVnd: 120000,
    availability: "AVAILABLE",
    sortOrder: 0,
    trackInventory: options.targetTrackInventory ?? true,
    stockOnHand: options.targetStock ?? 10,
    reservedQuantity: 0,
  };
  const retained: SeededVariant = {
    id: `variant-retirement-retained-${suffix}`,
    name: "Variant giữ lại",
    sku: `RETIRE-RETAINED-${suffix}`,
    priceVnd: 180000,
    availability: "AVAILABLE",
    sortOrder: 1,
    trackInventory: false,
    stockOnHand: 0,
    reservedQuantity: 0,
  };
  database
    .prepare(
      `INSERT INTO products (
        id, name, slug, status, featured, sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, 'AVAILABLE', 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    )
    .run(productId, `Variant retirement ${suffix}`, slug);
  const insertVariant = database.prepare(
    `INSERT INTO product_variants (
      id, product_id, name, sku, price_vnd, availability,
      track_inventory, stock_on_hand, reserved_quantity,
      sort_order, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  );
  [target, retained].forEach((variant) =>
    insertVariant.run(
      variant.id,
      productId,
      variant.name,
      variant.sku,
      variant.priceVnd,
      variant.availability,
      variant.trackInventory ? 1 : 0,
      variant.stockOnHand,
      variant.reservedQuantity,
      variant.sortOrder,
    ),
  );
  return { productId, slug, target, retained };
}

function variantPayload(variant: SeededVariant): Record<string, unknown> {
  return {
    id: variant.id,
    name: variant.name,
    sku: variant.sku,
    priceVnd: variant.priceVnd,
    compareAtPriceVnd: null,
    availability: variant.availability,
    sortOrder: variant.sortOrder,
    trackInventory: variant.trackInventory,
    stockOnHand: variant.stockOnHand,
  };
}

function productPayload(
  product: ReturnType<typeof seedProduct>,
  variants: Array<SeededVariant | Record<string, unknown>>,
  deletedVariantIds: string[] = [],
) {
  return {
    name: `Variant retirement ${product.productId}`,
    slug: product.slug,
    status: "AVAILABLE",
    featured: false,
    sortOrder: 1,
    categoryIds: [],
    tagIds: [],
    variants: variants.map((variant) =>
      "id" in variant ? variantPayload(variant as SeededVariant) : variant,
    ),
    deletedVariantIds,
  };
}

async function saveProduct(
  env: Env,
  product: ReturnType<typeof seedProduct>,
  variants: Array<SeededVariant | Record<string, unknown>>,
  deletedVariantIds: string[] = [],
) {
  return api(
    env,
    `/api/admin/products/${product.productId}`,
    jsonInit("PUT", productPayload(product, variants, deletedVariantIds)),
  );
}

function insertMovement(
  database: DatabaseSync,
  variantId: string,
  movementType: "INITIAL_STOCK" | "RESTOCK" | "MANUAL_ADJUSTMENT",
  stockBefore: number,
  stockAfter: number,
) {
  database
    .prepare(
      `INSERT INTO inventory_movements (
        id, variant_id, movement_type, quantity_delta,
        stock_before, stock_after, note, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    )
    .run(
      crypto.randomUUID(),
      variantId,
      movementType,
      stockAfter - stockBefore,
      stockBefore,
      stockAfter,
      `Fixture ${movementType}`,
    );
}

describe("Variant retirement giữ inventory history", () => {
  it("hard-delete variant chưa có history và vẫn cho reuse SKU", async () => {
    const { env, database } = createEnv();
    const product = seedProduct(database, "no-history", { targetTrackInventory: false, targetStock: 0 });

    const deleted = await saveProduct(env, product, [product.retained], [product.target.id]);
    expect(deleted.status).toBe(200);
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM product_variants WHERE id = ?").get(product.target.id),
    ).toEqual({ count: 0 });

    const reused = {
      name: "Variant tái dùng SKU",
      sku: product.target.sku,
      priceVnd: product.target.priceVnd,
      compareAtPriceVnd: null,
      availability: "AVAILABLE" as const,
      sortOrder: 0,
      trackInventory: false,
      stockOnHand: 0,
    };
    const reusedResponse = await saveProduct(env, product, [product.retained, reused]);
    expect(reusedResponse.status).toBe(200);
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM product_variants WHERE sku = ?").get(product.target.sku),
    ).toEqual({ count: 1 });
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("archive variant có INITIAL_STOCK, giữ movement và ẩn khỏi admin/public/storefront", async () => {
    const { env, database } = createEnv();
    const product = seedProduct(database, "initial-history");
    insertMovement(database, product.target.id, "INITIAL_STOCK", 0, product.target.stockOnHand);

    const deleted = await saveProduct(env, product, [product.retained], [product.target.id]);
    expect(deleted.status).toBe(200);
    expect(
      database.prepare("SELECT availability, archived_at AS archivedAt FROM product_variants WHERE id = ?").get(product.target.id),
    ).toMatchObject({ availability: "HIDDEN" });
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM inventory_movements WHERE variant_id = ?").get(product.target.id),
    ).toEqual({ count: 1 });

    const adminResponse = await api(env, `/api/admin/products/${product.productId}`);
    const adminBody = (await adminResponse.json()) as { data?: { variants?: Array<{ id: string }> } };
    expect(adminBody.data?.variants?.map((variant) => variant.id)).toEqual([product.retained.id]);

    const publicResponse = await api(env, `/api/products/${product.slug}`);
    const publicBody = (await publicResponse.json()) as { data?: { variants?: Array<{ id: string }> } };
    expect(publicBody.data?.variants?.map((variant) => variant.id)).toEqual([product.retained.id]);

    const catalogResponse = await api(env, "/api/products?limit=100");
    const catalogBody = (await catalogResponse.json()) as {
      data?: Array<{ id: string; variants?: Array<{ id: string }> }>;
    };
    const catalogProduct = catalogBody.data?.find((item) => item.id === product.productId);
    expect(catalogProduct?.variants?.some((variant) => variant.id === product.target.id)).toBe(false);

    const checkoutResponse = await api(
      env,
      "/api/cart/evaluate",
      jsonInit("POST", { items: [{ variantId: product.target.id, quantity: 1 }] }),
    );
    expect(checkoutResponse.status).toBe(409);
    expect(await checkoutResponse.json()).toMatchObject({ error: { code: "VARIANT_UNAVAILABLE" } });

    const sameSkuResponse = await saveProduct(env, product, [
      product.retained,
      {
        name: "Không được tái dùng SKU lịch sử",
        sku: product.target.sku,
        priceVnd: product.target.priceVnd,
        compareAtPriceVnd: null,
        availability: "AVAILABLE",
        sortOrder: 0,
        trackInventory: false,
        stockOnHand: 0,
      },
    ]);
    expect(sameSkuResponse.status).toBe(409);
    expect(await sameSkuResponse.json()).toMatchObject({ error: { code: "DUPLICATE_SKU" } });
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("archive variant có RESTOCK và MANUAL_ADJUSTMENT, không mất history", async () => {
    const { env, database } = createEnv();
    const product = seedProduct(database, "stock-history", { targetStock: 5 });
    const restocked = { ...product.target, stockOnHand: 8 };
    const manuallyAdjusted = { ...restocked, stockOnHand: 6 };

    expect((await saveProduct(env, product, [restocked, product.retained])).status).toBe(200);
    expect((await saveProduct(env, product, [manuallyAdjusted, product.retained])).status).toBe(200);
    expect((await saveProduct(env, product, [product.retained], [product.target.id])).status).toBe(200);

    expect(
      database
        .prepare("SELECT movement_type AS movementType, variant_id AS variantId FROM inventory_movements WHERE variant_id = ? ORDER BY rowid")
        .all(product.target.id),
    ).toEqual([
      { movementType: "RESTOCK", variantId: product.target.id },
      { movementType: "MANUAL_ADJUSTMENT", variantId: product.target.id },
    ]);
    expect(
      database.prepare("SELECT availability, archived_at AS archivedAt FROM product_variants WHERE id = ?").get(product.target.id),
    ).toMatchObject({ availability: "HIDDEN" });
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("active reservation trả 409 và không archive/delete variant", async () => {
    const { env, database } = createEnv();
    const product = seedProduct(database, "active-reservation");
    const requestId = "variant-retirement-active-request";
    database
      .prepare(
        `INSERT INTO cart_requests (
          id, public_code, submission_token, item_line_count, total_quantity,
          subtotal_vnd, status, telegram_status
        ) VALUES (?, ?, ?, 1, 1, ?, 'SUBMITTED', 'NOT_APPLICABLE')`,
      )
      .run(requestId, "GH-RETIRE-ACTIVE", "retirement-active-token", product.target.priceVnd);
    database
      .prepare(
        `INSERT INTO inventory_reservations (
          id, cart_request_id, variant_id, quantity, source_type, status,
          expires_at, created_at
        ) VALUES (?, ?, ?, 1, 'CART_ITEM', 'ACTIVE', ?, ?)`,
      )
      .run(
        "variant-retirement-active-reservation",
        requestId,
        product.target.id,
        "2099-01-01T00:00:00.000Z",
        "2026-09-03T00:00:00.000Z",
      );

    const response = await saveProduct(env, product, [product.retained], [product.target.id]);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "INVENTORY_CONFLICT" } });
    expect(
      database.prepare("SELECT availability, archived_at AS archivedAt FROM product_variants WHERE id = ?").get(product.target.id),
    ).toEqual({ availability: "AVAILABLE", archivedAt: null });
    expect(
      database.prepare("SELECT status FROM inventory_reservations WHERE variant_id = ?").get(product.target.id),
    ).toEqual({ status: "ACTIVE" });
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});
