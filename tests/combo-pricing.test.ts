import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateComboConfig, type ComboConfig } from "../shared/combos";

function createConfig(compareAtPriceVnd: number | null): ComboConfig {
  return {
    productId: "combo-product",
    groupMode: "ALL_GROUPS",
    configVersion: 1,
    compareAtPriceVnd,
    groups: [
      {
        id: "combo-group",
        comboProductId: "combo-product",
        name: "Món chính",
        description: "",
        selectionType: "FIXED",
        minSelect: 0,
        maxSelect: 0,
        displayOrder: 0,
        items: [
          {
            id: "combo-item",
            groupId: "combo-group",
            variantId: "source-variant",
            fixedQuantity: 1,
            minQuantity: 1,
            maxQuantity: 1,
            priceAdjustment: 0,
            displayOrder: 0,
          },
        ],
      },
    ],
  };
}

describe("Combo compare pricing", () => {
  it("giữ cùng contract validation với giá so sánh của Variant", () => {
    expect(validateComboConfig(createConfig(null)).ok).toBe(true);
    expect(validateComboConfig(createConfig(150_000)).ok).toBe(true);
    expect(validateComboConfig(createConfig(0)).ok).toBe(true);
    expect(validateComboConfig(createConfig(-1)).ok).toBe(false);
    expect(validateComboConfig(createConfig(1.5)).ok).toBe(false);
  });

  it("lưu giá so sánh riêng và không thay nguồn giá checkout authoritative", () => {
    const migration = readFileSync("migrations/0024_combo_compare_price_v1.sql", "utf8");
    const worker = readFileSync("workers/combos.ts", "utf8");
    expect(migration).toContain("compare_at_price_vnd");
    expect(worker).toContain("compare_at_price_vnd AS compareAtPriceVnd");
    expect(worker).toContain("compare_at_price_vnd = excluded.compare_at_price_vnd");
    expect(worker).not.toContain("base_price_vnd = excluded.compare_at_price_vnd");
  });

  it("nối đầy đủ Admin và storefront card/detail với CSS riêng", () => {
    const admin = readFileSync("app/components/combo-admin-pages.tsx", "utf8");
    const card = readFileSync("app/components/ui.tsx", "utf8");
    const detail = readFileSync("app/components/public-pages.tsx", "utf8");
    const css = readFileSync("app/combo.css", "utf8");
    expect(admin).toContain("Giá bán thực tế (₫) *");
    expect(admin).toContain("Giá gốc / giá so sánh (₫)");
    expect(card).toContain("product.comboConfig?.compareAtPriceVnd");
    expect(detail).toContain("config.compareAtPriceVnd");
    expect(detail).toContain("compareUnitPrice > unitPrice");
    expect(css).toContain(".combo-price-values");
    expect(css).toContain(".combo-price-fields");
  });
});
