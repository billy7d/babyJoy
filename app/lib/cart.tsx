import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { canonicalVariantIds, findVariant } from "./catalog";

export type CartLine = { variantId: string; quantity: number };
type CartContextValue = {
  items: CartLine[];
  totalQuantity: number;
  subtotalVnd: number;
  addItem: (variantId: string, quantity?: number) => void;
  setQuantity: (variantId: string, quantity: number) => void;
  removeItem: (variantId: string) => void;
  clear: () => void;
  resetDemoCart: () => void;
};

const storageKey = "babyjoy.cart.v1";
const demoCart: CartLine[] = canonicalVariantIds.map((variantId, index) => ({ variantId, quantity: index === 0 ? 2 : 1 }));
const CartContext = createContext<CartContextValue | null>(null);

function readCart(): CartLine[] {
  if (typeof window === "undefined") return demoCart;
  const raw = window.localStorage.getItem(storageKey);
  if (!raw) return demoCart;
  try {
    const parsed = JSON.parse(raw) as { items?: CartLine[] };
    return Array.isArray(parsed.items) ? parsed.items : demoCart;
  } catch {
    return demoCart;
  }
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartLine[]>(demoCart);

  useEffect(() => setItems(readCart()), []);

  const persist = (next: CartLine[]) => {
    if (typeof window !== "undefined") window.localStorage.setItem(storageKey, JSON.stringify({ items: next }));
    return next;
  };

  const value = useMemo<CartContextValue>(() => {
    const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
    const subtotalVnd = items.reduce((sum, item) => {
      const match = findVariant(item.variantId);
      return sum + (match?.variant.priceVnd ?? 0) * item.quantity;
    }, 0);
    return {
      items,
      totalQuantity,
      subtotalVnd,
      addItem(variantId, quantity = 1) {
        setItems((current) => {
          const existing = current.find((item) => item.variantId === variantId);
          if (existing) return persist(current.map((item) => item.variantId === variantId ? { ...item, quantity: Math.min(99, item.quantity + quantity) } : item));
          return persist([...current, { variantId, quantity: Math.min(99, quantity) }]);
        });
      },
      setQuantity(variantId, quantity) {
        if (quantity <= 0) setItems((current) => persist(current.filter((item) => item.variantId !== variantId)));
        else setItems((current) => persist(current.map((item) => item.variantId === variantId ? { ...item, quantity: Math.min(99, quantity) } : item)));
      },
      removeItem(variantId) {
        setItems((current) => persist(current.filter((item) => item.variantId !== variantId)));
      },
      clear() { setItems(persist([])); },
      resetDemoCart() { setItems(persist(demoCart)); },
    };
  }, [items]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error("useCart phải được dùng bên trong CartProvider");
  return context;
}
