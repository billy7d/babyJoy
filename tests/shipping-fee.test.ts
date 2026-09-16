import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

function migration(name: string) {
  return readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8");
}

function migrationNames() {
  return readdirSync(new URL("../migrations", import.meta.url))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
}

function applyUntil(database: DatabaseSync, exclusiveName?: string) {
  migrationNames().forEach((name) => {
    if (exclusiveName && name >= exclusiveName) return;
    database.exec(migration(name));
  });
}

describe("Shipping fee additive migration", () => {
  it("fresh schema có cột snapshot, default 0 và constraint không âm", () => {
    const database = new DatabaseSync(":memory:");
    applyUntil(database);
    const column = database
      .prepare("PRAGMA table_info(cart_requests)")
      .all()
      .find((row) => (row as { name: string }).name === "shipping_fee_vnd") as {
        name: string;
        notnull: number;
        dflt_value: string;
      } | undefined;
    expect(column).toMatchObject({ name: "shipping_fee_vnd", notnull: 1, dflt_value: "0" });
    expect(
      database
        .prepare("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'cart_requests'")
        .get(),
    ).toMatchObject({ sql: expect.stringContaining("shipping_fee_vnd INTEGER NOT NULL DEFAULT 0") });
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    database.close();
  });

  it("upgrade legacy giữ nguyên subtotal/discount/final và cấp default shipping 0", () => {
    const database = new DatabaseSync(":memory:");
    applyUntil(database, "0025_shipping_fee_v1.sql");
    database
      .prepare(
        `INSERT INTO cart_requests (
          id, public_code, submission_token, item_line_count, total_quantity,
          subtotal_vnd, promotion_discount_vnd, final_total_vnd, status,
          telegram_status, contact_channel, messenger_delivery_status,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'SUBMITTED', 'NOT_APPLICABLE', 'SHARE', 'NOT_APPLICABLE', ?, ?)`,
      )
      .run(
        "legacy-shipping",
        "GH-LEGACY-SHIP",
        "legacy-shipping-token",
        1,
        1,
        123456,
        7000,
        116456,
        "2026-09-16T00:00:00.000Z",
        "2026-09-16T00:00:00.000Z",
      );
    const before = database
      .prepare("SELECT subtotal_vnd, promotion_discount_vnd, final_total_vnd FROM cart_requests WHERE id = ?")
      .get("legacy-shipping");
    database.exec(migration("0025_shipping_fee_v1.sql"));
    expect(
      database
        .prepare("SELECT subtotal_vnd, promotion_discount_vnd, final_total_vnd, shipping_fee_vnd FROM cart_requests WHERE id = ?")
        .get("legacy-shipping"),
    ).toEqual({ ...before, shipping_fee_vnd: 0 });
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    database.close();
  });
});
