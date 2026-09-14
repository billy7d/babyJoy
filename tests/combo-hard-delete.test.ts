import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import worker from "../workers/app";

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

function createEnv() {
  const database = new DatabaseSync(":memory:");
  const migrations = readdirSync("migrations")
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
  migrations.forEach((name) => database.exec(readFileSync(`migrations/${name}`, "utf8")));
  databases.push(database);
  return {
    database,
    env: {
      DB: new D1Adapter(database),
      PRODUCT_IMAGES: {
        head: async () => ({ size: 1024, httpMetadata: { contentType: "image/webp" } }),
        delete: async () => undefined,
      },
      ENVIRONMENT: "development",
      DIRECT_SELLER_SHARE_ENABLED: "false",
      MESSENGER_CHECKOUT_ENABLED: "false",
      STOREFRONT_ACCESS_GATE_ENABLED: "false",
    } as unknown as Env,
  };
}

function api(env: Env, path: string, init?: RequestInit) {
  return worker.fetch(
    new Request(`https://metraphuong.com${path}`, init),
    env,
    {} as ExecutionContext,
  );
}

function jsonInit(method: string, value: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  };
}

afterEach(() => {
  while (databases.length) databases.pop()?.close();
});

describe("Combo và hard-delete Product", () => {
  it("CRUD Combo, evaluate server-authoritative một line và đếm promotion theo line", async () => {
    const { env, database } = createEnv();
    const now = new Date().toISOString();
    database
      .prepare(
        `INSERT INTO products (id, name, slug, product_type, base_price_vnd, status, featured, sort_order, created_at, updated_at)
         VALUES ('source-product', 'Sản phẩm nguồn', 'source-product', 'STANDARD', 0, 'AVAILABLE', 0, 1, ?, ?)`
      )
      .run(now, now);
    database
      .prepare(
        `INSERT INTO product_variants (
          id, product_id, name, package_size, sku, price_vnd, compare_at_price_vnd, availability,
          track_inventory, stock_on_hand, reserved_quantity, sort_order, created_at, updated_at
        ) VALUES ('source-variant', 'source-product', 'Variant nguồn', '', 'SOURCE-1', 125000, NULL, 'AVAILABLE', 1, 10, 0, 0, ?, ?)`
      )
      .run(now, now);
    database
      .prepare(
        "UPDATE product_variants SET track_inventory = 1, stock_on_hand = 10, reserved_quantity = 0 WHERE id = 'source-variant'",
      )
      .run();
    const selection = {
      configVersion: 1,
      items: [{ groupItemId: "combo-item-gerber", variantId: "source-variant", quantity: 1 }],
    };
    const response = await api(env, "/api/admin/combos", jsonInit("POST", {
      name: "Combo thử bữa sáng",
      slug: "combo-thu-bua-sang",
      basePriceVnd: 130000,
      status: "AVAILABLE",
      categoryIds: ["cat-cereal"],
      comboConfig: {
        groupMode: "ALL_GROUPS",
        groups: [{
          id: "combo-group-gerber",
          name: "Món chính",
          description: "Chọn một món",
          selectionType: "CHOOSE",
          minSelect: 1,
          maxSelect: 1,
          items: [{
            id: "combo-item-gerber",
            variantId: "source-variant",
            fixedQuantity: 0,
            minQuantity: 1,
            maxQuantity: 1,
            priceAdjustment: 5000,
          }],
        }],
      },
    }));
    expect(response.status).toBe(200);
    const created = (await response.json()) as { id: string };
    expect(created.id).toBeTruthy();

    const detail = await api(env, `/api/admin/products/${created.id}`);
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({
      data: {
        productType: "COMBO",
        basePriceVnd: 130000,
        comboConfig: {
          configVersion: 1,
          groups: [{ items: [{ variantId: "source-variant" }] }],
        },
      },
    });

    const comboList = await api(env, "/api/admin/products?productType=COMBO");
    const comboListBody = (await comboList.json()) as {
      data?: Array<{ id: string; productType?: string }>;
    };
    expect(comboList.status).toBe(200);
    expect(comboListBody.data?.some((product) => product.id === created.id)).toBe(true);

    const availableList = await api(env, "/api/products?available=1");
    const availableListBody = (await availableList.json()) as {
      data?: Array<{ id: string }>;
    };
    expect(availableList.status).toBe(200);
    expect(availableListBody.data?.some((product) => product.id === created.id)).toBe(true);

    const evaluated = await api(env, "/api/cart/evaluate", jsonInit("POST", {
      items: [{
        lineType: "COMBO",
        comboProductId: created.id,
        comboVersion: 1,
        selection,
        quantity: 1,
        displayedPrice: 135000,
      }],
    }));
    expect(evaluated.status).toBe(200);
    const body = (await evaluated.json()) as {
      totalQuantity: number;
      items: Array<{ lineType?: string; comboComponents?: unknown[]; quantity: number; priceVnd: number }>;
    };
    expect(body.totalQuantity).toBe(1);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      lineType: "COMBO",
      quantity: 1,
      priceVnd: 135000,
    });
    expect(body.items[0]?.comboComponents).toHaveLength(1);
  });

  it("không tạo Product mồ côi khi Combo có Variant không hợp lệ", async () => {
    const { env, database } = createEnv();
    const response = await api(env, "/api/admin/combos", jsonInit("POST", {
      name: "Combo lỗi cấu hình",
      slug: "combo-loi-cau-hinh",
      basePriceVnd: 99000,
      status: "HIDDEN",
      comboConfig: {
        groupMode: "ALL_GROUPS",
        groups: [{
          id: "invalid-group",
          name: "Món chính",
          selectionType: "FIXED",
          minSelect: 0,
          maxSelect: 0,
          items: [{
            id: "invalid-item",
            variantId: "missing-variant",
            fixedQuantity: 1,
            minQuantity: 1,
            maxQuantity: 1,
            priceAdjustment: 0,
          }],
        }],
      },
    }));
    expect(response.status).toBe(422);
    expect(
      database.prepare("SELECT id FROM products WHERE slug = 'combo-loi-cau-hinh'").get(),
    ).toBeUndefined();
  });

  it("hard-delete Product hủy cart active, detach lịch sử và giữ snapshot inventory/component", async () => {
    const { env, database } = createEnv();
    const now = new Date().toISOString();
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    database
      .prepare(
        `INSERT INTO products (id, name, slug, product_type, base_price_vnd, status, featured, sort_order, created_at, updated_at)
         VALUES ('source-product', 'Sản phẩm nguồn', 'source-product', 'STANDARD', 0, 'AVAILABLE', 0, 1, ?, ?)`
      )
      .run(now, now);
    database
      .prepare(
        `INSERT INTO product_variants (
          id, product_id, name, package_size, sku, price_vnd, compare_at_price_vnd, availability,
          track_inventory, stock_on_hand, reserved_quantity, sort_order, created_at, updated_at
        ) VALUES ('source-variant', 'source-product', 'Variant nguồn', '', 'SOURCE-1', 125000, NULL, 'AVAILABLE', 1, 10, 0, 0, ?, ?)`
      )
      .run(now, now);
    database
      .prepare(
        "UPDATE product_variants SET track_inventory = 1, stock_on_hand = 10, reserved_quantity = 0 WHERE id = 'source-variant'",
      )
      .run();
    const comboId = "combo-history-product";
    database
      .prepare(
        `INSERT INTO products (id, name, slug, product_type, base_price_vnd, status, featured, sort_order, created_at, updated_at)
         VALUES (?, 'Combo lịch sử', ?, 'COMBO', 130000, 'AVAILABLE', 0, 99, ?, ?)`,
      )
      .run(comboId, comboId, now, now);
    database
      .prepare(
        `INSERT INTO combo_configs (product_id, group_mode, config_version, created_at, updated_at)
         VALUES (?, 'ALL_GROUPS', 1, ?, ?)`
      )
      .run(comboId, now, now);
    database
      .prepare(
        `INSERT INTO combo_groups (id, combo_product_id, name, description, selection_type, min_select, max_select, display_order, created_at, updated_at)
         VALUES ('combo-history-group', ?, 'Món chính', '', 'FIXED', 0, 0, 0, ?, ?)`
      )
      .run(comboId, now, now);
    database
      .prepare(
        `INSERT INTO combo_group_items (id, group_id, variant_id, fixed_quantity, min_quantity, max_quantity, price_adjustment, display_order, created_at, updated_at)
         VALUES ('combo-history-item', 'combo-history-group', 'source-variant', 1, 0, 1, 0, 0, ?, ?)`
      )
      .run(now, now);

    const selectionJson = JSON.stringify({ configVersion: 1, items: [] });
    const cartRequestStatement = database.prepare(
      `INSERT INTO cart_requests (
        id, public_code, submission_token, item_line_count, total_quantity, subtotal_vnd,
        status, contact_channel, checkout_state, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    cartRequestStatement.run(
      "combo-active-cart",
      "GH-ACTIVE",
      "token-active",
      1,
      1,
      130000,
      "CONTACTED",
      "SHARE",
      "WAITING_SELLER_CONFIRM",
      now,
      now,
    );
    cartRequestStatement.run(
      "combo-history-cart",
      "GH-HISTORY",
      "token-history",
      2,
      2,
      255000,
      "SUBMITTED",
      "SHARE",
      "LEGACY",
      now,
      now,
    );
    // Cart chỉ có quà tặng cũng phải bị hủy nếu Product nguồn bị xóa.
    cartRequestStatement.run(
      "gift-active-cart",
      "GH-GIFT-ACTIVE",
      "token-gift-active",
      1,
      1,
      0,
      "SUBMITTED",
      "SHARE",
      "WAITING_SELLER_CONFIRM",
      now,
      now,
    );
    const cartItemStatement = database.prepare(
      `INSERT INTO cart_request_items (
        id, cart_request_id, product_id, variant_id, product_name_snapshot, variant_name_snapshot,
        sku_snapshot, image_key_snapshot, unit_price_vnd, quantity, line_total_vnd,
        line_type, combo_product_id, combo_version, combo_selection_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    cartItemStatement.run(
      "combo-active-item",
      "combo-active-cart",
      comboId,
      null,
      "Combo lịch sử",
      "Combo",
      null,
      null,
      130000,
      1,
      130000,
      "COMBO",
      comboId,
      1,
      selectionJson,
      now,
    );
    cartItemStatement.run(
      "standard-history-item",
      "combo-history-cart",
      "source-product",
      "source-variant",
      "Bột Gerber snapshot",
      "227g snapshot",
      "GER-227",
      "images/gerber-history.jpg",
      125000,
      1,
      125000,
      "STANDARD",
      null,
      null,
      null,
      now,
    );
    cartItemStatement.run(
      "combo-history-item-line",
      "combo-history-cart",
      comboId,
      null,
      "Combo lịch sử",
      "Combo",
      null,
      null,
      130000,
      1,
      130000,
      "COMBO",
      comboId,
      1,
      selectionJson,
      now,
    );
    const componentStatement = database.prepare(
      `INSERT INTO cart_request_combo_components (
        id, cart_request_item_id, combo_product_id, combo_version, group_id, group_name_snapshot,
        group_item_id, variant_id, product_id, product_name_snapshot, variant_name_snapshot,
        sku_snapshot, image_key_snapshot, quantity, price_adjustment_vnd, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    componentStatement.run(
      "active-component",
      "combo-active-item",
      comboId,
      1,
      "combo-history-group",
      "Món chính",
      "combo-history-item",
      "source-variant",
      "source-product",
      "Gerber snapshot",
      "227g snapshot",
      "GER-227",
      "images/gerber-history.jpg",
      1,
      0,
      now,
    );
    componentStatement.run(
      "history-component",
      "combo-history-item-line",
      comboId,
      1,
      "combo-history-group",
      "Món chính",
      "combo-history-item",
      "source-variant",
      "source-product",
      "Gerber snapshot",
      "227g snapshot",
      "GER-227",
      "images/gerber-history.jpg",
      1,
      0,
      now,
    );
    const giftStatement = database.prepare(
      `INSERT INTO cart_request_promotion_gifts (
        id, cart_request_id, promotion_id, product_id, variant_id,
        product_name_snapshot, variant_name_snapshot, sku_snapshot,
        image_key_snapshot, unit_price_vnd, quantity, line_total_vnd, created_at
      ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, 0, 1, 0, ?)`
    );
    giftStatement.run(
      "active-gift",
      "gift-active-cart",
      "source-product",
      "source-variant",
      "Quà nguồn snapshot",
      "227g snapshot",
      "GER-227",
      "images/gerber-history.jpg",
      now,
    );
    giftStatement.run(
      "history-gift",
      "combo-history-cart",
      "source-product",
      "source-variant",
      "Quà nguồn snapshot",
      "227g snapshot",
      "GER-227",
      "images/gerber-history.jpg",
      now,
    );
    database
      .prepare(
        `INSERT INTO inventory_reservations (
          id, cart_request_id, variant_id, variant_name_snapshot, sku_snapshot, quantity,
          source_type, status, expires_at, created_at
        ) VALUES ('active-reservation', 'combo-active-cart', 'source-variant', '227g snapshot', 'GER-227', 1, 'CART_ITEM', 'ACTIVE', ?, ?)`
      )
      .run(future, now);
    database
      .prepare(
        `INSERT INTO inventory_movements (
          id, variant_id, variant_name_snapshot, sku_snapshot, cart_request_id, movement_type,
          quantity_delta, stock_before, stock_after, note, created_at
        ) VALUES ('history-movement', 'source-variant', '227g snapshot', 'GER-227', NULL, 'RESTOCK', 1, 9, 10, 'history', ?)`
      )
      .run(now);

    const preflight = await api(env, `/api/admin/products/source-product/delete-preflight`);
    expect(preflight.status).toBe(200);
    expect(await preflight.json()).toMatchObject({
      data: {
        counts: { activeCarts: 2, promotionGiftReferences: 2 },
        affectedCombos: [{ id: comboId }],
      },
    });

    const deleted = await api(env, "/api/admin/products/source-product", jsonInit("DELETE", {
      confirmation: "DELETE",
    }));
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toMatchObject({
      success: true,
      deleted: true,
      activeCartsCancelled: 2,
    });

    expect(database.prepare("SELECT id FROM products WHERE id = 'source-product'").get()).toBeUndefined();
    expect(database.prepare("SELECT id FROM product_variants WHERE id = 'source-variant'").get()).toBeUndefined();
    expect(database.prepare("SELECT status, checkout_state AS checkoutState FROM cart_requests WHERE id = 'combo-active-cart'").get()).toEqual({ status: "CANCELLED", checkoutState: "CANCELLED" });
    expect(database.prepare("SELECT status, checkout_state AS checkoutState FROM cart_requests WHERE id = 'gift-active-cart'").get()).toEqual({ status: "CANCELLED", checkoutState: "CANCELLED" });
    expect(database.prepare("SELECT COUNT(*) AS count FROM cart_request_items WHERE cart_request_id = 'combo-active-cart'").get()).toEqual({ count: 0 });
    expect(database.prepare("SELECT product_id AS productId, variant_id AS variantId, product_name_snapshot AS productName FROM cart_request_items WHERE id = 'standard-history-item'").get()).toEqual({ productId: null, variantId: null, productName: "Bột Gerber snapshot" });
    expect(database.prepare("SELECT product_id AS productId, variant_id AS variantId, product_name_snapshot AS productName FROM cart_request_combo_components WHERE id = 'history-component'").get()).toEqual({ productId: null, variantId: null, productName: "Gerber snapshot" });
    expect(database.prepare("SELECT status FROM inventory_reservations WHERE id = 'active-reservation'").get()).toEqual({ status: "RELEASED" });
    expect(database.prepare("SELECT variant_id AS variantId, variant_name_snapshot AS variantName, sku_snapshot AS sku FROM inventory_movements WHERE id = 'history-movement'").get()).toEqual({ variantId: null, variantName: "227g snapshot", sku: "GER-227" });
    expect(database.prepare("SELECT product_id AS productId, variant_id AS variantId, product_name_snapshot AS productName FROM cart_request_promotion_gifts WHERE id = 'history-gift'").get()).toEqual({ productId: null, variantId: null, productName: "Quà nguồn snapshot" });
    const historyResponse = await api(env, "/api/admin/cart-requests/combo-history-cart");
    expect(historyResponse.status).toBe(200);
    const historyBody = await historyResponse.json() as {
      data: { items: Array<{ lineType?: string; comboComponents?: Array<{ productName: string; variantName: string; quantity: number }> }> };
    };
    expect(historyBody.data.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        lineType: "COMBO",
        comboComponents: [expect.objectContaining({ productName: "Gerber snapshot", variantName: "227g snapshot", quantity: 1 })],
      }),
    ]));
    expect(database.prepare("SELECT status FROM products WHERE id = ?").get(comboId)).toEqual({ status: "HIDDEN" });
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});
