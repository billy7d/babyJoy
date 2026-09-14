import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  canonicalVariantIds,
  findVariantInProducts,
  getVariantAvailableQuantity,
  isVariantPurchasable,
  type Product,
} from "./catalog";
import { useCatalog } from "./catalog-context";
import {
  comboLineId,
  validateComboSelection,
  type ComboSelection,
} from "../../shared/combos";

export type CartLine = {
  variantId: string;
  quantity: number;
  lineType?: "STANDARD" | "COMBO";
  comboProductId?: string;
  comboVersion?: number;
  comboSelection?: ComboSelection;
  // Snapshot nhẹ giúp hiển thị rõ dòng cũ nếu variant bị gỡ khỏi catalog.
  productId?: string;
  productName?: string;
  variantName?: string;
  sku?: string;
  priceVnd?: number;
  imageKey?: string | null;
  imageUrl?: string;
};
type CartContextValue = {
  items: CartLine[];
  hydrated: boolean;
  totalQuantity: number;
  subtotalVnd: number;
  addItem: (variantId: string, quantity?: number, product?: Product) => void;
  addComboItem: (product: Product, selection: ComboSelection, quantity?: number) => void;
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

/** Tạo khóa ổn định để các lựa chọn Combo khác nhau không bị gộp nhầm trong giỏ. */
export function comboCartLineId(productId: string, selection: ComboSelection) {
  return comboLineId(productId, selection);
}

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
        && (line.imageKey === undefined || line.imageKey === null || typeof line.imageKey === "string")
        && (line.imageUrl === undefined || typeof line.imageUrl === "string")
        && (line.lineType === undefined || line.lineType === "STANDARD" || line.lineType === "COMBO")
        && (line.comboProductId === undefined || typeof line.comboProductId === "string")
        && (line.comboVersion === undefined || (Number.isSafeInteger(line.comboVersion) && Number(line.comboVersion) >= 1))
        && (line.comboSelection === undefined || (line.comboSelection !== null && typeof line.comboSelection === "object"))
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
    ? (() => {
        const image =
          found.variant.images?.find((item) => item.isPrimary) ??
          found.variant.images?.[0] ??
          found.product.images?.[0];
        return {
          variantId,
          quantity,
          productId: found.product.id,
          productName: found.product.name,
          variantName: `${found.variant.name}${found.variant.packageSize ? ` · ${found.variant.packageSize}` : ""}`,
          sku: found.variant.sku,
          priceVnd: found.variant.priceVnd,
          imageKey: image?.r2Key ?? found.product.imageKey ?? null,
          imageUrl: image?.url ?? found.product.image,
        };
      })()
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

function findCartCombo(
  products: ReturnType<typeof useCatalog>["products"],
  line: CartLine,
  providedProduct?: Product,
) {
  const product = providedProduct?.productType === "COMBO"
    ? providedProduct
    : products.find((item) => item.id === line.comboProductId);
  if (!product || product.productType !== "COMBO" || !product.comboConfig)
    return undefined;
  const validation = validateComboSelection(product.comboConfig, line.comboSelection);
  return validation.ok && product.status === "AVAILABLE" ? { product, validation } : undefined;
}

function comboUnitPrice(product: Product, selection: ComboSelection) {
  const config = product.comboConfig;
  if (!config) return product.basePriceVnd ?? 0;
  const validation = validateComboSelection(config, selection);
  return Math.max(0, (product.basePriceVnd ?? 0) + validation.priceAdjustment);
}

function snapshotComboLine(
  product: Product,
  selection: ComboSelection,
  quantity: number,
): CartLine {
  const image = product.images?.[0];
  return {
    variantId: comboCartLineId(product.id, selection),
    lineType: "COMBO",
    comboProductId: product.id,
    comboVersion: product.comboConfig?.configVersion,
    comboSelection: selection,
    quantity,
    productId: product.id,
    productName: product.name,
    variantName: "Combo",
    priceVnd: comboUnitPrice(product, selection),
    imageKey: image?.r2Key ?? product.imageKey ?? null,
    imageUrl: image?.url ?? product.image,
  };
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
      if (item.lineType === "COMBO")
        return sum + (item.priceVnd ?? 0) * item.quantity;
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
      addComboItem(product, selection, quantity = 1) {
        if (product.productType !== "COMBO" || !product.comboConfig) return;
        if (!Number.isSafeInteger(quantity) || quantity < 1) return;
        const validation = validateComboSelection(product.comboConfig, selection);
        if (!validation.ok || product.status !== "AVAILABLE") return;
        const amount = Math.min(99, quantity);
        const lineId = comboCartLineId(product.id, selection);
        setItems((current) => {
          const existing = current.find((item) => item.variantId === lineId);
          const nextQuantity = Math.min(99, (existing?.quantity ?? 0) + amount);
          if (existing)
            return persist(
              current.map((item) =>
                item.variantId === lineId
                  ? { ...item, quantity: nextQuantity }
                  : item,
              ),
            );
          return persist([...current, snapshotComboLine(product, selection, amount)]);
        });
      },
      incrementItem(variantId, providedProduct) {
        const existingLine = items.find((item) => item.variantId === variantId);
        if (existingLine?.lineType === "COMBO") {
          const combo = findCartCombo(products, existingLine, providedProduct);
          if (!combo) return;
          setItems((current) =>
            persist(
              current.map((item) =>
                item.variantId === variantId
                  ? { ...item, quantity: Math.min(99, item.quantity + 1) }
                  : item,
              ),
            ),
          );
          return;
        }
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
