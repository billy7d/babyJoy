import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  calculateComboSalePrice,
  getComboDisplayPrices,
  validateComboConfig,
  validateComboSelection,
  type ComboConfig,
} from "../shared/combos";
import { validateAdminComboConfigInput } from "../workers/combos";

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

function createAdminConfig(compareAtPriceVnd: unknown, includeCompare = true) {
  return {
    groupMode: "ALL_GROUPS",
    ...(includeCompare ? { compareAtPriceVnd } : {}),
    groups: [
      {
        id: "combo-group",
        name: "Món chính",
        description: "",
        selectionType: "CHOOSE",
        minSelect: 1,
        maxSelect: 1,
        items: [
          {
            id: "combo-item",
            variantId: "source-variant",
            fixedQuantity: 0,
            minQuantity: 1,
            maxQuantity: 1,
            priceAdjustment: 0,
          },
        ],
      },
    ],
  };
}

/** DB tối thiểu để kiểm tra validation config mà không tạo dữ liệu Combo thật. */
function createValidationEnv() {
  return {
    DB: {
      prepare() {
        return {
          bind() {
            return {
              all: async () => ({
                results: [{ id: "source-variant", productType: "STANDARD" }],
              }),
            };
          },
        };
      },
    },
  } as unknown as Env;
}

describe("Combo compare pricing", () => {
  it("giữ cùng contract validation với giá so sánh của Variant", () => {
    expect(validateComboConfig(createConfig(null)).ok).toBe(true);
    expect(validateComboConfig(createConfig(150_000)).ok).toBe(true);
    expect(validateComboConfig(createConfig(0)).ok).toBe(true);
    expect(validateComboConfig(createConfig(-1)).ok).toBe(false);
    expect(validateComboConfig(createConfig(1.5)).ok).toBe(false);
  });

  it("render đúng rule compare và cộng adjustment cho cả hai giá", () => {
    expect(getComboDisplayPrices(199_000, null)).toEqual({
      salePriceVnd: 199_000,
      compareAtPriceVnd: null,
    });
    expect(getComboDisplayPrices(199_000, 249_000)).toEqual({
      salePriceVnd: 199_000,
      compareAtPriceVnd: 249_000,
    });
    expect(getComboDisplayPrices(199_000, 199_000).compareAtPriceVnd).toBeNull();
    expect(getComboDisplayPrices(199_000, 150_000).compareAtPriceVnd).toBeNull();
    expect(getComboDisplayPrices(199_000, 0).compareAtPriceVnd).toBeNull();
    expect(getComboDisplayPrices(199_000, 249_000, 20_000)).toEqual({
      salePriceVnd: 219_000,
      compareAtPriceVnd: 269_000,
    });
    expect(calculateComboSalePrice(199_000, 20_000)).toBe(219_000);
  });

  it("server normalize old payload và reject giá compare không hợp lệ", async () => {
    const env = createValidationEnv();
    const oldPayload = await validateAdminComboConfigInput(
      createAdminConfig(undefined, false),
      "combo-product",
      env,
    );
    expect(oldPayload.response).toBeNull();
    expect(oldPayload.config?.compareAtPriceVnd).toBeNull();

    const zeroPayload = await validateAdminComboConfigInput(
      createAdminConfig(0),
      "combo-product",
      env,
    );
    expect(zeroPayload.response).toBeNull();
    expect(zeroPayload.config?.compareAtPriceVnd).toBe(0);

    const stringPayload = await validateAdminComboConfigInput(
      createAdminConfig("249000"),
      "combo-product",
      env,
    );
    expect(stringPayload.response).toBeNull();
    expect(stringPayload.config?.compareAtPriceVnd).toBe(249_000);

    for (const invalidPrice of [-1, 1.5, "abc", true, Number.MAX_SAFE_INTEGER + 1]) {
      const invalid = await validateAdminComboConfigInput(
        createAdminConfig(invalidPrice),
        "combo-product",
        env,
      );
      expect(invalid.response?.status).toBe(422);
      expect(invalid.config).toBeNull();
    }
  });

  it("priceAdjustment thay đổi sale price authoritative qua selection", () => {
    const config = createConfig(249_000);
    const group = config.groups[0]!;
    group.selectionType = "CHOOSE";
    group.minSelect = 1;
    group.maxSelect = 1;
    group.items[0]!.fixedQuantity = 0;
    group.items[0]!.priceAdjustment = 20_000;
    const validation = validateComboSelection(config, {
      configVersion: 1,
      items: [{ groupItemId: "combo-item", variantId: "source-variant", quantity: 1 }],
    });
    expect(validation).toMatchObject({ ok: true, priceAdjustment: 20_000 });
    expect(getComboDisplayPrices(199_000, config.compareAtPriceVnd, validation.priceAdjustment)).toEqual({
      salePriceVnd: 219_000,
      compareAtPriceVnd: 269_000,
    });
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
    const cart = readFileSync("app/lib/cart.tsx", "utf8");
    const promotions = readFileSync("workers/promotions.ts", "utf8");
    const css = readFileSync("app/combo.css", "utf8");
    expect(admin).toContain("Giá bán thực tế (₫) *");
    expect(admin).toContain("Giá gốc / giá so sánh (₫)");
    expect(admin).toContain("Không bắt buộc. Khi giá này lớn hơn giá bán thực tế");
    expect(card).toContain("product.comboConfig?.compareAtPriceVnd");
    expect(detail).toContain("config.compareAtPriceVnd");
    expect(detail).toContain("compareUnitPrice > unitPrice");
    expect(cart).toContain("calculateComboSalePrice");
    expect(cart).not.toContain("compareAtPriceVnd");
    expect(promotions).toContain("calculateComboSalePrice");
    expect(promotions).not.toContain("compareAtPriceVnd");
    expect(css).toContain(".combo-price-values");
    expect(css).toContain(".combo-price-fields");
  });
});
