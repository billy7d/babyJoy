import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { getPublicImageUrl, PRODUCT_IMAGE_PLACEHOLDER } from "../../shared/images";
import type { PaginatedResponse, PaginationMeta } from "../../shared/pagination";
import {
  categories as fallbackCategories,
  products as fallbackProducts,
  type Category,
  type Brand,
  type Product,
  type ProductImageRecord,
  type Variant,
} from "./catalog";

export type ApiProduct = {
  id: string;
  slug: string;
  name: string;
  brand?: string | null;
  brandId?: string | null;
  brandSlug?: string | null;
  minAgeMonths?: number | null;
  isBestSeller?: number | boolean;
  bestSellerRank?: number | null;
  archivedAt?: string | null;
  shortDescription?: string;
  description?: string;
  status?: string;
  featured?: number | boolean;
  categorySlug?: string | null;
  categoryIds?: string[];
  categorySlugs?: string[];
  tagNames?: string[];
  tagSlugs?: string[];
  variants?: Variant[];
  images?: ProductImageRecord[];
};

type ApiCategory = {
  id: string;
  name: string;
  slug: string;
  description?: string;
  imageKey?: string | null;
  sortOrder?: number;
  isActive?: number | boolean;
  productCount?: number;
};
type ApiBrand = {
  id: string;
  name: string;
  slug: string;
  sortOrder?: number;
  isActive?: number | boolean;
};
type ApiTag = {
  id: string;
  name: string;
  slug: string;
  groupType?: string | null;
  sortOrder?: number;
  isActive?: number | boolean;
};
export type CatalogTag = { name: string; slug: string };

type CatalogLoadResult = {
  products: Product[];
  categories: Category[];
  brands: Brand[];
  tags: string[];
  tagOptions: CatalogTag[];
};
export type ProductPageResult = {
  products: Product[];
  pagination: PaginationMeta;
};
type CatalogFetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;
type AccessRedirect = (path: string) => void;
type CatalogContextValue = {
  products: Product[];
  categories: Category[];
  brands: Brand[];
  tags: string[];
  tagOptions: CatalogTag[];
  loading: boolean;
  refresh: () => Promise<void>;
  mergeProducts: (products: Product[]) => void;
};

// Giữ bộ lọc tĩnh khi chạy offline; khi API trả về mảng rỗng thì phải tin dữ liệu D1.
const fallbackTagNames = [
  "Hữu cơ",
  "Không chứa sữa",
  "Không thêm đường",
  "Không biến đổi gen",
];
const fallbackTagOptions: CatalogTag[] = [
  { name: "Hữu cơ", slug: "huu-co" },
  { name: "Không chứa sữa", slug: "khong-chua-sua" },
  { name: "Không thêm đường", slug: "khong-them-duong" },
  { name: "Không biến đổi gen", slug: "khong-bien-doi-gen" },
];

const CatalogContext = createContext<CatalogContextValue | null>(null);

export function mapApiProduct(row: ApiProduct): Product {
  const fallback = fallbackProducts.find(
    (product) => product.id === row.id || product.slug === row.slug,
  );
  const apiCategories = Array.isArray(row.categorySlugs)
    ? row.categorySlugs
    : row.categorySlug !== undefined
      ? [row.categorySlug].filter((slug): slug is string => Boolean(slug))
      : null;
  const mappedCategories =
    apiCategories ??
    fallback?.categories ??
    [fallback?.category ?? ""].filter(Boolean);
  const images = Array.isArray(row.images)
    ? [...row.images].sort((a, b) => a.sortOrder - b.sortOrder)
    : [];
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    brand: row.brand ?? fallback?.brand ?? "",
    brandId: row.brandId ?? null,
    brandSlug: row.brandSlug ?? null,
    shortDescription: row.shortDescription ?? fallback?.shortDescription ?? "",
    description: row.description ?? fallback?.description ?? "",
    image: images[0]?.url ?? fallback?.image ?? PRODUCT_IMAGE_PLACEHOLDER,
    imageKey: images[0]?.r2Key ?? null,
    images,
    category:
      apiCategories !== null
        ? apiCategories[0] ?? ""
        : row.categorySlug ?? fallback?.category ?? "",
    categories: mappedCategories,
    categoryIds: row.categoryIds ?? [],
    minAgeMonths: row.minAgeMonths ?? null,
    age:
      row.minAgeMonths === null || row.minAgeMonths === undefined
        ? (fallback?.age ?? "Chưa xác định")
        : `${row.minAgeMonths}+ tháng`,
    isBestSeller: Boolean(row.isBestSeller),
    bestSellerRank: row.bestSellerRank ?? null,
    archivedAt: row.archivedAt ?? null,
    // Mảng rỗng từ API nghĩa là taxonomy đã bị xóa, không được khôi phục fallback cũ.
    tags: Array.isArray(row.tagNames) ? row.tagNames : (fallback?.tags ?? []),
    tagSlugs: Array.isArray(row.tagSlugs) ? row.tagSlugs : (fallback?.tagSlugs ?? []),
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
    image: row.imageKey
      ? getPublicImageUrl(row.imageKey)
      : (fallback?.image ?? PRODUCT_IMAGE_PLACEHOLDER),
    description: row.description ?? "",
    sortOrder: row.sortOrder ?? 0,
    isActive: row.isActive === undefined ? true : Boolean(row.isActive),
    productCount: row.productCount ?? 0,
  };
}

