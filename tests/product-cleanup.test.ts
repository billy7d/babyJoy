import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const markerProductIds = [
  "00201127-c850-4130-bf2e-ddaaeaf7a9e0",
  "a2f5fd08-2f14-4034-829f-8d0bfc9b784a",
  "b25e2654-a980-4a14-b522-919faa6b574c",
];
const seedProductIds = [
  "prod-baby-oil",
  "prod-gerber",
  "prod-heinz",
  "prod-hipp",
  "prod-little-sprouts",
  "prod-rice-apple",
  "prod-vegetable-puree",
  "prod-wakodo-rice",
];

function migration(name: string) {
  return readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8");
}

function createDatabase(seed = true) {
  const database = new DatabaseSync(":memory:");
  for (const name of [
    "0001_initial.sql",
    ...(seed ? ["0002_seed.sql"] : []),
    "0003_messenger_checkout_v1.sql",
    "0004_direct_seller_cart_share_v1.sql",
    "0005_remove_demo_cart_request.sql",
    "0006_product_taxonomy_v1.sql",
    "0007_storefront_access_gate_v1.sql",
  ])
    database.exec(migration(name));
  return database;
}

function insertMarkerProducts(database: DatabaseSync) {
  database.exec(`
    INSERT INTO products (id, name, slug, status) VALUES
      ('00201127-c850-4130-bf2e-ddaaeaf7a9e0', 'testasd', 'testasd', 'HIDDEN'),
      ('a2f5fd08-2f14-4034-829f-8d0bfc9b784a', 'BabyJoy Lifecycle Test 2', 'babyjoy-lifecycle-test-2-20260827', 'AVAILABLE'),
      ('b25e2654-a980-4a14-b522-919faa6b574c', 'BabyJoy Production Smoke Test 2026-08-27 AB', 'babyjoy-production-smoke-test-20260827', 'AVAILABLE');
    INSERT INTO product_variants (id, product_id, name, sku, price_vnd) VALUES
      ('marker-testasd-variant', '00201127-c850-4130-bf2e-ddaaeaf7a9e0', 'Mặc định', 'TESTASD-1', 1),
      ('marker-lifecycle-1', 'a2f5fd08-2f14-4034-829f-8d0bfc9b784a', 'Mặc định', 'LIFECYCLE-20260827-002', 89000),
      ('marker-lifecycle-2', 'a2f5fd08-2f14-4034-829f-8d0bfc9b784a', 'Mặc định 2', 'LIFECYCLE-2123', 100000),
      ('marker-smoke-variant', 'b25e2654-a980-4a14-b522-919faa6b574c', 'Gói test 100g', 'SMOKE-20260827', 123000);
    INSERT INTO product_images (id, product_id, r2_key, alt_text, sort_order) VALUES
      ('marker-smoke-image-1', 'b25e2654-a980-4a14-b522-919faa6b574c', 'products/smoke-1.jpg', 'Smoke 1', 0),
      ('marker-smoke-image-2', 'b25e2654-a980-4a14-b522-919faa6b574c', 'products/smoke-2.jpg', 'Smoke 2', 1),
      ('marker-smoke-image-3', 'b25e2654-a980-4a14-b522-919faa6b574c', 'products/smoke-3.jpg', 'Smoke 3', 2);
    INSERT INTO product_categories (product_id, category_id)
      VALUES ('b25e2654-a980-4a14-b522-919faa6b574c', 'cat-snack');
    INSERT INTO product_tags (product_id, tag_id)
      VALUES
        ('b25e2654-a980-4a14-b522-919faa6b574c', 'tag-age-6'),
        ('b25e2654-a980-4a14-b522-919faa6b574c', 'tag-dairy-free'),
        ('b25e2654-a980-4a14-b522-919faa6b574c', 'tag-no-sugar'),
        ('b25e2654-a980-4a14-b522-919faa6b574c', 'tag-organic');
  `);
}

function insertHistory(database: DatabaseSync) {
  database.exec(`
    INSERT INTO cart_requests (
      id, public_code, submission_token, item_line_count, total_quantity,
      subtotal_vnd, telegram_status, contact_channel, messenger_delivery_status
    ) VALUES (
      'cleanup-history', 'GH-CLEANUP-1', 'cleanup-history-token', 2, 2,
      248000, 'NOT_APPLICABLE', 'SHARE', 'NOT_APPLICABLE'
    );
    INSERT INTO cart_request_items (
      id, cart_request_id, product_id, variant_id, product_name_snapshot,
      variant_name_snapshot, sku_snapshot, image_key_snapshot,
      unit_price_vnd, quantity, line_total_vnd
    ) VALUES
      (
        'cleanup-seed-item', 'cleanup-history', 'prod-gerber', 'variant-gerber-227',
        'Bột ăn dặm Gerber Organic Yến mạch & Chuối', '227g', 'GER-227',
        'products/gerber.jpg', 125000, 1, 125000
      ),
      (
        'cleanup-marker-item', 'cleanup-history',
        'b25e2654-a980-4a14-b522-919faa6b574c', 'marker-smoke-variant',
        'BabyJoy Production Smoke Test 2026-08-27 AB', 'Gói test 100g',
        'SMOKE-20260827', 'products/smoke-1.jpg', 123000, 1, 123000
      );
  `);
}

