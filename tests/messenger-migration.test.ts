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
});