const productQueryKeys = [
  "q",
  "category",
  "brand",
  "age",
  "bestSeller",
  "tag",
  "available",
  "sort",
] as const;

export function buildProductListUrl(
  params: URLSearchParams,
  forcedCategory?: string,
) {
  const query = new URLSearchParams();
  query.set("page", params.get("page") ?? "1");
  query.set("limit", "24");
  for (const key of productQueryKeys) {
    if (key === "category" && forcedCategory) {
      query.set(key, forcedCategory);
      continue;
    }
    const value = params.get(key);
    if (value) query.set(key, value);
  }
  return `/api/products?${query.toString()}`;
}

function isPaginationMeta(value: unknown): value is PaginationMeta {
  if (!value || typeof value !== "object") return false;
  const pagination = value as Record<string, unknown>;
  return (
    Number.isSafeInteger(pagination.page) &&
    Number.isSafeInteger(pagination.limit) &&
    Number.isSafeInteger(pagination.totalItems) &&
    Number.isSafeInteger(pagination.totalPages) &&
    typeof pagination.hasPrevious === "boolean" &&
    typeof pagination.hasNext === "boolean"
  );
}

function redirectForCatalogAccess(
  response: Response,
  onAccessRequired?: AccessRedirect,
) {
  if (response.status !== 401 && response.status !== 503) return;
  const redirect =
    onAccessRequired ??
    ((path: string) => {
      if (typeof window !== "undefined") window.location.assign(path);
    });
  redirect("/access-required");
}

export async function loadProductPage(
  params: URLSearchParams,
  forcedCategory?: string,
  fetcher: CatalogFetcher = fetch,
  onAccessRequired?: AccessRedirect,
): Promise<ProductPageResult> {
  const response = await fetcher(buildProductListUrl(params, forcedCategory), {
    headers: { accept: "application/json" },
  });
  redirectForCatalogAccess(response, onAccessRequired);
  if (!response.ok) throw new Error("PRODUCT_LIST_LOAD_FAILED");
  const body = (await response.json()) as Partial<PaginatedResponse<ApiProduct>>;
  if (!Array.isArray(body.data) || !isPaginationMeta(body.pagination))
    throw new Error("PRODUCT_LIST_INVALID_RESPONSE");
  return {
    products: body.data.map(mapApiProduct),
    pagination: body.pagination,
  };
}

export class ProductNotFoundError extends Error {
  constructor() {
    super("PRODUCT_NOT_FOUND");
    this.name = "ProductNotFoundError";
  }
}

export async function loadProductBySlug(
  slug: string,
  fetcher: CatalogFetcher = fetch,
  onAccessRequired?: AccessRedirect,
) {
  const response = await fetcher(`/api/products/${encodeURIComponent(slug)}`, {
    headers: { accept: "application/json" },
  });
  redirectForCatalogAccess(response, onAccessRequired);
  if (response.status === 404) throw new ProductNotFoundError();
  if (!response.ok) throw new Error("PRODUCT_DETAIL_LOAD_FAILED");
  const body = (await response.json()) as { data?: ApiProduct };
  if (!body.data || typeof body.data !== "object")
    throw new Error("PRODUCT_DETAIL_INVALID_RESPONSE");
  return mapApiProduct(body.data);
}

