import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

function migration(name: string) {
  return readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8");
}

describe("forward migration xóa seed demo", () => {
  it("chạy đủ chain, xóa đúng request seed và giữ catalog/lịch sử", () => {
    const database = new DatabaseSync(":memory:");
    for (const name of [
      "0001_initial.sql",
      "0002_seed.sql",
      "0003_messenger_checkout_v1.sql",
      "0004_direct_seller_cart_share_v1.sql",
    ])
      database.exec(migration(name));

    database.exec(`
      INSERT INTO cart_requests (
        id, public_code, submission_token, item_line_count, total_quantity,
        subtotal_vnd, telegram_status, contact_channel,
        messenger_delivery_status, created_at, updated_at
      ) VALUES (
        'request-history', 'GH-HISTORY-1', 'seed-canonical-request-token-other',
        1, 1, 125000, 'NOT_APPLICABLE', 'SHARE', 'NOT_APPLICABLE',
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      );
      INSERT INTO cart_request_items (
        id, cart_request_id, product_id, variant_id, product_name_snapshot,
        variant_name_snapshot, unit_price_vnd, quantity, line_total_vnd
      ) VALUES (
        'item-history', 'request-history', 'prod-gerber', 'variant-gerber-227',
        'Lịch sử không phải seed', '227g', 125000, 1, 125000
      );
    `);

    database.exec(migration("0005_remove_demo_cart_request.sql"));
    database.exec(migration("0006_product_taxonomy_v1.sql"));
    database.exec(migration("0007_storefront_access_gate_v1.sql"));

    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM cart_requests WHERE id = 'request-canonical' AND submission_token = 'seed-canonical-request-token'")
        .get(),
    ).toEqual({ count: 0 });
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM cart_request_items WHERE cart_request_id = 'request-canonical'")
        .get(),
    ).toEqual({ count: 0 });
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM cart_requests WHERE id = 'request-history'")
        .get(),
    ).toEqual({ count: 1 });
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM cart_request_items WHERE cart_request_id = 'request-history'")
        .get(),
    ).toEqual({ count: 1 });
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM products WHERE id = 'prod-gerber'").get(),
    ).toEqual({ count: 1 });
    expect(
      database.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name IN ('cart_share_links', 'messenger_rate_limits') ORDER BY name").all(),
    ).toEqual([{ name: "cart_share_links" }, { name: "messenger_rate_limits" }]);
    const columns = database
      .prepare("PRAGMA table_info(cart_requests)")
      .all()
      .map((column) => (column as { name: string }).name);
    expect(columns).toEqual(expect.arrayContaining(["telegram_status", "messenger_delivery_status"]));
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM categories WHERE slug IN ('bot-an-dam', 'banh-an-dam', 'trai-cay-nghien', 'pudding-custard-hu-dinh-duong', 'tui-thuc-an', 'hu-thuc-an')").get(),
    ).toEqual({ count: 6 });
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM brands WHERE slug IN ('heinz', 'ellas-kitchen', 'organix', 'kiddylicious', 'cerelac', 'hipp', 'kendamil')").get(),
    ).toEqual({ count: 7 });
    expect(
      database.prepare("SELECT brand_id, min_age_months FROM products WHERE id = 'prod-heinz'").get(),
    ).toEqual({ brand_id: "brand-heinz", min_age_months: 4 });
    expect(
      database
        .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name IN ('access_links', 'access_link_groups', 'access_sessions', 'access_link_events') ORDER BY name")
        .all(),
    ).toEqual([
      { name: "access_link_events" },
      { name: "access_link_groups" },
      { name: "access_links" },
      { name: "access_sessions" },
    ]);
    expect(
      database
        .prepare("SELECT value FROM app_settings WHERE key = 'storefront_session_ttl_seconds'")
        .get(),
    ).toEqual({ value: "1296000" });
    expect(
      database
        .prepare("SELECT name FROM sqlite_schema WHERE type = 'index' AND name LIKE 'idx_access_%' ORDER BY name")
        .all(),
    ).toEqual([
      { name: "idx_access_link_events_type_time" },
      { name: "idx_access_link_events_visitor" },
      { name: "idx_access_link_groups_link" },
      { name: "idx_access_links_status_deleted" },
      { name: "idx_access_sessions_link_expiry" },
      { name: "idx_access_sessions_link_version" },
    ]);
    database.close();
  });
});
