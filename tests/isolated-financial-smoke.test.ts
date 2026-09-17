import { describe, expect, it } from "vitest";
import {
  buildFixtureSql,
  ISOLATED_SMOKE_CASES,
} from "../scripts/isolated-financial-smoke.mjs";

describe("isolated financial smoke fixture", () => {
  it("giữ đủ bốn case với item canonical, không nhận số tiền từ fixture", () => {
    expect(Object.keys(ISOLATED_SMOKE_CASES)).toEqual([
      "noPromo",
      "realized",
      "giftOnly",
      "freeShipping",
    ]);
    Object.values(ISOLATED_SMOKE_CASES).forEach((items) => {
      expect(items).toHaveLength(1);
      expect(items[0]).toEqual(expect.objectContaining({ quantity: expect.any(Number) }));
      expect(items[0]).not.toHaveProperty("priceVnd");
    });
  });

  it("tạo promotion thật trong D1 isolated cho discount, gift-only và free shipping", () => {
    const fixtureSql = buildFixtureSql();
    expect(fixtureSql).toContain("PRODUCT_DISCOUNT");
    expect(fixtureSql).toContain("BUY_X_GET_Y");
    expect(fixtureSql).toContain("QUANTITY_DISCOUNT");
    expect(fixtureSql).toContain('"kind":"FREE_SHIPPING"');
    expect(fixtureSql).toContain("DELETE FROM promotions");
    expect(fixtureSql).not.toContain("BEGIN;");
  });
});