export async function loadCatalogData(
  fetcher: CatalogFetcher = fetch,
  onAccessRequired?: AccessRedirect,
): Promise<CatalogLoadResult> {
  const [productsResponse, categoriesResponse, brandsResponse, tagsResponse] =
    await Promise.all([
      fetcher("/api/products?limit=24", {
        headers: { accept: "application/json" },
      }),
      fetcher("/api/categories", { headers: { accept: "application/json" } }),
      fetcher("/api/brands", { headers: { accept: "application/json" } }),
      fetcher("/api/tags", { headers: { accept: "application/json" } }),
    ]);
  if (
    [productsResponse, categoriesResponse, brandsResponse, tagsResponse].some(
      (response) => response.status === 401 || response.status === 503,
    )
  ) {
    const redirect =
      onAccessRequired ??
      ((path: string) => {
        if (typeof window !== "undefined") window.location.assign(path);
      });
    redirect("/access-required");
  }
  if (
    !productsResponse.ok ||
    !categoriesResponse.ok ||
    !brandsResponse.ok ||
    !tagsResponse.ok
  )
    throw new Error("CATALOG_LOAD_FAILED");
  const productsBody = (await productsResponse.json()) as {
    data?: ApiProduct[];
  };
  const categoriesBody = (await categoriesResponse.json()) as {
    data?: ApiCategory[];
  };
  const brandsBody = (await brandsResponse.json()) as { data?: ApiBrand[] };
  const tagsBody = (await tagsResponse.json()) as { data?: ApiTag[] };
  if (
    !Array.isArray(productsBody.data) ||
    !Array.isArray(categoriesBody.data) ||
    !Array.isArray(brandsBody.data) ||
    !Array.isArray(tagsBody.data)
  )
    throw new Error("CATALOG_INVALID_RESPONSE");
  const tagOptions = tagsBody.data
    .map((tag) => ({ name: tag.name, slug: tag.slug }))
    .filter((tag) => Boolean(tag.name && tag.slug));
  // Chỉ commit toàn bộ snapshot khi bốn API đều thành công và trả đúng mảng dữ liệu.
  return {
    products: productsBody.data.map(mapApiProduct),
    categories: categoriesBody.data.map(mapApiCategory),
    brands: brandsBody.data.map((brand) => ({
      ...brand,
      isActive: brand.isActive === undefined ? true : Boolean(brand.isActive),
    })),
    tags: [...new Set(tagOptions.map((tag) => tag.name))],
    tagOptions,
  };
}

export function CatalogProvider({ children }: { children: React.ReactNode }) {
  const [catalogProducts, setCatalogProducts] =
    useState<Product[]>(fallbackProducts);
  const [catalogCategories, setCatalogCategories] =
    useState<Category[]>(fallbackCategories);
  const [catalogBrands, setCatalogBrands] = useState<Brand[]>([]);
  const [catalogTags, setCatalogTags] = useState<string[]>(fallbackTagNames);
  const [catalogTagOptions, setCatalogTagOptions] =
    useState<CatalogTag[]>(fallbackTagOptions);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const catalog = await loadCatalogData();
      setCatalogProducts(catalog.products);
      setCatalogCategories(catalog.categories);
      setCatalogBrands(catalog.brands);
      setCatalogTags(catalog.tags);
      setCatalogTagOptions(catalog.tagOptions);
    } catch {
      // Giữ catalog tĩnh làm fallback tạm thời cho tới khi D1/product_images được backfill đầy đủ.
    } finally {
      setLoading(false);
    }
  }, []);

  const mergeProducts = useCallback((nextProducts: Product[]) => {
    if (!nextProducts.length) return;
    setCatalogProducts((current) => {
      const byId = new Map(current.map((product) => [product.id, product]));
      nextProducts.forEach((product) => byId.set(product.id, product));
      return [...byId.values()];
    });
  }, []);

  useEffect(() => {
    void refresh();
  }, []);
  const value = useMemo(
    () => ({
      products: catalogProducts,
      categories: catalogCategories,
      brands: catalogBrands,
      tags: catalogTags,
      tagOptions: catalogTagOptions,
      loading,
      refresh,
      mergeProducts,
    }),
    [
      catalogProducts,
      catalogCategories,
      catalogBrands,
      catalogTags,
      catalogTagOptions,
      loading,
      refresh,
      mergeProducts,
    ],
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
