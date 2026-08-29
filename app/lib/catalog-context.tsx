import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { PRODUCT_IMAGE_PLACEHOLDER } from "../../shared/images";
import {
  categories as fallbackCategories,
  products as fallbackProducts,
  type Category,
  type Product,
  type ProductImageRecord,
  type Variant,
} from "./catalog";

type ApiProduct = {
  id: string;
  slug: string;
  name: string;
  brand?: string | null;
  shortDescription?: string;
  description?: string;
  status?: string;
  featured?: number | boolean;
  categorySlug?: string | null;
  tagNames?: string[];
  variants?: Variant[];
  images?: ProductImageRecord[];
};

type ApiCategory = { id: string; name: string; slug: string };
type CatalogContextValue = {
  products: Product[];
  categories: Category[];
  loading: boolean;
  refresh: () => Promise<void>;
};

const CatalogContext = createContext<CatalogContextValue | null>(null);

export function mapApiProduct(row: ApiProduct): Product {
  const fallback = fallbackProducts.find(
    (product) => product.id === row.id || product.slug === row.slug,
  );
  const images = Array.isArray(row.images)
    ? [...row.images].sort((a, b) => a.sortOrder - b.sortOrder)
    : [];
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    brand: row.brand ?? fallback?.brand ?? "",
    shortDescription: row.shortDescription ?? fallback?.shortDescription ?? "",
    description: row.description ?? fallback?.description ?? "",
    image: images[0]?.url ?? fallback?.image ?? PRODUCT_IMAGE_PLACEHOLDER,
    imageKey: images[0]?.r2Key ?? null,
    images,
    category: row.categorySlug ?? fallback?.category ?? "",
    age: fallback?.age ?? "6+ tháng",
    tags: row.tagNames?.length ? row.tagNames : (fallback?.tags ?? []),
    featured: Boolean(row.featured),
    variants:
      Array.isArray(row.variants) && row.variants.length
        ? row.variants
        : (fallback?.variants ?? []),
  };
}

function mapApiCategory(row: ApiCategory): Category {
  const fallback = fallbackCategories.find(
    (category) => category.id === row.id || category.slug === row.slug,
  );
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    image: fallback?.image ?? PRODUCT_IMAGE_PLACEHOLDER,
  };
}

export function CatalogProvider({ children }: { children: React.ReactNode }) {
  const [catalogProducts, setCatalogProducts] =
    useState<Product[]>(fallbackProducts);
  const [catalogCategories, setCatalogCategories] =
    useState<Category[]>(fallbackCategories);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    try {
      const [productsResponse, categoriesResponse] = await Promise.all([
        fetch("/api/products?limit=24", {
          headers: { accept: "application/json" },
        }),
        fetch("/api/categories", { headers: { accept: "application/json" } }),
      ]);
      if (!productsResponse.ok || !categoriesResponse.ok)
        throw new Error("CATALOG_LOAD_FAILED");
      const productsBody = (await productsResponse.json()) as {
        data?: ApiProduct[];
      };
      const categoriesBody = (await categoriesResponse.json()) as {
        data?: ApiCategory[];
      };
      if (Array.isArray(productsBody.data) && productsBody.data.length)
        setCatalogProducts(productsBody.data.map(mapApiProduct));
      if (Array.isArray(categoriesBody.data) && categoriesBody.data.length)
        setCatalogCategories(categoriesBody.data.map(mapApiCategory));
    } catch {
      // Giữ catalog tĩnh làm fallback tạm thời cho tới khi D1/product_images được backfill đầy đủ.
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);
  const value = useMemo(
    () => ({
      products: catalogProducts,
      categories: catalogCategories,
      loading,
      refresh,
    }),
    [catalogProducts, catalogCategories, loading],
  );
  return (
    <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>
  );
}

export function useCatalog() {
  const context = useContext(CatalogContext);
  if (!context)
    throw new Error("useCatalog phải được dùng bên trong CatalogProvider");
  return context;
}
