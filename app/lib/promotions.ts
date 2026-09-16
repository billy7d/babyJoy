import { useEffect, useMemo, useRef, useState } from "react";
import type { ComboSelection } from "../../shared/combos";

export type CartPromotionItem = {
  productId: string;
  variantId: string;
  productName: string;
  variantName: string;
  sku: string | null;
  imageKey: string | null;
  priceVnd: number;
  quantity: number;
  originalLineTotalVnd: number;
  discountAmountVnd: number;
  lineTotalVnd: number;
  lineType?: "STANDARD" | "COMBO";
  comboProductId?: string;
  comboVersion?: number;
  comboSelection?: ComboSelection;
};

export type CartPromotionGift = {
  promotionId: string;
  productId: string;
  variantId: string;
  productName: string;
  variantName: string;
  sku: string | null;
  imageKey: string | null;
  unitPriceVnd: 0;
  quantity: number;
  lineTotalVnd: 0;
  isPromotionGift: true;
};

export type CartAppliedPromotion = {
  promotionId: string;
  promotionName: string;
  type: string;
  discountAmountVnd: number;
  freeShipping: boolean;
  giftUnavailable: boolean;
};

// Chỉ nhận diện theo cờ benefit authoritative mà API trả về, không suy diễn từ tên hoặc type.
export const FREE_SHIPPING_PROMOTION_TYPE = "FREE_SHIPPING";

export function isFreeShippingPromotion(
  promotion: Pick<CartAppliedPromotion, "type"> & Partial<Pick<CartAppliedPromotion, "freeShipping">>,
) {
  // Chỉ cờ backend xác nhận mới được dùng để gắn nhãn Free Shipping; không suy diễn từ type legacy.
  return promotion.freeShipping === true;
}

export type CartPromotionResult = {
  success: true;
  subtotalVnd: number;
  discountTotalVnd: number;
  discountedSubtotalVnd: number;
  shippingFeeVnd: 0 | 15000;
  shippingStatus: "EMPTY_CART" | "STANDARD" | "WAIVED_BY_PROMOTION";
  hasRealizedPromotion: boolean;
  finalTotalVnd: number;
  freeShipping: boolean;
  totalQuantity: number;
  items: CartPromotionItem[];
  gifts: CartPromotionGift[];
  appliedPromotions: CartAppliedPromotion[];
  progress: Array<{
    promotionId: string;
    promotionName: string;
    type: string;
    priority: number;
    kind: "NEXT_UNLOCK" | "NEXT_TIER" | "NEXT_REPEAT";
    remainingAmountVnd?: number;
    remainingQuantity?: number;
    currentReward?: string;
    nextReward: string;
    message: string;
  }>;
};

type CartPromotionFailure = {
  error?: { message?: string };
};

export function useCartPromotionEvaluation(
  items: Array<{
    variantId: string;
    quantity: number;
    priceVnd?: number;
    lineType?: "STANDARD" | "COMBO";
    comboProductId?: string;
    comboVersion?: number;
    comboSelection?: ComboSelection;
  }>,
  hydrated: boolean,
) {
  const requestItems = useMemo(
    () =>
      items.map((item) =>
        item.lineType === "COMBO"
          ? {
              lineType: "COMBO" as const,
              comboProductId: item.comboProductId,
              comboVersion: item.comboVersion,
              selection: item.comboSelection,
              quantity: item.quantity,
              displayedPrice: item.priceVnd,
            }
          : {
              variantId: item.variantId,
              quantity: item.quantity,
              displayedPrice: item.priceVnd,
            },
      ),
    [items],
  );
  const signature = useMemo(() => JSON.stringify(requestItems), [requestItems]);
  const [data, setData] = useState<CartPromotionResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [quoteFingerprint, setQuoteFingerprint] = useState<string | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    if (!hydrated) return;
    const requestGeneration = generation.current + 1;
    generation.current = requestGeneration;
    if (!requestItems.length) {
      setData(null);
      setQuoteFingerprint(null);
      setLoading(false);
      setError("");
      return;
    }
    const controller = new AbortController();
    setData(null);
    setQuoteFingerprint(null);
    setLoading(true);
    setError("");
    void fetch("/api/cart/evaluate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: requestItems }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json()) as
          | CartPromotionResult
          | CartPromotionFailure;
        if (!response.ok || !("success" in body && body.success)) {
          throw new Error(
            ("error" in body ? body.error?.message : undefined) ||
              "Chưa thể kiểm tra khuyến mãi.",
          );
        }
        return body;
      })
      .then((body) => {
        if (!controller.signal.aborted && generation.current === requestGeneration) {
          setData(body);
          setQuoteFingerprint(signature);
        }
      })
      .catch((caught) => {
        if (!controller.signal.aborted && generation.current === requestGeneration)
          setError(
            caught instanceof Error
              ? caught.message
              : "Chưa thể kiểm tra khuyến mãi.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted && generation.current === requestGeneration) setLoading(false);
      });
    return () => {
      controller.abort();
    };
  }, [hydrated, requestItems, signature]);

  // Chỉ cho phép consumer dùng quote khi fingerprint hiện tại vẫn khớp request mới nhất.
  const quoteReady = Boolean(
    data &&
      quoteFingerprint === signature &&
      !loading &&
      !error,
  );
  return { data, loading, error, quoteFingerprint, quoteReady };
}
