import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

function migration(name: string) {
  return readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8");
}

describe("D1 migration Messenger Checkout v1", () => {
  it("giữ dữ liệu lịch sử, snapshot và cột Telegram khi đổi customer thành nullable", () => {
    const database = new DatabaseSync(":memory:");
    database.exec(migration("0001_initial.sql"));
    database.exec(migration("0002_seed.sql"));
    database.exec(migration("0003_messenger_checkout_v1.sql"));

    const request = database
      .prepare(
        `SELECT public_code, customer_name, customer_phone, telegram_status,
          telegram_last_error, contact_channel, messenger_delivery_status
         FROM cart_requests WHERE id = 'request-canonical'`,
      )
      .get() as Record<string, unknown>;
    expect(request).toMatchObject({
      public_code: "GH-260825-X7K2",
      customer_name: "Nguyễn Văn A",
      customer_phone: "0901 234 567",
      telegram_status: "FAILED",
      telegram_last_error: "400 Bad Request",
      contact_channel: "LEGACY",
      messenger_delivery_status: "NOT_APPLICABLE",
    });
    expect(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM cart_request_items WHERE cart_request_id = 'request-canonical'",
        )
        .get(),
    ).toEqual({ count: 3 });

    const columns = database
      .prepare("PRAGMA table_info(cart_requests)")
      .all() as Array<{ name: string; notnull: number }>;
    expect(columns.find((column) => column.name === "customer_name")?.notnull).toBe(0);
    expect(columns.find((column) => column.name === "customer_phone")?.notnull).toBe(0);
    expect(columns.some((column) => column.name === "telegram_message_id")).toBe(true);
    expect(columns.some((column) => column.name === "messenger_psid")).toBe(true);
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);

    const tables = database
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type = 'table' AND name LIKE 'messenger_%' ORDER BY name",
      )
      .all()
      .map((row) => (row as { name: string }).name);
    expect(tables).toEqual([
      "messenger_checkout_sessions",
      "messenger_rate_limits",
      "messenger_webhook_events",
    ]);
    database.close();
  });

  it("0004 giữ LEGACY/MESSENGER, nhận SHARE và không làm hỏng khóa ngoại", () => {
    const database = new DatabaseSync(":memory:");
    database.exec(migration("0001_initial.sql"));
    database.exec(migration("0002_seed.sql"));
    database.exec(migration("0003_messenger_checkout_v1.sql"));
    database.exec(`
      INSERT INTO cart_requests (
        id, public_code, submission_token, item_line_count, total_quantity,
        subtotal_vnd, telegram_status, contact_channel,
        messenger_delivery_status, created_at, updated_at
      ) VALUES (
        'request-messenger', 'GH-260827-MSGR', 'messenger-history-token', 1, 1,
        125000, 'PENDING', 'MESSENGER', 'PENDING', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      );
      INSERT INTO cart_request_items (
        id, cart_request_id, product_id, variant_id, product_name_snapshot,
        variant_name_snapshot, unit_price_vnd, quantity, line_total_vnd
      ) VALUES (
        'item-messenger', 'request-messenger', 'prod-gerber', 'variant-gerber-227',
        'Gerber lịch sử', '227g', 125000, 1, 125000
      );
      INSERT INTO messenger_checkout_sessions (
        id, cart_request_id, ref_hash, status_token_hash, status, expires_at,
        created_at, updated_at
      ) VALUES (
        'session-history', 'request-messenger', 'ref-history', 'status-history',
        'CREATED', '2099-01-01T00:00:00.000Z', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      );
      INSERT INTO messenger_webhook_events (
        event_key, event_type, cart_request_id, processing_status, received_at
      ) VALUES (
        'event-history', 'REFERRAL', 'request-messenger', 'PROCESSED', CURRENT_TIMESTAMP
      );
    `);
    const requestCountBefore = database
      .prepare("SELECT COUNT(*) AS count FROM cart_requests")
      .get();
    const itemCountBefore = database
      .prepare("SELECT COUNT(*) AS count FROM cart_request_items")
      .get();

    database.exec(migration("0004_direct_seller_cart_share_v1.sql"));

    expect(database.prepare("SELECT COUNT(*) AS count FROM cart_requests").get()).toEqual(requestCountBefore);
    expect(database.prepare("SELECT COUNT(*) AS count FROM cart_request_items").get()).toEqual(itemCountBefore);
    expect(database.prepare("SELECT COUNT(*) AS count FROM messenger_checkout_sessions").get()).toEqual({ count: 1 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM messenger_webhook_events").get()).toEqual({ count: 1 });
    database.exec(`
      INSERT INTO cart_requests (
        id, public_code, submission_token, item_line_count, total_quantity,
        subtotal_vnd, telegram_status, contact_channel,
        messenger_delivery_status, created_at, updated_at
      ) VALUES (
        'request-share', 'GH-260828-SHAR', 'share-token', 1, 1, 68000,
        'NOT_APPLICABLE', 'SHARE', 'NOT_APPLICABLE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      );
      INSERT INTO cart_share_links (
        id, cart_request_id, token_hash, expires_at, created_at
      ) VALUES (
        'share-link', 'request-share', 'hash-only', '2099-01-01T00:00:00.000Z', CURRENT_TIMESTAMP
      );
    `);
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(
      database
        .prepare("SELECT contact_channel, telegram_status, messenger_delivery_status FROM cart_requests WHERE id = 'request-share'")
        .get(),
    ).toEqual({
      contact_channel: "SHARE",
      telegram_status: "NOT_APPLICABLE",
      messenger_delivery_status: "NOT_APPLICABLE",
    });
    database.close();
  });
});
