import { describe, expect, it } from "vitest";
import {
  assertSmokeResult,
  PRODUCTION_CASES,
  parseSmokeCases,
  validateAccessUrl,
} from "../scripts/production-financial-smoke.mjs";

describe("production financial smoke fixture", () => {
  it("chỉ nhận access URL production và bốn case item canonical", () => {
    expect(validateAccessUrl("https://metraphuong.com/access/test-credential").pathname).toBe(
      "/access/test-credential",
    );
    expect(parseSmokeCases(JSON.stringify({
      noPromo: [{ variantId: "v1", quantity: 1 }],
      realized: [{ variantId: "v2", quantity: 1 }],
      giftOnly: [{ variantId: "v3", quantity: 1 }],
      freeShipping: [{ variantId: "v4", quantity: 1 }],
    }))).toMatchObject({ noPromo: [{ variantId: "v1", quantity: 1 }] });
    expect(() => validateAccessUrl("https://example.com/access/test")).toThrow();
  });

  it("cho phép production dùng đúng hai fixture thật và không bỏ qua bộ isolated đầy đủ", () => {
    expect(PRODUCTION_CASES).toEqual(["noPromo", "freeShipping"]);
    const productionCases = JSON.stringify({
      noPromo: [{ variantId: "real-no-promo", quantity: 1 }],
      freeShipping: [{ variantId: "real-free-shipping", quantity: 2 }],
    });
    expect(parseSmokeCases(productionCases, PRODUCTION_CASES)).toMatchObject({
      noPromo: [{ variantId: "real-no-promo", quantity: 1 }],
      freeShipping: [{ variantId: "real-free-shipping", quantity: 2 }],
    });
    expect(() => parseSmokeCases(productionCases)).toThrow();
  });

  it("kiểm tra invariant total và các trạng thái financial không nhận số tiền fixture", () => {
    expect(assertSmokeResult("noPromo", {
      subtotalVnd: 100_000,
      discountTotalVnd: 0,
      shippingFeeVnd: 15_000,
      finalTotalVnd: 115_000,
      hasRealizedPromotion: false,
      appliedPromotions: [],
      gifts: [],
    })).toMatchObject({ shipping: 15_000, finalTotal: 115_000 });
    expect(assertSmokeResult("giftOnly", {
      subtotalVnd: 100_000,
      discountTotalVnd: 0,
      shippingFeeVnd: 0,
      finalTotalVnd: 100_000,
      hasRealizedPromotion: true,
      appliedPromotions: [],
      gifts: [{ productId: "gift", variantId: "gift-v", quantity: 1 }],
    })).toMatchObject({ shipping: 0, finalTotal: 100_000 });
    expect(() => parseSmokeCases(JSON.stringify({
      noPromo: [{ variantId: "v1", quantity: 1, displayedPrice: 1 }],
      realized: [{ variantId: "v2", quantity: 1 }],
      giftOnly: [{ variantId: "v3", quantity: 1 }],
      freeShipping: [{ variantId: "v4", quantity: 1 }],
    }))).not.toThrow();
    expect(() => assertSmokeResult("noPromo", {
      subtotalVnd: 100_000,
      discountTotalVnd: 0,
      shippingFeeVnd: 0,
      finalTotalVnd: 100_000,
      hasRealizedPromotion: false,
      appliedPromotions: [],
      gifts: [],
    })).toThrow();
  });
});
