import { useEffect, useMemo, useState } from "react";

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

export type CartPromotionResult = {
  success: true;
  subtotalVnd: number;
  discountTotalVnd: number;
  finalTotalVnd: number;
  totalQuantity: number;
  items: CartPromotionItem[];
  gifts: CartPromotionGift[];
  appliedPromotions: Array<{
    promotionId: string;
    promotionName: string;
    type: string;
    discountAmountVnd: number;
    giftUnavailable: boolean;
  }>;
  progress: Array<{
    promotionId: string;
    promotionName: string;
    type: string;
    priority: number;
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
  items: Array<{ variantId: string; quantity: number }>,
  hydrated: boolean,
) {
  const requestItems = useMemo(
    () => items.map(({ variantId, quantity }) => ({ variantId, quantity })),
    [items],
  );
  const signature = useMemo(() => JSON.stringify(requestItems), [requestItems]);
  const [data, setData] = useState<CartPromotionResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!hydrated) return;
    if (!requestItems.length) {
      setData(null);
      setLoading(false);
      setError("");
      return;
    }
    const controller = new AbortController();
    setData(null);
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
        if (!controller.signal.aborted) setData(body);
      })
      .catch((caught) => {
        if (!controller.signal.aborted)
          setError(
            caught instanceof Error
              ? caught.message
              : "Chưa thể kiểm tra khuyến mãi.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [hydrated, requestItems, signature]);

  return { data, loading, error };
}
