import { describe, expect, it } from "vitest";
import {
  evaluatePromotions,
  roundPercentage,
  validatePromotionInput,
  type PromotionDefinition,
  type PromotionType,
} from "../shared/promotions";

const now = "2026-09-10T00:00:00.000Z";

function promotion(
  type: PromotionType,
  config: Record<string, unknown>,
  overrides: Partial<PromotionDefinition> = {},
) {
  const validated = validatePromotionInput({
    name: overrides.name ?? type,
    description: "",
    type,
    status: overrides.status ?? "ACTIVE",
    priority: overrides.priority ?? 0,
    stackable: overrides.stackable ?? false,
    startsAt: overrides.startsAt,
    endsAt: overrides.endsAt,
    usageLimitTotal: overrides.usageLimitTotal,
    usageLimitPerCustomer: overrides.usageLimitPerCustomer,
    config: { type, ...config },
  });
  return {
    id: overrides.id ?? type,
    createdAt: overrides.createdAt ?? "2026-08-01T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-08-01T00:00:00.000Z",
    usageCountTotal: overrides.usageCountTotal ?? 0,
    archivedAt: overrides.archivedAt ?? null,
    deletedAt: overrides.deletedAt ?? null,
    ...validated,
  } satisfies PromotionDefinition;
}

function line(
  productId: string,
  priceVnd: number,
  quantity = 1,
  categoryIds: string[] = [],
) {
  return {
    productId,
    variantId: `${productId}-variant`,
    productName: productId,
    variantName: "Loại chuẩn",
    sku: null,
    imageKey: null,
    priceVnd,
    quantity,
    categoryIds,
  };
}

function giftCatalog(productId: string, available = true) {
  return [
    {
      productId,
      productName: productId,
      variantId: `${productId}-gift-variant`,
      variantName: "Hộp quà",
      sku: "GIFT",
      imageKey: null,
      priceVnd: 10000,
      availability: available ? "AVAILABLE" : "OUT_OF_STOCK",
      productStatus: available ? "AVAILABLE" : "HIDDEN",
    },
  ];
}

