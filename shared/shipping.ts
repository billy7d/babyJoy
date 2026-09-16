import type { AppliedPromotion } from "./promotions";

/** Phí vận chuyển chuẩn do backend sở hữu, áp dụng một lần cho mỗi giỏ có hàng. */
export const STANDARD_SHIPPING_FEE_VND = 15_000;

/** Mã lỗi dùng khi Worker tương thích chạy trước migration snapshot phí. */
export const SHIPPING_PRICING_NOT_READY_CODE = "SHIPPING_PRICING_NOT_READY";
export const SHIPPING_PRICING_NOT_READY_MESSAGE =
  "Hệ thống đang hoàn tất cập nhật phí vận chuyển. Vui lòng thử lại sau.";

export type ShippingPricingWriteBlock = {
  code: typeof SHIPPING_PRICING_NOT_READY_CODE;
  message: typeof SHIPPING_PRICING_NOT_READY_MESSAGE;
  status: 503;
};

/**
 * Compatibility release chỉ cho phép ghi giá mới khi snapshot phí đã tồn tại.
 * Nhờ đó Worker chạy trước migration không thể ghi tổng thiếu phí ship.
 */
export function shippingPricingWriteBlock(
  hasShippingSchema: boolean,
  environment = "production",
): ShippingPricingWriteBlock | null {
  return environment === "development" || hasShippingSchema
    ? null
    : {
        code: SHIPPING_PRICING_NOT_READY_CODE,
        message: SHIPPING_PRICING_NOT_READY_MESSAGE,
        status: 503,
      };
}

export const shippingStatuses = [
  "EMPTY_CART",
  "STANDARD",
  "WAIVED_BY_PROMOTION",
] as const;

export type ShippingStatus = (typeof shippingStatuses)[number];

function isRealizedGift(gift: AppliedPromotion["giftItems"][number]) {
  return (
    gift.isPromotionGift === true &&
    typeof gift.productId === "string" &&
    gift.productId.length > 0 &&
    typeof gift.variantId === "string" &&
    gift.variantId.length > 0 &&
    Number.isSafeInteger(gift.quantity) &&
    gift.quantity > 0 &&
    (!gift.trackInventory ||
      (Number.isSafeInteger(gift.availableQuantity) &&
        (gift.availableQuantity as number) >= gift.quantity)) &&
    gift.unitPriceVnd === 0 &&
    gift.lineTotalVnd === 0
  );
}

/** Chỉ tính benefit đã thực sự xuất hiện sau khi engine resolve promotion. */
export function hasRealizedPromotion(
  appliedPromotions: readonly Pick<AppliedPromotion, "discountAmountVnd" | "freeShipping" | "giftItems">[],
) {
  return appliedPromotions.some(
    (promotion) =>
      (Number.isSafeInteger(promotion.discountAmountVnd) &&
        promotion.discountAmountVnd > 0) ||
      promotion.freeShipping === true ||
      promotion.giftItems.some(isRealizedGift),
  );
}

export type ShippingResolution = {
  shippingFeeVnd: 0 | typeof STANDARD_SHIPPING_FEE_VND;
  shippingStatus: ShippingStatus;
  hasRealizedPromotion: boolean;
};

export function resolveShipping(input: {
  hasPurchasedItems: boolean;
  appliedPromotions: readonly Pick<AppliedPromotion, "discountAmountVnd" | "freeShipping" | "giftItems">[];
}): ShippingResolution {
  if (!input.hasPurchasedItems)
    return {
      shippingFeeVnd: 0,
      shippingStatus: "EMPTY_CART",
      hasRealizedPromotion: false,
    };
  const realized = hasRealizedPromotion(input.appliedPromotions);
  return {
    shippingFeeVnd: realized ? 0 : STANDARD_SHIPPING_FEE_VND,
    shippingStatus: realized ? "WAIVED_BY_PROMOTION" : "STANDARD",
    hasRealizedPromotion: realized,
  };
}
