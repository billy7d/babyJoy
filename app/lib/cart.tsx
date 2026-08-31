import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  canonicalVariantIds,
  findVariantInProducts,
  getVariantAvailableQuantity,
  isVariantPurchasable,
  type Product,
} from "./catalog";
import { useCatalog } from "./catalog-context";

export type CartLine = {
  variantId: string;
  quantity: number;
  // Snapshot nhẹ giúp hiển thị rõ dòng cũ nếu variant bị gỡ khỏi catalog.
  productId?: string;
  productName?: string;
  variantName?: string;
  sku?: string;
  priceVnd?: number;
};
type CartContextValue = {
  items: CartLine[];
  hydrated: boolean;
  totalQuantity: number;
  subtotalVnd: number;
  addItem: (variantId: string, quantity?: number, product?: Product) => void;
  incrementItem: (variantId: string, product?: Product) => void;
  decrementItem: (variantId: string) => void;
  setQuantity: (variantId: string, quantity: number) => void;
  removeItem: (variantId: string) => void;
  clear: () => void;
  resetDemoCart: () => void;
};

export const cartStorageKey = "babyjoy.cart.v1";
const demoCart: CartLine[] = canonicalVariantIds.map((variantId, index) => ({
  variantId,
  quantity: index === 0 ? 2 : 1,
}));
const CartContext = createContext<CartContextValue | null>(null);

export function changeCartItemQuantity(
  items: CartLine[],
  variantId: string,
  delta: number,
) {
  const existing = items.find((item) => item.variantId === variantId);
  if (!existing)
    return delta > 0 ? [...items, { variantId, quantity: Math.min(99, delta) }] : items;
  const quantity = Math.min(99, existing.quantity + delta);
  if (quantity <= 0) return items.filter((item) => item.variantId !== variantId);
  return items.map((item) =>
    item.variantId === variantId ? { ...item, quantity } : item,
  );
}

export function parseStoredCart(raw: string | null): CartLine[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { items?: unknown };
    if (!Array.isArray(parsed.items)) return [];
    const items = parsed.items.filter((item): item is CartLine => {
      if (!item || typeof item !== "object") return false;
      const line = item as Record<string, unknown>;
      return (
        typeof line.variantId === "string" &&
        line.variantId.trim().length > 0 &&
        Number.isInteger(line.quantity) &&
        Number(line.quantity) >= 1 &&
        Number(line.quantity) <= 99 &&
        (line.productId === undefined || typeof line.productId === "string") &&
        (line.productName === undefined || typeof line.productName === "string") &&
        (line.variantName === undefined || typeof line.variantName === "string") &&
        (line.sku === undefined || typeof line.sku === "string") &&
        (line.priceVnd === undefined || (typeof line.priceVnd === "number" && Number.isSafeInteger(line.priceVnd) && line.priceVnd >= 0))
      );
    });
    return items.length === parsed.items.length ? items : [];
  } catch {
    return [];
  }
}

function readCart(): CartLine[] {
  if (typeof window === "undefined") return [];
  return parseStoredCart(window.localStorage.getItem(cartStorageKey));
}

function snapshotCartLine(
  variantId: string,
  quantity: number,
  products: ReturnType<typeof useCatalog>["products"],
  providedProduct?: Product,
): CartLine {
  const found =
    providedProduct?.variants
      .map((variant) => ({ product: providedProduct, variant }))
      .find(({ variant }) => variant.id === variantId) ??
    findVariantInProducts(products, variantId);
  return found
    ? {
        variantId,
        quantity,
        productId: found.product.id,
        productName: found.product.name,
        variantName: found.variant.name,
        sku: found.variant.sku,
        priceVnd: found.variant.priceVnd,
      }
    : { variantId, quantity };
}

function findCartVariant(
  products: ReturnType<typeof useCatalog>["products"],
  variantId: string,
  providedProduct?: Product,
) {
  return (
    providedProduct?.variants
      .map((variant) => ({ product: providedProduct, variant }))
      .find(({ variant }) => variant.id === variantId) ??
    findVariantInProducts(products, variantId)
  );
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartLine[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const { products } = useCatalog();

  useEffect(() => {
    setItems(readCart());
    setHydrated(true);
  }, []);

  const persist = (next: CartLine[]) => {
    if (typeof window !== "undefined")
      window.localStorage.setItem(cartStorageKey, JSON.stringify({ items: next }));
    return next;
  };

  const value = useMemo<CartContextValue>(() => {
    const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
    const subtotalVnd = items.reduce((sum, item) => {
      const match = findVariantInProducts(products, item.variantId);
      return sum + (match?.variant.priceVnd ?? item.priceVnd ?? 0) * item.quantity;
    }, 0);
    return {
      items,
      hydrated,
      totalQuantity,
      subtotalVnd,
      addItem(variantId, quantity = 1, providedProduct) {
        if (!Number.isSafeInteger(quantity) || quantity < 1) return;
        const match = findCartVariant(products, variantId, providedProduct);
        if (!match || !isVariantPurchasable(match.variant)) return;
        const available = getVariantAvailableQuantity(match.variant);
        const amount = Math.min(99, available ?? 99, quantity);
        if (amount < 1) return;
        setItems((current) => {
          const existing = current.find((item) => item.variantId === variantId);
          const nextQuantity = Math.min(
            available ?? 99,
            (existing?.quantity ?? 0) + amount,
            99,
          );
          if (existing)
            return persist(
              current.map((item) =>
                item.variantId === variantId
                  ? {
                      ...item,
                      quantity: nextQuantity,
                    }
                  : item,
              ),
            );
          return persist([
            ...current,
            snapshotCartLine(variantId, amount, products, providedProduct),
          ]);
        });
      },
      incrementItem(variantId, providedProduct) {
        const match = findCartVariant(products, variantId, providedProduct);
        if (!match || !isVariantPurchasable(match.variant)) return;
        setItems((current) => {
          const existing = current.find((item) => item.variantId === variantId);
          const available = getVariantAvailableQuantity(match.variant);
          if (existing && available !== null && existing.quantity >= available) return current;
          const next = changeCartItemQuantity(current, variantId, 1);
          if (existing || next === current) return persist(next);
          return persist(
            next.map((item) =>
              item.variantId === variantId
                ? snapshotCartLine(
                    variantId,
                    item.quantity,
                    products,
                    providedProduct,
                  )
                : item,
            ),
          );
        });
      },
      decrementItem(variantId) {
        setItems((current) => persist(changeCartItemQuantity(current, variantId, -1)));
      },
      setQuantity(variantId, quantity) {
        if (!Number.isSafeInteger(quantity) || quantity <= 0)
          setItems((current) =>
            persist(current.filter((item) => item.variantId !== variantId)),
          );
        else
          setItems((current) => {
            const match = findVariantInProducts(products, variantId);
            const available = match
              ? getVariantAvailableQuantity(match.variant)
              : null;
            const nextQuantity = Math.min(99, quantity, available ?? 99);
            if (nextQuantity < 1)
              return persist(
                current.filter((item) => item.variantId !== variantId),
              );
            return persist(
              current.map((item) =>
                item.variantId === variantId
                  ? { ...item, quantity: nextQuantity }
                  : item,
              ),
            );
          });
      },
      removeItem(variantId) {
        setItems((current) =>
          persist(current.filter((item) => item.variantId !== variantId)),
        );
      },
      clear() {
        setItems(persist([]));
      },
      resetDemoCart() {
        setItems(persist(demoCart));
      },
    };
  }, [hydrated, items, products]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context)
    throw new Error("useCart phải được dùng bên trong CartProvider");
  return context;
}