describe("Promotion Engine P0 + P1", () => {
  it("áp dụng fixed discount đúng ở ba biên threshold", () => {
    const fixed = promotion("ORDER_FIXED_DISCOUNT", {
      minimumSubtotal: 500000,
      discountAmount: 30000,
    });
    expect(evaluatePromotions({ cart: [line("a", 499999)], promotions: [fixed], now }).discountTotalVnd).toBe(0);
    expect(evaluatePromotions({ cart: [line("a", 500000)], promotions: [fixed], now }).discountTotalVnd).toBe(30000);
    expect(evaluatePromotions({ cart: [line("a", 500001)], promotions: [fixed], now }).discountTotalVnd).toBe(30000);
  });

  it("tính percentage integer rounding và maximum discount", () => {
    const percentage = promotion("ORDER_PERCENTAGE_DISCOUNT", {
      minimumSubtotal: 100000,
      percentage: 10,
      maximumDiscount: 80000,
    });
    expect(evaluatePromotions({ cart: [line("a", 99999)], promotions: [percentage], now }).discountTotalVnd).toBe(0);
    expect(evaluatePromotions({ cart: [line("a", 299999)], promotions: [percentage], now }).discountTotalVnd).toBe(30000);
    expect(evaluatePromotions({ cart: [line("a", 1000000)], promotions: [percentage], now }).discountTotalVnd).toBe(80000);
    expect(roundPercentage(5, 10)).toBe(1);
    expect(roundPercentage(4, 10)).toBe(0);
  });

  it("tạo và loại quà theo threshold, không thêm quà hết hàng", () => {
    const gift = promotion("ORDER_GIFT", {
      minimumSubtotal: 500000,
      giftProductId: "gift",
      giftQuantity: 1,
    });
    const below = evaluatePromotions({ cart: [line("a", 499999)], promotions: [gift], catalog: giftCatalog("gift"), now });
    expect(below.gifts).toHaveLength(0);
    const eligible = evaluatePromotions({ cart: [line("a", 500000)], promotions: [gift], catalog: giftCatalog("gift"), now });
    expect(eligible.gifts[0]).toMatchObject({ isPromotionGift: true, quantity: 1, lineTotalVnd: 0, unitPriceVnd: 0 });
    const unavailable = evaluatePromotions({ cart: [line("a", 500000)], promotions: [gift], catalog: giftCatalog("gift", false), now });
    expect(unavailable.gifts).toHaveLength(0);
    expect(unavailable.appliedPromotions[0].giftUnavailable).toBe(true);
  });

  it("tính Mua X tặng Y, gồm A = B và lặp theo bội số", () => {
    const same = promotion("BUY_X_GET_Y", {
      triggerProductId: "a",
      requiredQuantity: 3,
      rewardProductId: "a",
      rewardQuantity: 1,
      allowRepeatedApplications: false,
    });
    expect(evaluatePromotions({ cart: [line("a", 100000, 2)], promotions: [same], catalog: giftCatalog("a"), now }).gifts).toHaveLength(0);
    expect(evaluatePromotions({ cart: [line("a", 100000, 3)], promotions: [same], catalog: giftCatalog("a"), now }).gifts[0].quantity).toBe(1);
    const repeated = promotion("BUY_X_GET_Y", {
      triggerProductId: "a",
      requiredQuantity: 3,
      rewardProductId: "b",
      rewardQuantity: 2,
      allowRepeatedApplications: true,
    });
    expect(evaluatePromotions({ cart: [line("a", 100000, 7)], promotions: [repeated], catalog: giftCatalog("b"), now }).gifts[0].quantity).toBe(4);
  });

  it("áp dụng theo product, category và quantity scope", () => {
    const productDiscount = promotion("PRODUCT_DISCOUNT", {
      productIds: ["a", "b"],
      reward: { kind: "FIXED", amount: 20000 },
    });
    const categoryDiscount = promotion("CATEGORY_DISCOUNT", {
      categoryIds: ["snack"],
      reward: { kind: "PERCENTAGE", percentage: 10 },
    }, { id: "category", priority: 5, stackable: true });
    const quantityDiscount = promotion("QUANTITY_DISCOUNT", {
      requiredQuantity: 2,
      scope: "SELECTED_CATEGORIES",
      categoryIds: ["snack"],
      reward: { kind: "FIXED", amount: 30000 },
    }, { id: "quantity", priority: 1, stackable: true });
    const result = evaluatePromotions({
      cart: [line("a", 100000, 2, ["snack"]), line("c", 100000, 1, ["other"])],
      promotions: [productDiscount, categoryDiscount, quantityDiscount],
      now,
    });
    expect(result.appliedPromotions.map((item) => item.promotionId)).toEqual(["category", "PRODUCT_DISCOUNT", "quantity"]);
    expect(result.discountTotalVnd).toBe(90000);
    expect(result.items.find((item) => item.productId === "c")?.discountAmountVnd).toBe(0);
  });

  it("chỉ áp dụng combo khi đủ tất cả item và hỗ trợ nhiều combo", () => {
    const combo = promotion("COMBO_DISCOUNT", {
      items: [
        { productId: "a", quantity: 1 },
        { productId: "b", quantity: 1 },
        { productId: "c", quantity: 1 },
      ],
      reward: { kind: "FIXED", amount: 40000 },
      allowRepeatedApplications: true,
    });
    expect(evaluatePromotions({ cart: [line("a", 100000), line("b", 100000)], promotions: [combo], now }).discountTotalVnd).toBe(0);
    expect(evaluatePromotions({ cart: [line("a", 100000, 2), line("b", 100000, 2), line("c", 100000, 2)], promotions: [combo], now }).discountTotalVnd).toBe(80000);
  });

  it("chọn đúng tier cao nhất và hiển thị tier tiếp theo", () => {
    const tiered = promotion("TIERED_DISCOUNT", {
      tiers: [
        { threshold: 300000, reward: { kind: "FIXED", amount: 10000 } },
        { threshold: 500000, reward: { kind: "FIXED", amount: 30000 } },
        { threshold: 1000000, reward: { kind: "FIXED", amount: 80000 } },
      ],
    });
    const result = evaluatePromotions({ cart: [line("a", 600000)], promotions: [tiered], now });
    expect(result.discountTotalVnd).toBe(30000);
    expect(result.appliedPromotions).toHaveLength(1);
    expect(result.progress[0]).toMatchObject({ remainingAmountVnd: 400000 });
    expect(evaluatePromotions({ cart: [line("a", 200000)], promotions: [tiered], now }).progress[0].remainingAmountVnd).toBe(100000);
  });

  it("resolve stacking tập trung theo priority rồi benefit", () => {
    const stackFixed = promotion("ORDER_FIXED_DISCOUNT", { minimumSubtotal: 1, discountAmount: 30000 }, { id: "stack", stackable: true });
    const stackProduct = promotion("PRODUCT_DISCOUNT", { productIds: ["a"], reward: { kind: "PERCENTAGE", percentage: 10 } }, { id: "stack-product", stackable: true, priority: 10 });
    const exclusiveLowSavingHighPriority = promotion("ORDER_FIXED_DISCOUNT", { minimumSubtotal: 1, discountAmount: 1000 }, { id: "exclusive-high", priority: 100, stackable: false });
    const exclusiveHigherSaving = promotion("ORDER_FIXED_DISCOUNT", { minimumSubtotal: 1, discountAmount: 50000 }, { id: "exclusive-saving", priority: 50, stackable: false });
    const result = evaluatePromotions({ cart: [line("a", 500000)], promotions: [stackFixed, stackProduct, exclusiveLowSavingHighPriority, exclusiveHigherSaving], now });
    expect(result.appliedPromotions.map((item) => item.promotionId)).toEqual(["stack-product", "exclusive-high", "stack"]);
    expect(result.discountTotalVnd).toBe(81000);
  });

  it("tôn trọng boundary thời gian, status và usage limit", () => {
    const scheduled = promotion("ORDER_FIXED_DISCOUNT", { minimumSubtotal: 1, discountAmount: 1 }, { startsAt: "2026-09-10T00:00:01.000Z" });
    const ended = promotion("ORDER_FIXED_DISCOUNT", { minimumSubtotal: 1, discountAmount: 1 }, { id: "ended", endsAt: now });
    const limited = promotion("ORDER_FIXED_DISCOUNT", { minimumSubtotal: 1, discountAmount: 1 }, { id: "limited", usageLimitTotal: 1, usageCountTotal: 1 });
    expect(evaluatePromotions({ cart: [line("a", 1)], promotions: [scheduled, ended, limited], now }).discountTotalVnd).toBe(0);
    const exactStart = { ...scheduled, startsAt: now };
    expect(evaluatePromotions({ cart: [line("a", 1)], promotions: [exactStart], now }).discountTotalVnd).toBe(1);
  });

  it("clamp tiền và discount, validate input server-side", () => {
    const tooLarge = promotion("ORDER_FIXED_DISCOUNT", { minimumSubtotal: 1, discountAmount: Number.MAX_SAFE_INTEGER }, { id: "large" });
    const result = evaluatePromotions({ cart: [line("a", 0)], promotions: [tooLarge], now });
    expect(result.finalTotalVnd).toBe(0);
    expect(result.items.every((item) => item.lineTotalVnd >= 0)).toBe(true);
    expect(() => validatePromotionInput({ name: "bad", type: "ORDER_FIXED_DISCOUNT", config: { minimumSubtotal: 0, discountAmount: 1 } })).toThrow();
    expect(() => validatePromotionInput({ name: "bad", type: "ORDER_PERCENTAGE_DISCOUNT", config: { minimumSubtotal: 1, percentage: 101 } })).toThrow();
    expect(() => validatePromotionInput({ name: "bad", type: "TIERED_DISCOUNT", config: { tiers: [{ threshold: 10, reward: { kind: "FIXED", amount: 1 } }, { threshold: 10, reward: { kind: "FIXED", amount: 2 } }] } })).toThrow();
  });
});