function insertNonTarget(database: DatabaseSync) {
  database.exec(`
    INSERT INTO products (id, name, slug, status)
      VALUES ('real-test-like-product', 'Sản phẩm thật test nội bộ', 'san-pham-that-test-noi-bo', 'AVAILABLE');
    INSERT INTO product_variants (id, product_id, name, sku, price_vnd)
      VALUES ('real-test-like-variant', 'real-test-like-product', 'Gói 100g', 'REAL-TEST-100', 99000);
  `);
}

describe("production product cleanup migrations", () => {
  it("chỉ xóa đúng 11 ID, giữ taxonomy và cart snapshot", () => {
    const database = createDatabase();
    insertMarkerProducts(database);
    insertNonTarget(database);
    insertHistory(database);
    const categoriesBefore = database.prepare("SELECT * FROM categories ORDER BY id").all();
    const tagsBefore = database.prepare("SELECT * FROM tags ORDER BY id").all();
    const brandsBefore = database.prepare("SELECT * FROM brands ORDER BY id").all();
    const historyBefore = database
      .prepare(
        `SELECT product_name_snapshot, variant_name_snapshot, sku_snapshot,
          image_key_snapshot, unit_price_vnd, quantity, line_total_vnd
         FROM cart_request_items ORDER BY id`,
      )
      .all();

    database.exec("BEGIN");
    database.exec(migration("0008_cleanup_test_products.sql"));
    database.exec(migration("0009_cleanup_seed_test_products.sql"));
    database.exec("COMMIT");

    expect(database.prepare("SELECT COUNT(*) AS count FROM products").get()).toEqual({ count: 1 });
    expect(database.prepare("SELECT id FROM products").all()).toEqual([
      { id: "real-test-like-product" },
    ]);
    expect(database.prepare("SELECT COUNT(*) AS count FROM product_variants").get()).toEqual({ count: 1 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM product_images").get()).toEqual({ count: 0 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM product_categories").get()).toEqual({ count: 0 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM product_tags").get()).toEqual({ count: 0 });
    expect(database.prepare("SELECT * FROM categories ORDER BY id").all()).toEqual(categoriesBefore);
    expect(database.prepare("SELECT * FROM tags ORDER BY id").all()).toEqual(tagsBefore);
    expect(database.prepare("SELECT * FROM brands ORDER BY id").all()).toEqual(brandsBefore);
    expect(database.prepare("SELECT COUNT(*) AS count FROM cart_requests").get()).toEqual({ count: 1 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM cart_request_items").get()).toEqual({ count: 2 });
    expect(
      database.prepare("SELECT product_id, variant_id FROM cart_request_items ORDER BY id").all(),
    ).toEqual([
      { product_id: null, variant_id: null },
      { product_id: null, variant_id: null },
    ]);
    expect(
      database
        .prepare(
          `SELECT product_name_snapshot, variant_name_snapshot, sku_snapshot,
            image_key_snapshot, unit_price_vnd, quantity, line_total_vnd
           FROM cart_request_items ORDER BY id`,
        )
        .all(),
    ).toEqual(historyBefore);
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    database.close();
  });

  it("migration marker chạy độc lập, không chạm 8 seed product", () => {
    const database = createDatabase();
    insertMarkerProducts(database);

    database.exec(migration("0008_cleanup_test_products.sql"));

    expect(database.prepare("SELECT id FROM products ORDER BY id").all()).toEqual(
      seedProductIds.map((id) => ({ id })).sort((left, right) => left.id.localeCompare(right.id)),
    );
    expect(database.prepare("SELECT id FROM products WHERE id IN ('real-test-like-product')").all()).toEqual([]);
    database.close();
  });

  it("chạy lại an toàn và không dùng predicate LIKE quá rộng", () => {
    const database = createDatabase();
    insertMarkerProducts(database);
    database.exec(migration("0008_cleanup_test_products.sql"));
    database.exec(migration("0008_cleanup_test_products.sql"));
    database.exec(migration("0009_cleanup_seed_test_products.sql"));

    expect(database.prepare("SELECT COUNT(*) AS count FROM products").get()).toEqual({ count: 0 });
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(migration("0008_cleanup_test_products.sql")).not.toContain("LIKE");
    expect(migration("0009_cleanup_seed_test_products.sql")).not.toContain("LIKE");
    database.close();
  });

  it("khớp chính xác 3 marker ID và 8 seed ID đã audit", () => {
    const markerSql = migration("0008_cleanup_test_products.sql");
    const seedSql = migration("0009_cleanup_seed_test_products.sql");

    for (const id of markerProductIds) expect(markerSql).toContain(id);
    for (const id of seedProductIds) expect(seedSql).toContain(id);
    expect(markerProductIds.every((id) => !seedSql.includes(id))).toBe(true);
    expect(seedProductIds.every((id) => !markerSql.includes(id))).toBe(true);
  });
});
