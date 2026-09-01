import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import {
  formatVnd,
  getDisplayVariant,
  type Brand,
  type Category,
  type Product,
  type ProductImageRecord,
} from "../lib/catalog";
import { getAdminProductStockOnHand } from "../lib/admin-product-stock";
import {
  DEFAULT_CHECKOUT_RESERVATION_MINUTES,
  MAX_CHECKOUT_RESERVATION_MINUTES,
  MIN_CHECKOUT_RESERVATION_MINUTES,
  formatReservationDuration,
} from "../../shared/reservation";
import { mapApiProduct } from "../lib/catalog-context";
import {
  createDraftVariant,
  mapVariantValidationIssue,
  toEditableVariant,
  validateEditableVariants,
  type EditableVariant,
  type VariantField,
  type VariantFieldErrors,
} from "../lib/product-variants";
import {
  getProductEditPath,
  ProductEditorSaveController,
  type ProductEditorSavePayload,
} from "../lib/product-editor-save";
import {
  AdminShell,
  Icon,
  Price,
  StatusBadge,
  Tag,
  useAdminCronHealth,
} from "./ui";
import { ProductImage } from "./product-image";
import {
  getPaginationItems,
  type PaginatedResponse,
  type PaginationMeta,
} from "../../shared/pagination";
import {
  CART_CHECKOUT_STATE_LABELS,
  CART_REQUEST_CHANNEL_LABELS,
  CART_REQUEST_SORT_OPTIONS,
  CART_REQUEST_STATUS_LABELS,
  MESSENGER_DELIVERY_STATUS_LABELS,
  buildAdminCartRequestApiUrl,
  buildAdminCartRequestUrl,
  emptyAdminCartRequestAdvancedFilters,
  formatAdminCartRequestFilterNumber,
  getAdminCartRequestDateRange,
  getAdminCartRequestFilterChips,
  parseAdminCartRequestFilterNumber,
  parseAdminCartRequestUrl,
  removeAdminCartRequestFilter,
  type AdminCartRequestAdvancedFilters,
  type AdminCartRequestDatePreset,
  type AdminCartRequestRow,
  type AdminCartRequestUrlState,
} from "../lib/admin-cart-requests";
import {
  CART_CHECKOUT_STATES,
  CART_REQUEST_CHANNELS,
  CART_REQUEST_STATUSES,
  MESSENGER_DELIVERY_STATUSES,
  type CartCheckoutState,
  type CartRequestChannel,
  type CartRequestStatus,
  type MessengerDeliveryStatus,
} from "../../shared/cart-requests";
import {
  type CronHealthData,
} from "../../shared/cron-health";
import {
  CRON_HEALTH_LABELS,
  formatCronHealthTimestamp,
} from "../lib/cron-health-ui";

type AdminProductStatus = "ALL" | "AVAILABLE" | "OUT_OF_STOCK" | "HIDDEN";
type AdminProductRow = Parameters<typeof mapApiProduct>[0] & { status?: string };
type AdminProduct = Product & { adminStatus: string };
type VariantErrors = Record<string, VariantFieldErrors>;
type AdminProductsResponse = Partial<PaginatedResponse<AdminProductRow>>;

function formatReservationRemaining(expiresAt: string | null | undefined, now = Date.now()) {
  if (!expiresAt) return "Chưa bắt đầu giữ hàng";
  const expires = Date.parse(expiresAt);
  if (!Number.isFinite(expires)) return "Không xác định thời hạn";
  const remainingMs = expires - now;
  if (remainingMs <= 0) return "Đã hết hạn";
  return `Còn ${formatReservationDuration(Math.max(1, Math.ceil(remainingMs / 60000)))}`;
}

export function mapAdminProductRow(row: AdminProductRow): AdminProduct {
  const product = mapApiProduct(row);
  const adminStatus =
    row.status ??
    (product.variants.some((variant) => variant.availability === "AVAILABLE")
      ? "AVAILABLE"
      : "OUT_OF_STOCK");
  return { ...product, adminStatus };
}

export function buildAdminProductsUrl(
  page: number,
  query: string,
  status: AdminProductStatus = "ALL",
) {
  const params = new URLSearchParams({ limit: "24", page: String(Math.max(1, page)) });
  if (query.trim()) params.set("q", query.trim());
  if (status !== "ALL") params.set("status", status);
  return `/api/admin/products?${params.toString()}`;
}

export function adminProductMatchesStatus(
  product: AdminProduct,
  filter: AdminProductStatus,
) {
  return filter === "ALL" || product.adminStatus === filter;
}

export function AdminProductsPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [statusFilter, setStatusFilter] = useState<AdminProductStatus>("ALL");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/admin/categories", {
      headers: { accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("ADMIN_CATEGORIES_LOAD_FAILED");
        return response.json() as Promise<{ data?: Category[] }>;
      })
      .then((body) => {
        if (!cancelled)
          setCategories(
            (body.data ?? []).map((category) => ({
              ...category,
              isActive: Boolean(category.isActive),
            })),
          );
      })
      .catch(() => {
        if (!cancelled) setCategories([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError("");
    setProducts([]);
    setPagination(null);
    void fetch(buildAdminProductsUrl(page, query, statusFilter), {
      headers: { accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("ADMIN_PRODUCTS_LOAD_FAILED");
        return response.json() as Promise<AdminProductsResponse>;
      })
      .then((body) => {
        if (cancelled) return;
        const rows = Array.isArray(body.data) ? body.data : [];
        if (!body.pagination) throw new Error("ADMIN_PRODUCTS_INVALID_RESPONSE");
        setProducts(rows.map(mapAdminProductRow));
        setPagination(body.pagination);
        if (body.pagination.page !== page) setPage(body.pagination.page);
      })
      .catch(() => {
        if (!cancelled) {
          setProducts([]);
          setPagination(null);
          setLoadError("Không tải được danh sách sản phẩm từ D1.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [page, query, statusFilter]);
  const statusTabs: Array<[AdminProductStatus, string]> = [
    ["ALL", "Tất cả"],
    ["AVAILABLE", "Đang bán"],
    ["OUT_OF_STOCK", "Hết hàng"],
    ["HIDDEN", "Đã ẩn"],
  ];
  return (
    <AdminShell title="Sản Phẩm">
      <div className="admin-page-heading">
        <div>
          <h1>Sản phẩm</h1>
          <p>Quản lý thực đơn ăn dặm cho bé</p>
        </div>
        <Link className="btn primary" to="/admin/products/new">
          <Icon>add</Icon> THÊM SẢN PHẨM
        </Link>
      </div>
      <section className="admin-table-card admin-products-table-card">
        <div className="admin-table-tools">
          <div className="admin-tabs">
            {statusTabs.map(([value, label]) => (
              <button
                key={value}
                className={statusFilter === value ? "active" : ""}
                onClick={() => {
                  setPage(1);
                  setStatusFilter(value);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="admin-search">
            <Icon>search</Icon>
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
              placeholder="Tìm kiếm sản phẩm..."
            />
          </label>
        </div>
        <div className="table-scroll">
          <table className="admin-products-table">
            <thead>
              <tr>
                <th>Ảnh</th>
                <th>Sản phẩm</th>
                <th>Danh mục</th>
                <th>Phân loại</th>
                <th className="admin-stock-header">Tồn kho</th>
                <th>Giá</th>
                <th>Trạng thái</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {products.length
                ? products.map((product) => {
                    const variant = getDisplayVariant(product);
                    const stockOnHand = getAdminProductStockOnHand(product);
                    return (
                      <tr key={product.id}>
                        <td>
                          <img className="table-thumb" src={product.image} alt="" />
                        </td>
                        <td>
                          <b>{product.name}</b>
                          <small>
                            {variant?.name ?? "Chưa có phân loại"}, {product.shortDescription}
                          </small>
                        </td>
                        <td>
                          <Tag tone="neutral">
                            {(product.categories ?? [product.category])
                              .map((slug) => categories.find((item) => item.slug === slug)?.name)
                              .filter(Boolean)
                              .join(", ") || "Chưa phân loại"}
                          </Tag>
                        </td>
                        <td>{product.variants.length} vị</td>
                        <td
                          className="admin-stock-cell"
                          title={stockOnHand === null ? "Không theo dõi tồn kho" : undefined}
                          aria-label={stockOnHand === null ? "Không theo dõi tồn kho" : undefined}
                        >
                          {stockOnHand === null ? "—" : stockOnHand.toLocaleString("vi-VN")}
                        </td>
                        <td>
                          <Price value={variant?.priceVnd ?? 0} />
                        </td>
                        <td>
                          <StatusBadge status={product.adminStatus} />
                        </td>
                        <td>
                          <div className="row-actions">
                            <Link
                              to={`/admin/products/${product.id}/edit`}
                              aria-label="Sửa"
                            >
                              <Icon>edit</Icon>
                            </Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                : !loading && !loadError && (
                    <tr>
                      <td colSpan={8}>
                        <div className="empty-state">
                          <Icon>inventory_2</Icon>
                          <h2>
                            {pagination?.totalItems
                              ? "Không có sản phẩm phù hợp"
                              : "Chưa có sản phẩm"}
                          </h2>
                          <p>
                            {pagination?.totalItems
                              ? "Hãy đổi bộ lọc hoặc từ khóa tìm kiếm."
                              : "Thêm sản phẩm thật đầu tiên cho catalog BabyJoy."}
                          </p>
                        </div>
                      </td>
                    </tr>
                  )}
            </tbody>
          </table>
        </div>
        {loading ? (
          <p className="table-footer">Đang tải danh sách sản phẩm…</p>
        ) : loadError ? (
          <p className="table-footer">{loadError}</p>
        ) : (
          <TableFooter
            pagination={pagination}
            onPageChange={setPage}
          />
        )}
      </section>
    </AdminShell>
  );
}

function TableFooter({
  pagination,
  onPageChange,
  text,
  itemLabel = "sản phẩm",
  emptyText,
}: {
  pagination?: PaginationMeta | null;
  onPageChange?: (page: number) => void;
  text?: string;
  itemLabel?: string;
  emptyText?: string;
}) {
  const page = pagination?.page ?? 1;
  const totalItems = pagination?.totalItems ?? 0;
  const totalPages = pagination?.totalPages ?? 0;
  const start = totalItems === 0 ? 0 : (page - 1) * (pagination?.limit ?? 24) + 1;
  const end = totalItems === 0 ? 0 : Math.min(page * (pagination?.limit ?? 24), totalItems);
  return (
    <div className="table-footer">
      <span>
        {text ?? (totalItems === 0
          ? emptyText ?? `0 ${itemLabel}`
          : `Hiển thị ${start}–${end} trên ${totalItems} ${itemLabel}`)}
      </span>
      {pagination && onPageChange && totalPages > 1 && (
        <div>
          <button
            type="button"
            disabled={!pagination.hasPrevious}
            onClick={() => onPageChange(page - 1)}
            aria-label="Trang trước"
          >
            ‹
          </button>
          {getPaginationItems(page, totalPages).map((item, index) =>
            item === "ellipsis" ? (
              <span key={`ellipsis-${index}`} aria-hidden="true">
                …
              </span>
            ) : (
              <button
                type="button"
                key={item}
                className={item === page ? "active" : ""}
                aria-current={item === page ? "page" : undefined}
                aria-label={`Trang ${item}`}
                onClick={() => onPageChange(item)}
              >
                {item}
              </button>
            ),
          )}
          <button
            type="button"
            disabled={!pagination.hasNext}
            onClick={() => onPageChange(page + 1)}
            aria-label="Trang sau"
          >
            ›
          </button>
        </div>
      )}
    </div>
  );
}

export function ProductEditorPage() {
  const segments = useLocation().pathname.split("/").filter(Boolean);
  const id = segments.at(-1) === "edit" ? segments.at(-2) : undefined;
  const navigate = useNavigate();
  const [classificationCategories, setClassificationCategories] =
    useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [editing, setEditing] = useState<
    (Product & {
      categoryIds?: string[];
      tagIds?: string[];
      sortOrder?: number;
      status?: string;
      brandId?: string | null;
      minAgeMonths?: number | null;
      isBestSeller?: boolean | number;
      bestSellerRank?: number | null;
    }) | null
  >(null);
  const [images, setImages] = useState<ProductImageRecord[]>([]);
  const [variants, setVariants] = useState<EditableVariant[]>(() => [
    createDraftVariant(),
  ]);
  const [deletedVariantIds, setDeletedVariantIds] = useState<string[]>([]);
  const [variantErrors, setVariantErrors] = useState<VariantErrors>({});
  const [tags, setTags] = useState<Array<{ id: string; name: string }>>([]);
  const [featured, setFeatured] = useState(false);
  const [bestSeller, setBestSeller] = useState(false);
  const [visible, setVisible] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const saveControllerRef = useRef<ProductEditorSaveController | null>(null);
  const saveController =
    saveControllerRef.current ?? new ProductEditorSaveController(id);
  saveControllerRef.current = saveController;

  useEffect(() => {
    saveController.setProductId(id);
  }, [id, saveController]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!id) {
        setEditing(null);
        setVariants([createDraftVariant()]);
        setDeletedVariantIds([]);
        setVariantErrors({});
      }
      const requests: Promise<Response>[] = [
        fetch("/api/admin/tags"),
        fetch("/api/admin/categories"),
        fetch("/api/admin/brands"),
      ];
      if (id) requests.push(fetch(`/api/admin/products/${id}`));
      const [tagsResponse, categoriesResponse, brandsResponse, productResponse] =
        await Promise.all(requests);
      if (cancelled) return;
      if (tagsResponse.ok) {
        const body = (await tagsResponse.json()) as {
          data?: Array<{ id: string; name: string }>;
        };
        setTags(body.data ?? []);
      }
      if (categoriesResponse.ok) {
        const body = (await categoriesResponse.json()) as { data?: Category[] };
        setClassificationCategories(
          (body.data ?? []).map((category) => ({
            ...category,
            isActive: Boolean(category.isActive),
          })),
        );
      }
      if (brandsResponse.ok) {
        const body = (await brandsResponse.json()) as { data?: Brand[] };
        setBrands(
          (body.data ?? []).map((brand) => ({
            ...brand,
            isActive: Boolean(brand.isActive),
          })),
        );
      }
      if (id && productResponse?.ok) {
        const body = (await productResponse.json()) as { data: Product };
        const product = body.data as Product & {
          categoryIds?: string[];
          tagIds?: string[];
          sortOrder?: number;
          status?: string;
          brandId?: string | null;
          minAgeMonths?: number | null;
          isBestSeller?: boolean | number;
          bestSellerRank?: number | null;
        };
        setEditing(product);
        setVariants(product.variants.map(toEditableVariant));
        setDeletedVariantIds([]);
        setVariantErrors({});
        setImages(product.images ?? []);
        setFeatured(Boolean(product.featured));
        setBestSeller(Boolean(product.isBestSeller));
        setVisible(product.status !== "HIDDEN");
      } else if (id) {
        setMessage("Không tải được dữ liệu sản phẩm.");
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const uploadFiles = async (files: FileList | null, makePrimary: boolean) => {
    if (!files?.length) return;
    setUploading(true);
    setMessage("Đang tải ảnh lên R2...");
    try {
      const uploaded: ProductImageRecord[] = [];
      for (const file of Array.from(files)) {
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
          throw new Error("Chỉ hỗ trợ JPEG, PNG và WebP.");
        if (file.size > 5 * 1024 * 1024)
          throw new Error("Mỗi ảnh phải nhỏ hơn hoặc bằng 5MB.");
        const response = await fetch("/api/admin/images", {
          method: "POST",
          headers: { "content-type": file.type },
          body: file,
        });
        const body = (await response.json()) as {
          key?: string;
          url?: string;
          error?: { message?: string };
        };
        if (!response.ok || !body.key || !body.url)
          throw new Error(body.error?.message ?? "Tải ảnh lên R2 thất bại.");
        uploaded.push({
          r2Key: body.key,
          url: body.url,
          altText: editing?.name ?? "Ảnh sản phẩm BabyJoy",
          sortOrder: 0,
        });
      }
      setImages((current) =>
        (makePrimary ? [...uploaded, ...current] : [...current, ...uploaded]).map(
          (image, sortOrder) => ({ ...image, sortOrder }),
        ),
      );
      setMessage("Đã tải ảnh lên R2. Hãy lưu sản phẩm để gắn ảnh.");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Tải ảnh thất bại.");
    } finally {
      setUploading(false);
    }
  };

  const moveImage = (index: number, offset: number) => {
    setImages((current) => {
      const target = index + offset;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((image, sortOrder) => ({ ...image, sortOrder }));
    });
  };

  const makePrimary = (index: number) => {
    setImages((current) => {
      const next = [...current];
      const [selected] = next.splice(index, 1);
      next.unshift(selected);
      return next.map((image, sortOrder) => ({ ...image, sortOrder }));
    });
  };

  const updateVariant = (
    clientId: string,
    field: VariantField,
    value: string | boolean,
  ) => {
    setVariants((current) =>
      current.map((variant) =>
        variant.clientId === clientId ? { ...variant, [field]: value } : variant,
      ),
    );
    setVariantErrors((current) => {
      const row = current[clientId];
      if (!row || !row[field]) return current;
      const nextRow = { ...row };
      delete nextRow[field];
      const next = { ...current };
      if (Object.keys(nextRow).length) next[clientId] = nextRow;
      else delete next[clientId];
      return next;
    });
  };

  const addVariant = () => {
    setVariants((current) => [...current, createDraftVariant()]);
  };

  const deleteVariant = (variant: EditableVariant) => {
    setVariants((current) =>
      current.filter((item) => item.clientId !== variant.clientId),
    );
    setVariantErrors((current) => {
      if (!current[variant.clientId]) return current;
      const next = { ...current };
      delete next[variant.clientId];
      return next;
    });
    if (variant.id)
      setDeletedVariantIds((current) =>
        current.includes(variant.id!) ? current : [...current, variant.id!],
      );
  };

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const errors = validateEditableVariants(variants);
    if (!variants.length) {
      setMessage("Sản phẩm cần có ít nhất một phân loại.");
      setVariantErrors({});
      return;
    }
    if (Object.keys(errors).length) {
      setVariantErrors(errors);
      setMessage("Vui lòng kiểm tra thông tin các phân loại.");
      return;
    }
    setMessage("Đang lưu...");
    const form = new FormData(event.currentTarget);
    const payload: ProductEditorSavePayload = {
      name: form.get("name"),
      slug: form.get("slug"),
      brandId: form.get("brandId") || null,
      minAgeMonths: form.get("minAgeMonths")
        ? Number(form.get("minAgeMonths"))
        : null,
      isBestSeller: bestSeller,
      bestSellerRank: bestSeller ? Number(form.get("bestSellerRank")) : null,
      shortDescription: form.get("shortDescription"),
      description: form.get("description"),
      status: visible ? "AVAILABLE" : "HIDDEN",
      featured,
      sortOrder: Number(form.get("sortOrder")),
      categoryIds: form.getAll("categoryIds"),
      tagIds: form.getAll("tagIds"),
      images: images.map(({ id: imageId, r2Key, altText }, sortOrder) => ({
        id: imageId,
        r2Key,
        altText,
        sortOrder,
      })),
      variants: variants.map((variant) => ({
        ...variant,
        priceVnd: Number(variant.priceVnd),
      })),
      deletedVariantIds,
    };
    const task = saveController.save(payload);
    if (!task) return;
    setSaving(true);
    try {
      const result = await task;
      if (result.ok) {
        setMessage("Đã lưu sản phẩm và liên kết ảnh R2.");
        if (result.created)
          navigate(getProductEditPath(result.id), { replace: true });
        else {
          // Đồng bộ lại ID server cấp cho draft để lần Save kế tiếp vẫn là UPDATE.
          const response = await fetch(`/api/admin/products/${result.id}`);
          if (response.ok) {
            const body = (await response.json()) as { data?: Product };
            if (body.data) {
              setEditing(body.data);
              setVariants(body.data.variants.map(toEditableVariant));
              setDeletedVariantIds([]);
              setVariantErrors({});
            }
          }
        }
      } else {
        const mappedVariantErrors = mapVariantValidationIssue(
          result.details,
          variants,
          result.message,
        );
        if (Object.keys(mappedVariantErrors).length)
          setVariantErrors((current) => ({ ...current, ...mappedVariantErrors }));
        setMessage(result.message);
      }
    } catch {
      setMessage("Chưa thể lưu sản phẩm. Vui lòng thử lại.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <AdminShell title="Sản Phẩm">
      <form
        className="product-editor"
        onSubmit={save}
        key={editing?.id ?? (id ? "loading" : "new")}
      >
        <div className="editor-heading">
          <div>
            <h1>{editing ? "Sửa sản phẩm" : "Thêm sản phẩm"}</h1>
            <p>Quản lý và cập nhật thông tin sản phẩm mới. {message}</p>
          </div>
          <div>
            <Link to="/admin/products">HỦY</Link>
            <button
              className="btn primary"
              type="submit"
              disabled={saving || uploading || Boolean(id && !editing)}
            >
              <Icon>save</Icon> LƯU SẢN PHẨM
            </button>
            {id && (
              <button
                className="btn"
                type="button"
                onClick={async () => {
                  if (!window.confirm("Lưu trữ sản phẩm này? Sản phẩm sẽ không còn xuất hiện trên catalog.")) return;
                  const response = await fetch(`/api/admin/products/${id}`, { method: "DELETE" });
                  if (response.ok) navigate("/admin/products");
                  else setMessage("Chưa thể lưu trữ sản phẩm.");
                }}
              >
                LƯU TRỮ
              </button>
            )}
          </div>
        </div>
        <div className="editor-grid">
          <div className="editor-main">
            <EditorCard icon="info" title="Thông tin chung">
              <label>
                Tên sản phẩm *
                <input
                  name="name"
                  required
                  defaultValue={editing?.name}
                  placeholder="Nhập tên sản phẩm..."
                />
              </label>
              <div className="form-grid">
                <label>
                  Đường dẫn (Slug)
                  <input
                    name="slug"
                    defaultValue={editing?.slug}
                    placeholder="tu-dong-tao-tu-ten..."
                  />
                </label>
                <label>
                  Thương hiệu
                  <select name="brandId" defaultValue={editing?.brandId ?? ""}>
                    <option value="">Chọn thương hiệu...</option>
                    {brands.map((brand) => (
                      <option key={brand.id} value={brand.id}>
                        {brand.name}{brand.isActive === false ? " (đã ẩn)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                Mô tả ngắn
                <textarea
                  name="shortDescription"
                  className="short"
                  defaultValue={editing?.shortDescription}
                  placeholder="Tóm tắt công dụng hoặc đặc điểm nổi bật..."
                />
              </label>
              <label>
                Mô tả chi tiết
                <textarea
                  name="description"
                  defaultValue={editing?.description}
                  placeholder="Nhập chi tiết thành phần, hướng dẫn sử dụng, bảo quản..."
                />
              </label>
            </EditorCard>
            <EditorCard
              icon="view_list"
              title="Phân loại & Giá bán"
              action="+ Thêm phân loại"
              onAction={addVariant}
            >
              <div className="variant-table">
                <div className="variant-head">
                  <span>Tên phân loại</span>
                  <span>Mã SKU</span>
                  <span>Giá bán (₫)</span>
                  <span>Tình trạng & tồn kho</span>
                </div>
                {variants.map((variant) => {
                  const errors = variantErrors[variant.clientId] ?? {};
                  return (
                    <div className="variant-row" key={variant.id ?? variant.clientId}>
                      <label>
                        <span className="sr-only">Tên phân loại</span>
                        <input
                          value={variant.name}
                          onChange={(event) =>
                            updateVariant(variant.clientId, "name", event.target.value)
                          }
                          aria-invalid={Boolean(errors.name)}
                          aria-describedby={errors.name ? `${variant.clientId}-name-error` : undefined}
                        />
                        {errors.name && <small id={`${variant.clientId}-name-error`} className="form-error">{errors.name}</small>}
                      </label>
                      <label>
                        <span className="sr-only">Mã SKU</span>
                        <input
                          value={variant.sku}
                          onChange={(event) =>
                            updateVariant(variant.clientId, "sku", event.target.value)
                          }
                          aria-invalid={Boolean(errors.sku)}
                          aria-describedby={errors.sku ? `${variant.clientId}-sku-error` : undefined}
                        />
                        {errors.sku && <small id={`${variant.clientId}-sku-error`} className="form-error">{errors.sku}</small>}
                      </label>
                      <label>
                        <span className="sr-only">Giá bán</span>
                        <input
                          type="number"
                          min="1"
                          value={variant.priceVnd}
                          onChange={(event) =>
                            updateVariant(variant.clientId, "priceVnd", event.target.value)
                          }
                          aria-invalid={Boolean(errors.priceVnd)}
                          aria-describedby={errors.priceVnd ? `${variant.clientId}-price-error` : undefined}
                        />
                        {errors.priceVnd && <small id={`${variant.clientId}-price-error`} className="form-error">{errors.priceVnd}</small>}
                      </label>
                      <div className="variant-inventory-editor">
                        <span className="sr-only">Tình trạng</span>
                        <select
                          value={variant.availability}
                          onChange={(event) =>
                            updateVariant(variant.clientId, "availability", event.target.value)
                          }
                          aria-invalid={Boolean(errors.availability)}
                          aria-describedby={errors.availability ? `${variant.clientId}-availability-error` : undefined}
                        >
                          <option value="AVAILABLE">Đang bán</option>
                          <option value="OUT_OF_STOCK">Tạm hết</option>
                          <option value="HIDDEN">Đã ẩn</option>
                        </select>
                        {errors.availability && <small id={`${variant.clientId}-availability-error`} className="form-error">{errors.availability}</small>}
                        <label className="inventory-toggle-label">
                          <input
                            type="checkbox"
                            checked={variant.trackInventory}
                            onChange={(event) =>
                              updateVariant(
                                variant.clientId,
                                "trackInventory",
                                event.target.checked,
                              )
                            }
                          />
                          <span>Theo dõi tồn kho</span>
                        </label>
                        <label>
                          <span className="sr-only">Tồn kho thực tế</span>
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={variant.stockOnHand}
                            onChange={(event) =>
                              updateVariant(
                                variant.clientId,
                                "stockOnHand",
                                event.target.value,
                              )
                            }
                            aria-label="Tồn kho thực tế"
                            aria-invalid={Boolean(errors.stockOnHand)}
                            aria-describedby={errors.stockOnHand ? `${variant.clientId}-stock-error` : undefined}
                          />
                          {errors.stockOnHand && <small id={`${variant.clientId}-stock-error`} className="form-error">{errors.stockOnHand}</small>}
                        </label>
                        <small className="inventory-readonly">
                          Đang giữ: {variant.reservedQuantity ?? 0} • Có thể bán: {variant.trackInventory ? Math.max(0, Number(variant.stockOnHand) - (variant.reservedQuantity ?? 0)) : "Không theo dõi"}
                        </small>
                      </div>
                      <button
                        type="button"
                        onClick={() => deleteVariant(variant)}
                        aria-label={`Xóa phân loại ${variant.name || "mới"}`}
                      >
                        <Icon>delete</Icon>
                      </button>
                    </div>
                  );
                })}
              </div>
            </EditorCard>
          </div>
          <aside className="editor-side">
            <EditorCard icon="image" title="Hình ảnh">
              <label>Ảnh chính (Ảnh đại diện)</label>
              <label className="upload-box">
                <Icon>add_photo_alternate</Icon>
                <b>Tải ảnh lên</b>
                <span>hoặc kéo thả vào đây</span>
                <small>PNG, JPG, WebP (Max 5MB)</small>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={uploading}
                  onChange={(event) => void uploadFiles(event.target.files, true)}
                />
              </label>
              {images.length > 0 && (
                <div className="editor-image-list">
                  {images.map((image, index) => (
                    <div key={image.r2Key} className="editor-image-item">
                      <ProductImage image={image} alt={image.altText} />
                      <span>{index === 0 ? "Ảnh chính" : `Ảnh ${index + 1}`}</span>
                      <div>
                        <button
                          type="button"
                          aria-label="Chọn làm ảnh chính"
                          disabled={index === 0}
                          onClick={() => makePrimary(index)}
                        >
                          <Icon>star</Icon>
                        </button>
                        <button
                          type="button"
                          aria-label="Đưa ảnh lên trước"
                          disabled={index === 0}
                          onClick={() => moveImage(index, -1)}
                        >
                          <Icon>arrow_upward</Icon>
                        </button>
                        <button
                          type="button"
                          aria-label="Đưa ảnh xuống sau"
                          disabled={index === images.length - 1}
                          onClick={() => moveImage(index, 1)}
                        >
                          <Icon>arrow_downward</Icon>
                        </button>
                        <button
                          type="button"
                          aria-label="Gỡ ảnh khỏi sản phẩm"
                          onClick={() =>
                            setImages((current) =>
                              current
                                .filter((_, itemIndex) => itemIndex !== index)
                                .map((item, sortOrder) => ({ ...item, sortOrder })),
                            )
                          }
                        >
                          <Icon>delete</Icon>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <label>Thư viện ảnh</label>
              <label className="gallery-add">
                <Icon>add</Icon>
                <input
                  type="file"
                  multiple
                  accept="image/png,image/jpeg,image/webp"
                  disabled={uploading}
                  onChange={(event) => void uploadFiles(event.target.files, false)}
                />
              </label>
            </EditorCard>
            <EditorCard icon="sell" title="Phân loại & Tags">
              <label>Nhóm sản phẩm</label>
              <div className="selected-tags taxonomy-choices">
                {classificationCategories.map((category) => (
                  <label key={category.id} className="tag-choice">
                    <input
                      type="checkbox"
                      name="categoryIds"
                      value={category.id}
                      defaultChecked={
                        editing?.categoryIds?.includes(category.id) ??
                        category.slug === editing?.category
                      }
                      disabled={category.isActive === false && !editing?.categoryIds?.includes(category.id)}
                    />
                    <Tag tone={category.isActive === false ? "neutral" : "secondary"}>
                      {category.name}{category.isActive === false ? " (đã ẩn)" : ""}
                    </Tag>
                  </label>
                ))}
              </div>
              <label>
                Tuổi tối thiểu (tháng)
                <input
                  name="minAgeMonths"
                  type="number"
                  min="0"
                  max="240"
                  list="age-presets"
                  defaultValue={editing?.minAgeMonths ?? ""}
                  placeholder="Ví dụ: 6"
                />
                <datalist id="age-presets">
                  {[6, 7, 10, 12].map((age) => <option key={age} value={age} />)}
                </datalist>
              </label>
              <label>Đặc điểm nổi bật (Tags)</label>
              <div className="selected-tags">
                {tags.map((tag) => (
                  <label key={tag.id} className="tag-choice">
                    <input
                      type="checkbox"
                      name="tagIds"
                      value={tag.id}
                      defaultChecked={editing?.tagIds?.includes(tag.id)}
                    />
                    <Tag>{tag.name}</Tag>
                  </label>
                ))}
              </div>
              <button className="outline-add" type="button">
                <Icon>add</Icon> Thêm tag
              </button>
            </EditorCard>
            <EditorCard icon="visibility" title="Trạng thái hiển thị">
              <Toggle
                label="Đang bán (Hiển thị)"
                description="Cho phép khách hàng mua sản phẩm này"
                value={visible}
                onChange={setVisible}
              />
              <Toggle
                label="Sản phẩm nổi bật"
                description="Gắn huy hiệu nổi bật trên trang chủ"
                value={featured}
                onChange={setFeatured}
              />
              <Toggle
                label="Best seller"
                description="Hiển thị huy hiệu và xếp hạng Best seller"
                value={bestSeller}
                onChange={setBestSeller}
              />
              {bestSeller && (
                <label>
                  Thứ tự Best seller
                  <input
                    name="bestSellerRank"
                    type="number"
                    min="1"
                    required
                    defaultValue={editing?.bestSellerRank ?? 1}
                  />
                </label>
              )}
              <label>
                Thứ tự hiển thị (Tùy chọn)
                <input name="sortOrder" type="number" defaultValue={0} />
              </label>
            </EditorCard>
          </aside>
        </div>
      </form>
    </AdminShell>
  );
}

function EditorCard({
  icon,
  title,
  action,
  onAction,
  children,
}: {
  icon: string;
  title: string;
  action?: string;
  onAction?: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="editor-card">
      <div className="editor-card-title">
        <span>
          <Icon>{icon}</Icon>
          <h2>{title}</h2>
        </span>
        {action && <button type="button" onClick={onAction}>{action}</button>}
      </div>
      {children}
    </section>
  );
}

function Toggle({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="toggle-row">
      <div>
        <b>{label}</b>
        <small>{description}</small>
      </div>
      <button
        type="button"
        className={`toggle ${value ? "on" : ""}`}
        onClick={() => onChange(!value)}
        aria-pressed={value}
      >
        <span />
      </button>
    </div>
  );
}

function toggleCartRequestFilterValue<T extends string>(
  values: readonly T[],
  value: T,
) {
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value];
}

function advancedFiltersFromUrlState(
  state: AdminCartRequestUrlState,
): AdminCartRequestAdvancedFilters {
  return {
    datePreset: state.datePreset,
    dateFrom: state.dateFrom,
    dateTo: state.dateTo,
    statuses: [...state.statuses],
    checkoutStates: [...state.checkoutStates],
    channels: [...state.channels],
    messengerDeliveryStatuses: [...state.messengerDeliveryStatuses],
    subtotalMin: state.subtotalMin,
    subtotalMax: state.subtotalMax,
    itemCountMin: state.itemCountMin,
    itemCountMax: state.itemCountMax,
  };
}

function AdminCartRequestFilterPanel({
  filters,
  onChange,
  onApply,
  onClear,
  onClose,
  errorMessage,
}: {
  filters: AdminCartRequestAdvancedFilters;
  onChange: (filters: AdminCartRequestAdvancedFilters) => void;
  onApply: () => void;
  onClear: () => void;
  onClose: () => void;
  errorMessage: string;
}) {
  const datePresets: Array<[AdminCartRequestDatePreset, string]> = [
    ["today", "Hôm nay"],
    ["yesterday", "Hôm qua"],
    ["sevenDays", "7 ngày gần nhất"],
    ["thirtyDays", "30 ngày gần nhất"],
    ["thisMonth", "Tháng này"],
    ["lastMonth", "Tháng trước"],
    ["custom", "Khoảng ngày tùy chỉnh"],
  ];
  const setPreset = (preset: AdminCartRequestDatePreset) => {
    if (preset === "custom") {
      onChange({ ...filters, datePreset: preset });
      return;
    }
    onChange({
      ...filters,
      datePreset: preset,
      ...getAdminCartRequestDateRange(preset),
    });
  };
  const setDate = (key: "dateFrom" | "dateTo", value: string) =>
    onChange({ ...filters, datePreset: "custom", [key]: value || null });
  const setNumber = (
    key:
      | "subtotalMin"
      | "subtotalMax"
      | "itemCountMin"
      | "itemCountMax",
    value: string,
  ) => onChange({ ...filters, [key]: parseAdminCartRequestFilterNumber(value) });
  return (
    <div className="request-filter-panel" role="dialog" aria-label="Lọc nâng cao">
      <div className="request-filter-panel-heading">
        <div>
          <h2>Lọc nâng cao</h2>
          <p>Kết hợp các điều kiện với tab đang chọn.</p>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Đóng bộ lọc">
          <Icon>close</Icon>
        </button>
      </div>
      <div className="request-filter-grid">
        <fieldset>
          <legend>Thời gian tạo</legend>
          <div className="request-filter-presets">
            {datePresets.map(([value, label]) => (
              <button
                type="button"
                key={value}
                className={filters.datePreset === value ? "active" : ""}
                aria-pressed={filters.datePreset === value}
                onClick={() => setPreset(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="request-filter-date-grid">
            <label>
              Từ ngày
              <input
                type="date"
                value={filters.dateFrom ?? ""}
                onChange={(event) => setDate("dateFrom", event.target.value)}
              />
            </label>
            <label>
              Đến ngày
              <input
                type="date"
                value={filters.dateTo ?? ""}
                onChange={(event) => setDate("dateTo", event.target.value)}
              />
            </label>
          </div>
        </fieldset>
        <fieldset>
          <legend>Trạng thái legacy</legend>
          <div className="request-filter-options">
            {CART_REQUEST_STATUSES.map((value: CartRequestStatus) => (
              <label key={value}>
                <input
                  type="checkbox"
                  checked={filters.statuses.includes(value)}
                  onChange={() =>
                    onChange({
                      ...filters,
                      statuses: toggleCartRequestFilterValue(filters.statuses, value),
                    })
                  }
                />
                {CART_REQUEST_STATUS_LABELS[value]}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Trạng thái checkout</legend>
          <div className="request-filter-options">
            {CART_CHECKOUT_STATES.map((value: CartCheckoutState) => (
              <label key={value}>
                <input
                  type="checkbox"
                  checked={filters.checkoutStates.includes(value)}
                  onChange={() =>
                    onChange({
                      ...filters,
                      checkoutStates: toggleCartRequestFilterValue(
                        filters.checkoutStates,
                        value,
                      ),
                    })
                  }
                />
                {CART_CHECKOUT_STATE_LABELS[value]}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Kênh</legend>
          <div className="request-filter-options">
            {CART_REQUEST_CHANNELS.map((value: CartRequestChannel) => (
              <label key={value}>
                <input
                  type="checkbox"
                  checked={filters.channels.includes(value)}
                  onChange={() =>
                    onChange({
                      ...filters,
                      channels: toggleCartRequestFilterValue(filters.channels, value),
                    })
                  }
                />
                {CART_REQUEST_CHANNEL_LABELS[value]}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Trạng thái gửi Messenger</legend>
          <div className="request-filter-options">
            {MESSENGER_DELIVERY_STATUSES.map((value: MessengerDeliveryStatus) => (
              <label key={value}>
                <input
                  type="checkbox"
                  checked={filters.messengerDeliveryStatuses.includes(value)}
                  onChange={() =>
                    onChange({
                      ...filters,
                      messengerDeliveryStatuses: toggleCartRequestFilterValue(
                        filters.messengerDeliveryStatuses,
                        value,
                      ),
                    })
                  }
                />
                {MESSENGER_DELIVERY_STATUS_LABELS[value]}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Giá trị giỏ</legend>
          <div className="request-filter-value-grid">
            <label>
              Giá trị từ
              <input
                inputMode="numeric"
                value={formatAdminCartRequestFilterNumber(filters.subtotalMin)}
                onChange={(event) => setNumber("subtotalMin", event.target.value)}
                aria-label="Giá trị giỏ từ"
              />
            </label>
            <label>
              Giá trị đến
              <input
                inputMode="numeric"
                value={formatAdminCartRequestFilterNumber(filters.subtotalMax)}
                onChange={(event) => setNumber("subtotalMax", event.target.value)}
                aria-label="Giá trị giỏ đến"
              />
            </label>
          </div>
        </fieldset>
        <fieldset>
          <legend>Số mặt hàng</legend>
          <div className="request-filter-value-grid">
            <label>
              Từ mặt hàng
              <input
                inputMode="numeric"
                value={formatAdminCartRequestFilterNumber(filters.itemCountMin)}
                onChange={(event) => setNumber("itemCountMin", event.target.value)}
                aria-label="Số mặt hàng từ"
              />
            </label>
            <label>
              Đến mặt hàng
              <input
                inputMode="numeric"
                value={formatAdminCartRequestFilterNumber(filters.itemCountMax)}
                onChange={(event) => setNumber("itemCountMax", event.target.value)}
                aria-label="Số mặt hàng đến"
              />
            </label>
          </div>
        </fieldset>
      </div>
      {errorMessage && <p className="form-error" role="alert">{errorMessage}</p>}
      <div className="request-filter-actions">
        <button type="button" className="btn" onClick={onClear}>Xóa tất cả</button>
        <div>
          <button type="button" className="btn" onClick={onClose}>Hủy</button>
          <button type="button" className="btn primary" onClick={onApply}>Áp dụng bộ lọc</button>
        </div>
      </div>
    </div>
  );
}

export function AdminCartRequestsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const urlState = parseAdminCartRequestUrl(location.search);
  const [searchInput, setSearchInput] = useState(urlState.q);
  const [filterOpen, setFilterOpen] = useState(false);
  const [draftFilters, setDraftFilters] = useState<AdminCartRequestAdvancedFilters>(
    () => advancedFiltersFromUrlState(urlState),
  );
  const [filterError, setFilterError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [requests, setRequests] = useState<AdminCartRequestRow[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reloadNonce, setReloadNonce] = useState(0);
  const requestSequence = useRef(0);
  const filterChips = getAdminCartRequestFilterChips(urlState);

  useEffect(() => {
    // Browser Back/Forward phải đưa ô tìm kiếm về đúng state trong URL.
    setSearchInput(urlState.q);
  }, [urlState.q]);

  useEffect(() => {
    if (!filterOpen) setDraftFilters(advancedFiltersFromUrlState(urlState));
  }, [filterOpen, location.search]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const normalized = searchInput.trim();
    if (normalized === urlState.q) return;
    const timer = window.setTimeout(() => {
      // Debounce search và reset page để không gửi request theo từng ký tự.
      navigate(
        buildAdminCartRequestUrl({ ...urlState, q: normalized, page: 1 }),
        { replace: true },
      );
    }, 350);
    return () => window.clearTimeout(timer);
  }, [location.search, navigate, searchInput, urlState.q]);

  useEffect(() => {
    const controller = new AbortController();
    const sequence = ++requestSequence.current;
    setLoading(true);
    setLoadError("");
    void fetch(buildAdminCartRequestApiUrl(urlState), {
      headers: { accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("REQUESTS_LOAD_FAILED");
        return response.json() as Promise<{
          data?: AdminCartRequestRow[];
          pagination?: PaginationMeta;
        }>;
      })
      .then((body) => {
        if (sequence !== requestSequence.current) return;
        if (!body.pagination) throw new Error("REQUESTS_INVALID_RESPONSE");
        setRequests(Array.isArray(body.data) ? body.data : []);
        setPagination(body.pagination);
        if (body.pagination.page !== urlState.page) {
          // D1 đã clamp page; URL được thay bằng page chuẩn để không render trang rỗng.
          navigate(
            buildAdminCartRequestUrl({ ...urlState, page: body.pagination.page }),
            { replace: true },
          );
        }
      })
      .catch((caught) => {
        if (controller.signal.aborted || sequence !== requestSequence.current) return;
        setLoadError(
          caught instanceof Error && caught.message === "REQUESTS_INVALID_RESPONSE"
            ? "Dữ liệu danh sách giỏ hàng không hợp lệ."
            : "Không tải được danh sách giỏ hàng từ D1.",
        );
        setPagination(null);
      })
      .finally(() => {
        if (sequence === requestSequence.current) setLoading(false);
      });
    return () => controller.abort();
  }, [location.search, navigate, reloadNonce]);

  const navigateWithState = (next: AdminCartRequestUrlState, replace = false) =>
    navigate(buildAdminCartRequestUrl(next), { replace });
  const applyAdvancedFilters = () => {
    if (
      draftFilters.dateFrom &&
      draftFilters.dateTo &&
      draftFilters.dateFrom > draftFilters.dateTo
    ) {
      setFilterError("Ngày bắt đầu phải trước hoặc cùng ngày kết thúc.");
      return;
    }
    if (
      draftFilters.subtotalMin !== null &&
      draftFilters.subtotalMax !== null &&
      draftFilters.subtotalMax < draftFilters.subtotalMin
    ) {
      setFilterError("Giá trị đến phải lớn hơn hoặc bằng giá trị từ.");
      return;
    }
    if (
      draftFilters.itemCountMin !== null &&
      draftFilters.itemCountMax !== null &&
      draftFilters.itemCountMax < draftFilters.itemCountMin
    ) {
      setFilterError("Số mặt hàng đến phải lớn hơn hoặc bằng số mặt hàng từ.");
      return;
    }
    setFilterError("");
    setFilterOpen(false);
    navigateWithState({ ...urlState, ...draftFilters, page: 1 });
  };
  const clearAdvancedFilters = () => {
    const empty = emptyAdminCartRequestAdvancedFilters();
    setDraftFilters(empty);
    setFilterError("");
    navigateWithState({ ...urlState, ...empty, page: 1 });
  };
  const clearAllFilters = () => {
    const empty = emptyAdminCartRequestAdvancedFilters();
    setSearchInput("");
    navigateWithState({
      ...urlState,
      ...empty,
      q: "",
      sort: null,
      order: "desc",
      page: 1,
    });
  };
  const sortValue = urlState.sort ? `${urlState.sort}:${urlState.order}` : "";
  const hasSearchOrAdvancedFilter = Boolean(urlState.q || filterChips.length);
  return (
    <AdminShell title="Giỏ Hàng Gửi Đến">
      <div className="requests-heading">
        <div>
          <h1>Giỏ hàng gửi đến</h1>
          <p>
            Quản lý yêu cầu giỏ hàng và trạng thái gửi đến kênh liên hệ của
            khách hàng.
          </p>
        </div>
        <label className="admin-search">
          <Icon>search</Icon>
          <input
            value={searchInput}
            aria-label="Tìm kiếm giỏ hàng"
            placeholder="Tìm theo mã GH, tên, SĐT..."
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </label>
        <label className="request-sort-control">
          <span>Sắp xếp</span>
          <select
            aria-label="Sắp xếp giỏ hàng"
            value={sortValue}
            onChange={(event) => {
              const [sort, order] = event.target.value.split(":");
              navigateWithState({
                ...urlState,
                sort: sort ? (sort as AdminCartRequestUrlState["sort"]) : null,
                order: order === "asc" ? "asc" : "desc",
                page: 1,
              });
            }}
          >
            {CART_REQUEST_SORT_OPTIONS.map((option) => (
              <option value={option.value} key={option.value || "default"}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="filter-advanced"
          aria-expanded={filterOpen}
          onClick={() => {
            setDraftFilters(advancedFiltersFromUrlState(urlState));
            setFilterError("");
            setFilterOpen((open) => !open);
          }}
        >
          <Icon>filter_list</Icon>
          <span>Lọc nâng cao{filterChips.length ? ` (${filterChips.length})` : ""}</span>
        </button>
      </div>
      {filterChips.length > 0 && (
        <div className="request-filter-chips" aria-label="Bộ lọc đang áp dụng">
          {filterChips.map((chip) => (
            <button
              type="button"
              className="request-filter-chip"
              key={chip.key}
              onClick={() => navigateWithState(removeAdminCartRequestFilter(urlState, chip.key))}
              aria-label={`Xóa bộ lọc ${chip.label}`}
            >
              <span>{chip.label}</span>
              <Icon>close</Icon>
            </button>
          ))}
          <button type="button" className="request-clear-filters" onClick={clearAdvancedFilters}>
            Xóa tất cả
          </button>
        </div>
      )}
      {filterOpen && (
        <AdminCartRequestFilterPanel
          filters={draftFilters}
          onChange={setDraftFilters}
          onApply={applyAdvancedFilters}
          onClear={clearAdvancedFilters}
          onClose={() => setFilterOpen(false)}
          errorMessage={filterError}
        />
      )}
      <div className="request-tabs">
        <button
          type="button"
          className={urlState.scope === "queue" ? "active" : ""}
          onClick={() => navigateWithState({ ...urlState, scope: "queue", page: 1 })}
        >
          Hàng chờ xử lý
        </button>
        <button
          type="button"
          className={urlState.scope === "share" ? "active" : ""}
          onClick={() => navigateWithState({ ...urlState, scope: "share", page: 1 })}
        >
          Chia sẻ thủ công
        </button>
        <button
          type="button"
          className={urlState.scope === "messenger" ? "active" : ""}
          onClick={() => navigateWithState({ ...urlState, scope: "messenger", page: 1 })}
        >
          Theo dõi Messenger
        </button>
      </div>
      <section className={`admin-table-card request-table${loading ? " is-loading" : ""}`}>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Mã giỏ hàng</th>
                <th>Khách hàng</th>
                <th>Thời gian</th>
                <th>Số mặt hàng</th>
                <th>Tạm tính</th>
                <th>Trạng thái</th>
                <th>Kênh</th>
                <th>Trạng thái gửi</th>
              </tr>
            </thead>
            <tbody>
              {loading && !requests.length ? (
                <tr>
                  <td colSpan={8}>
                    <div className="request-table-state" aria-live="polite">
                      <Icon className="request-table-loading-icon">progress_activity</Icon>
                      <p>Đang tải danh sách giỏ hàng…</p>
                    </div>
                  </td>
                </tr>
              ) : loadError && !requests.length ? (
                <tr>
                  <td colSpan={8}>
                    <div className="request-table-state request-table-error" role="alert">
                      <Icon>error</Icon>
                      <p>{loadError}</p>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => setReloadNonce((value) => value + 1)}
                      >
                        Thử lại
                      </button>
                    </div>
                  </td>
                </tr>
              ) : requests.length ? (
                requests.map((request) => (
                  <tr key={request.id}>
                    <td>
                      <Link
                        className="request-code"
                        to={`/admin/cart-requests/${request.id}`}
                      >
                        {request.publicCode}
                      </Link>
                    </td>
                    <td>
                      <b>
                        {request.customerName ||
                          (request.contactChannel === "SHARE"
                            ? "Khách chia sẻ"
                            : "Khách Messenger")}
                      </b>
                      {request.customerPhone ? (
                        <small>
                          <Icon>call</Icon>
                          {request.customerPhone}
                        </small>
                      ) : (
                        <small>
                          {request.contactChannel === "SHARE"
                            ? "Khách tự gửi thông tin tới người bán"
                            : "Trao đổi trực tiếp trên Messenger"}
                        </small>
                      )}
                    </td>
                    <td>
                      {new Date(request.createdAt).toLocaleTimeString("vi-VN", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      <small>
                        {new Date(request.createdAt).toLocaleDateString("vi-VN")}
                      </small>
                    </td>
                    <td>
                      <Tag tone="neutral">
                        {request.itemLineCount} mặt hàng • SL {request.totalQuantity}
                      </Tag>
                    </td>
                    <td>
                      <Price value={request.subtotalVnd} />
                    </td>
                    <td>
                      <StatusBadge
                        status={
                          request.checkoutState && request.checkoutState !== "LEGACY"
                            ? request.checkoutState
                            : request.status
                        }
                      />
                      {request.checkoutState === "WAITING_SELLER_CONFIRM" && (
                        <small>
                          {formatReservationRemaining(request.reservationExpiresAt, now)}
                        </small>
                      )}
                    </td>
                    <td>
                      <StatusBadge status={request.contactChannel} />
                    </td>
                    <td>
                      <StatusBadge
                        status={
                          request.contactChannel === "SHARE"
                            ? "SHARE_READY"
                            : request.contactChannel === "MESSENGER"
                              ? request.messengerDeliveryStatus === "PENDING"
                                ? request.messengerSessionStatus || "CREATED"
                                : request.messengerDeliveryStatus
                              : "LEGACY"
                        }
                      />
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8}>
                    <div className="request-table-state">
                      <Icon>shopping_basket</Icon>
                      <h2>
                        {hasSearchOrAdvancedFilter
                          ? "Không tìm thấy giỏ hàng phù hợp"
                          : "Chưa có giỏ hàng"}
                      </h2>
                      <p>
                        {hasSearchOrAdvancedFilter
                          ? "Hãy thử thay đổi từ khóa hoặc bộ lọc."
                          : "Các yêu cầu giỏ hàng mới sẽ xuất hiện ở đây."}
                      </p>
                      {hasSearchOrAdvancedFilter && (
                        <button type="button" className="btn" onClick={clearAllFilters}>
                          Xóa bộ lọc
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {loading ? (
          <div className="table-footer" aria-live="polite">Đang tải danh sách giỏ hàng…</div>
        ) : loadError ? (
          <div className="table-footer request-footer-error" role="alert">{loadError}</div>
        ) : (
          <TableFooter
            pagination={pagination}
            onPageChange={(page) => navigateWithState({ ...urlState, page })}
            itemLabel="giỏ hàng"
            emptyText="0 giỏ hàng"
          />
        )}
      </section>
    </AdminShell>
  );
}

export function AdminCartRequestDetailPage() {
  const requestId =
    useLocation().pathname.split("/").filter(Boolean).at(-1) ??
    "request-canonical";
  const [status, setStatus] = useState("SUBMITTED");
  const [messengerDelivery, setMessengerDelivery] = useState("PENDING");
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [detail, setDetail] = useState<{
    publicCode: string;
    customerName: string | null;
    customerPhone: string | null;
    customerNote?: string | null;
    itemLineCount: number;
    totalQuantity: number;
    subtotalVnd: number;
    status: string;
    contactChannel: "LEGACY" | "MESSENGER" | "SHARE";
    messengerDeliveryStatus: string;
    messengerSessionStatus: string | null;
    messengerConfirmedAt: string | null;
    messengerSentAt: string | null;
    messengerAttemptCount: number;
    messengerLastErrorCode: string | null;
    messengerLastError: string | null;
    messengerLastUserInteractionAt: string | null;
    messengerLinked: number;
    createdAt: string;
    updatedAt?: string;
    checkoutState?: string;
    reservationStartedAt?: string | null;
    reservationExpiresAt?: string | null;
    reservationDurationMinutes?: number | null;
    sellerConfirmedAt?: string | null;
    serverNow?: string;
    reservations?: Array<{
      id: string;
      variantId: string;
      quantity: number;
      sourceType: string;
      status: string;
      expiresAt: string;
    }>;
    promotionReservations?: Array<{
      id: string;
      promotionId: string;
      status: string;
      expiresAt: string;
    }>;
    items: Array<{
      id: string;
      productName: string;
      variantName: string;
      imageKey: string | null;
      imageUrl: string;
      priceVnd: number;
      quantity: number;
      lineTotalVnd: number;
    }>;
  } | null>(null);
  const [loadError, setLoadError] = useState("");
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const loadDetail = async () => {
    const response = await fetch(`/api/admin/cart-requests/${requestId}`);
    if (!response.ok) throw new Error("REQUEST_LOAD_FAILED");
    const body = (await response.json()) as { data: NonNullable<typeof detail> };
    setDetail(body.data);
    setStatus(body.data.status);
    setMessengerDelivery(body.data.messengerDeliveryStatus);
  };
  useEffect(() => {
    let cancelled = false;
    void loadDetail()
      .then(() => undefined)
      .catch(() => {
        if (!cancelled) setLoadError("Không tải được giỏ hàng từ D1.");
      });
    return () => {
      cancelled = true;
    };
  }, [requestId]);
  const updateStatus = async () => {
    const response = await fetch(
      `/api/admin/cart-requests/${requestId}/status`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      },
    );
    if (!response.ok) window.alert("Chưa thể cập nhật trạng thái.");
  };
  const retryMessenger = async () => {
    const response = await fetch(
      `/api/admin/cart-requests/${requestId}/retry-messenger`,
      { method: "POST" },
    );
    const body = (await response.json()) as {
      messengerDeliveryStatus?: string;
      error?: { message?: string };
    };
    if (response.ok) setMessengerDelivery("SENT");
    else window.alert(body.error?.message || "Chưa thể gửi lại Messenger.");
  };
  const runReservationAction = async (action: "confirm" | "cancel") => {
    if (actionBusy) return;
    setActionBusy(true);
    setActionError("");
    try {
      const response = await fetch(`/api/admin/cart-requests/${requestId}/${action}`, {
        method: "POST",
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(body.error?.message || "Chưa thể cập nhật reservation.");
      await loadDetail();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Chưa thể cập nhật reservation.");
    } finally {
      setActionBusy(false);
    }
  };
  if (!detail)
    return (
      <AdminShell title="Giỏ Hàng Gửi Đến">
        <div className="empty-state">
          <Icon>{loadError ? "error" : "progress_activity"}</Icon>
          <p>{loadError || "Đang tải dữ liệu giỏ hàng..."}</p>
        </div>
      </AdminShell>
    );
  const displayedStatus =
    detail.checkoutState && detail.checkoutState !== "LEGACY"
      ? detail.checkoutState
      : status;
  return (
    <AdminShell title="Giỏ Hàng Gửi Đến">
      <div className="request-detail-heading">
        <div>
          <span>
            CHI TIẾT YÊU CẦU • {new Date(detail.createdAt).toLocaleString("vi-VN")}
          </span>
          <h1>
            {detail.publicCode} <StatusBadge status={displayedStatus} />
          </h1>
        </div>
        <div>
          <button className="btn secondary-btn">In Phiếu</button>
          {detail.contactChannel !== "SHARE" && (
            <button className="btn primary">Liên Hệ Khách Hàng</button>
          )}
        </div>
      </div>
      <div className="request-detail-grid">
        <div>
          <section className="detail-admin-card customer-card">
            <div className="card-title">
              <h2>
                <Icon>person</Icon> Thông tin Khách hàng
              </h2>
              <button>Chỉnh sửa</button>
            </div>
            <div className="customer-fields">
              <div>
                <span>Tên khách hàng</span>
                <b>{detail.customerName || (detail.contactChannel === "SHARE" ? "Khách chia sẻ" : "Khách Messenger")}</b>
              </div>
              <div>
                <span>Số điện thoại</span>
                <b>
                  {detail.customerPhone || (detail.contactChannel === "SHARE" ? "Không thu thập" : "Không yêu cầu trước khi xác nhận")}
                  {detail.customerPhone && <Icon>content_copy</Icon>}
                </b>
              </div>
            </div>
            <span>Ghi chú từ khách hàng</span>
            <blockquote>{detail.customerNote || "Không có ghi chú."}</blockquote>
          </section>
          <section className="detail-admin-card interest-card">
            <h2>
              <Icon>shopping_bag</Icon> Sản phẩm Quan tâm
            </h2>
            {detail.items.map((item) => (
                <div className="interest-line" key={item.id}>
                  <ProductImage r2Key={item.imageKey} url={item.imageUrl} alt="" />
                  <p>
                    <b>{item.productName}</b>
                    <span>{item.variantName}</span>
                  </p>
                  <p>
                    <Price value={item.lineTotalVnd} />
                    <span>x{item.quantity}</span>
                  </p>
                </div>
              ))}
            <div className="interest-total">
              <span>
                Tổng cộng: {detail.itemLineCount} mặt hàng ({detail.totalQuantity} sản phẩm)
              </span>
              <div>
                <small>Tạm tính</small>
                <Price value={detail.subtotalVnd} />
              </div>
            </div>
          </section>
        </div>
        <aside>
          {(!detail.checkoutState || detail.checkoutState === "LEGACY") ? (
            <section className="status-update-card">
              <h2>Cập nhật Trạng thái</h2>
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                <option value="SUBMITTED">Mới</option>
                <option value="CONTACTED">Đã liên hệ</option>
                <option value="CONFIRMED">Đã xác nhận</option>
                <option value="COMPLETED">Hoàn thành</option>
                <option value="CANCELLED">Đã hủy</option>
              </select>
              <p>
                Trạng thái hiện tại:{" "}
                <b>
                  <StatusBadge status={status} />
                </b>
                . Chọn trạng thái mới để cập nhật tiến trình xử lý yêu cầu.
              </p>
              <button className="btn primary" onClick={updateStatus}>
                <Icon>update</Icon> CẬP NHẬT TRẠNG THÁI
              </button>
            </section>
          ) : (
            <section className="status-update-card reservation-admin-card">
              <h2>Giữ hàng &amp; ưu đãi</h2>
              <StatusBadge status={detail.checkoutState} />
              {detail.reservationExpiresAt && (
                <p>
                  Hạn xác nhận: <b>{new Date(detail.reservationExpiresAt).toLocaleString("vi-VN")}</b>
                  <br />
                  <strong>{formatReservationRemaining(detail.reservationExpiresAt, now)}</strong>
                </p>
              )}
              {detail.reservationDurationMinutes && (
                <small>Thời lượng đã snapshot: {formatReservationDuration(detail.reservationDurationMinutes)}.</small>
              )}
              <small>
                Đang giữ {detail.reservations?.filter((reservation) => reservation.status === "ACTIVE").length ?? 0} dòng hàng và {detail.promotionReservations?.filter((reservation) => reservation.status === "ACTIVE").length ?? 0} ưu đãi.
              </small>
              {actionError && <p className="form-error" role="alert">{actionError}</p>}
              {detail.checkoutState === "WAITING_SELLER_CONFIRM" && (
                <div className="reservation-admin-actions">
                  <button className="btn primary" disabled={actionBusy} onClick={() => void runReservationAction("confirm")}>
                    <Icon>check</Icon> XÁC NHẬN ĐƠN
                  </button>
                  <button className="btn secondary-btn" disabled={actionBusy} onClick={() => void runReservationAction("cancel")}>
                    <Icon>inventory</Icon> HỦY / GIẢI PHÓNG HÀNG
                  </button>
                </div>
              )}
              {detail.checkoutState === "READY_TO_SEND" && (
                <button className="btn secondary-btn" disabled={actionBusy} onClick={() => void runReservationAction("cancel")}>
                  <Icon>cancel</Icon> HỦY YÊU CẦU
                </button>
              )}
            </section>
          )}
          {detail.contactChannel === "SHARE" ? (
            <section className="channel-card share-admin-card">
              <h2>
                <span className="channel-icon share-icon"><Icon>share</Icon></span>
                Chia sẻ thủ công
              </h2>
              <StatusBadge status="SHARE_READY" />
              <p>Khách tự mở Messenger của người bán.</p>
              <p>
                BabyJoy không xác minh người bán đã nhận. Giỏ hàng và snapshot
                vẫn được giữ nguyên để đối chiếu.
              </p>
            </section>
          ) : detail.contactChannel === "MESSENGER" ? (
            <section className="channel-card messenger-admin-card">
              <h2>
                <span className="channel-icon messenger-icon">M</span> Messenger
              </h2>
              <StatusBadge status={messengerDelivery} />
              <span className="channel-time">
                {detail.messengerSentAt
                  ? new Date(detail.messengerSentAt).toLocaleString("vi-VN")
                  : "Chưa gửi"}
              </span>
              <p>
                Messenger: {detail.messengerLinked ? "Đã liên kết" : "Chưa liên kết"}
              </p>
              <p>
                Xác nhận: {detail.messengerConfirmedAt
                  ? new Date(detail.messengerConfirmedAt).toLocaleString("vi-VN")
                  : "Chưa xác nhận"}
                <br />Số lần gửi: {detail.messengerAttemptCount}
              </p>
              {detail.messengerLastError && (
                <p className="form-error">
                  {detail.messengerLastErrorCode || "MESSENGER_SEND_FAILED"}: {detail.messengerLastError}
                </p>
              )}
              {messengerDelivery === "FAILED" && (
                <button className="btn secondary-btn" onClick={retryMessenger}>
                  <Icon>send</Icon> THỬ GỬI LẠI MESSENGER
                </button>
              )}
            </section>
          ) : (
            <section className="channel-card legacy-channel-card">
              <h2>
                <span className="channel-icon">history</span> Kênh cũ
              </h2>
              <StatusBadge status="LEGACY" />
              <span className="channel-time">
                {new Date(detail.createdAt).toLocaleString("vi-VN")}
              </span>
              <p>Bản ghi này đến từ kênh cũ và chỉ được giữ để đối chiếu lịch sử.</p>
            </section>
          )}
        </aside>
      </div>
    </AdminShell>
  );
}

export function AdminTaxonomyPage({ type }: { type: "categories" | "tags" }) {
  const isCategories = type === "categories";
  type TaxonomyRow = {
    id: string;
    name: string;
    slug: string;
    description?: string;
    imageKey?: string | null;
    sortOrder: number;
    isActive: number | boolean;
    productCount?: number;
    groupType?: string | null;
  };
  type CategoryProduct = {
    id: string;
    name: string;
    slug: string;
    status: string;
    selected: number | boolean;
  };
  const [rows, setRows] = useState<TaxonomyRow[]>([]);
  const [editing, setEditing] = useState<TaxonomyRow | null>(null);
  const [categoryProducts, setCategoryProducts] = useState<CategoryProduct[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const loadRows = async () => {
    const response = await fetch(`/api/admin/${type}`);
    if (!response.ok) throw new Error("TAXONOMY_LOAD_FAILED");
    const body = (await response.json()) as { data?: TaxonomyRow[] };
    setRows(body.data ?? []);
  };
  useEffect(() => {
    void loadRows().catch(() => setMessage("Không tải được dữ liệu phân loại từ D1."));
  }, [type]);
  const openCategory = async (row: TaxonomyRow) => {
    setEditing(row);
    if (!isCategories) return;
    const response = await fetch(`/api/admin/categories/${row.id}/products`);
    const body = (await response.json()) as { data?: CategoryProduct[] };
    setCategoryProducts(body.data ?? []);
  };
  const saveTaxonomyRow = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(
        editing ? `/api/admin/${type}/${editing.id}` : `/api/admin/${type}`,
        {
          method: editing ? "PUT" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: form.get("name"),
            slug: form.get("slug"),
            description: form.get("description"),
            imageKey: form.get("imageKey") || null,
            sortOrder: Number(form.get("sortOrder")),
            isActive: form.get("isActive") === "on",
            groupType: form.get("groupType") || null,
          }),
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        id?: string;
        error?: { message?: string };
      };
      if (!response.ok) {
        setMessage(body.error?.message ?? "Chưa thể lưu phân loại.");
        return;
      }
      if (isCategories && editing) {
        const relationResponse = await fetch(
          `/api/admin/categories/${editing.id}/products`,
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              productIds: categoryProducts.filter((item) => item.selected).map((item) => item.id),
            }),
          },
        );
        if (!relationResponse.ok) {
          setMessage("Đã lưu nhóm nhưng chưa thể cập nhật danh sách sản phẩm.");
          return;
        }
      }
      setMessage("Đã lưu phân loại và quan hệ sản phẩm.");
      setEditing(null);
      setCategoryProducts([]);
      await loadRows();
    } catch {
      setMessage("Chưa thể lưu phân loại. Vui lòng thử lại.");
    } finally {
      setBusy(false);
    }
  };
  const deleteTaxonomyRow = async () => {
    if (!editing || busy) return;
    const label = isCategories ? "danh mục" : "tag";
    const confirmation = isCategories
      ? `Xóa vĩnh viễn danh mục "${editing.name}"? Sản phẩm thuộc danh mục này sẽ không bị xóa. Hành động này không thể hoàn tác.`
      : `Xóa vĩnh viễn tag "${editing.name}"? Sản phẩm sử dụng tag này sẽ không bị xóa. Hành động này không thể hoàn tác.`;
    if (!window.confirm(confirmation)) return;

    setBusy(true);
    setMessage("Đang xóa vĩnh viễn...");
    try {
      const response = await fetch(
        `/api/admin/${type}/${editing.id}/permanent`,
        { method: "DELETE" },
      );
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        setMessage(body.error?.message ?? `Chưa thể xóa ${label}.`);
        return;
      }

      // Xóa row tại chỗ để UI không giữ taxonomy đã bị xóa trong lúc refetch.
      setRows((current) => current.filter((row) => row.id !== editing.id));
      setEditing(null);
      setCategoryProducts([]);
      try {
        await loadRows();
        setMessage(`Đã xóa ${label} vĩnh viễn.`);
      } catch {
        setMessage(`Đã xóa ${label}; danh sách sẽ được làm mới ở lần tải sau.`);
      }
    } catch {
      setMessage(`Chưa thể xóa ${label}. Vui lòng thử lại.`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AdminShell title={isCategories ? "Danh Mục" : "Tags"}>
      <div className="admin-page-heading">
        <div>
          <h1>{isCategories ? "Danh mục" : "Tags"}</h1>
          <p>
            {isCategories
              ? "Quản lý nhóm sản phẩm dinh dưỡng"
              : "Quản lý đặc tính và độ tuổi sản phẩm"}
          </p>
        </div>
        <button className="btn primary" onClick={() => { setEditing(null); setCategoryProducts([]); }}>
          <Icon>add</Icon> THÊM {isCategories ? "DANH MỤC" : "TAG"}
        </button>
      </div>
      <section className="admin-table-card taxonomy-card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Tên</th>
                <th>Slug</th>
                <th>{isCategories ? "Products" : "Nhóm"}</th>
                <th>Thứ tự</th>
                <th>Trạng thái</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <b>{row.name}</b>
                  </td>
                  <td>{row.slug}</td>
                  <td>{isCategories ? (row.productCount ?? 0) : (row.groupType ?? "Đặc tính")}</td>
                  <td>{row.sortOrder}</td>
                  <td>
                    <StatusBadge status={row.isActive ? "AVAILABLE" : "HIDDEN"} />
                  </td>
                  <td>
                    <button type="button" onClick={() => void openCategory(row)}>
                      <Icon>edit</Icon>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <form className="editor-card taxonomy-editor" onSubmit={saveTaxonomyRow} key={editing?.id ?? "new"}>
        <div className="editor-card-title">
          <span><Icon>category</Icon><h2>{editing ? "Sửa phân loại" : "Thêm phân loại"}</h2></span>
        </div>
        <div className="form-grid">
          <label>Tên *<input name="name" required defaultValue={editing?.name} /></label>
          <label>Slug<input name="slug" defaultValue={editing?.slug} /></label>
        </div>
        {isCategories ? (
          <>
            <label>Mô tả<textarea name="description" defaultValue={editing?.description} /></label>
            <label>R2 image key<input name="imageKey" defaultValue={editing?.imageKey ?? ""} /></label>
          </>
        ) : (
          <label>Nhóm tag<input name="groupType" defaultValue={editing?.groupType ?? "ATTRIBUTE"} /></label>
        )}
        <div className="form-grid">
          <label>Thứ tự<input name="sortOrder" type="number" defaultValue={editing?.sortOrder ?? rows.length + 1} /></label>
          <label className="tag-choice"><input name="isActive" type="checkbox" defaultChecked={editing ? Boolean(editing.isActive) : true} /> Đang hoạt động</label>
        </div>
        {isCategories && editing && (
          <section className="category-product-manager">
            <h3>Sản phẩm trong nhóm ({categoryProducts.filter((item) => item.selected).length})</h3>
            <div className="selected-tags taxonomy-choices">
              {categoryProducts.map((product) => (
                <label key={product.id} className="tag-choice">
                  <input
                    type="checkbox"
                    checked={Boolean(product.selected)}
                    onChange={(event) =>
                      setCategoryProducts((current) => current.map((item) =>
                        item.id === product.id ? { ...item, selected: event.target.checked } : item,
                      ))
                    }
                  />
                  {product.name}
                </label>
              ))}
            </div>
          </section>
        )}
        <div className="editor-heading">
          <span>{message}</span>
          <div>
            {isCategories && editing?.isActive ? (
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  if (busy) return;
                  if (!window.confirm(`Ẩn nhóm "${editing.name}"? Quan hệ sản phẩm sẽ được giữ nguyên.`)) return;
                  setBusy(true);
                  setMessage("Đang ẩn danh mục...");
                  try {
                    const response = await fetch(`/api/admin/categories/${editing.id}`, { method: "DELETE" });
                    if (!response.ok) {
                      const body = (await response.json().catch(() => ({}))) as {
                        error?: { message?: string };
                      };
                      setMessage(body.error?.message ?? "Chưa thể ẩn danh mục.");
                      return;
                    }
                    setEditing(null);
                    setCategoryProducts([]);
                    await loadRows();
                    setMessage("Đã ẩn danh mục.");
                  } catch {
                    setMessage("Chưa thể ẩn danh mục. Vui lòng thử lại.");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                ẨN DANH MỤC
              </button>
            ) : null}
            {editing ? (
              <button
                className="taxonomy-delete-btn"
                type="button"
                disabled={busy}
                onClick={() => void deleteTaxonomyRow()}
              >
                <Icon>delete</Icon> XÓA VĨNH VIỄN
              </button>
            ) : null}
            <button className="btn primary" type="submit" disabled={busy}>
              <Icon>save</Icon> {busy ? "ĐANG XỬ LÝ..." : "LƯU"}
            </button>
          </div>
        </div>
      </form>
    </AdminShell>
  );
}

function formatCronHealthMetric(value: number | null | undefined, suffix = "") {
  return typeof value === "number" ? `${value}${suffix}` : "—";
}

function CronHealthCard({
  data,
  unavailable,
  refresh,
}: {
  data: CronHealthData;
  unavailable: boolean;
  refresh: () => void;
}) {
  const lastRun = data.lastRun;
  return (
    <section className="editor-card settings-card cron-health-card">
      <div className="editor-card-title cron-health-card-title">
        <span>
          <Icon>monitor_heart</Icon>
          <h2>Tình trạng tác vụ giữ hàng</h2>
        </span>
        <span className={`cron-health-status cron-health-status-${data.health.toLowerCase()}`}>
          {CRON_HEALTH_LABELS[data.health]}
        </span>
      </div>
      <p>
        Theo dõi lần chạy gần nhất của tác vụ giải phóng reservation đã hết hạn.
        Trang này chỉ đọc trạng thái và không kích hoạt cleanup.
      </p>
      {unavailable && (
        <p className="cron-health-unavailable">
          Chưa tải được dữ liệu trạng thái. Vui lòng thử lại.
        </p>
      )}
      <dl className="cron-health-metrics">
        <div>
          <dt>Lần chạy gần nhất</dt>
          <dd>{formatCronHealthTimestamp(data.lastAttemptAt)}</dd>
        </div>
        <div>
          <dt>Lần thành công gần nhất</dt>
          <dd>{formatCronHealthTimestamp(data.lastSuccessAt)}</dd>
        </div>
        <div>
          <dt>Bản ghi kiểm tra</dt>
          <dd>{formatCronHealthMetric(lastRun?.candidateCount)}</dd>
        </div>
        <div>
          <dt>Đã giải phóng</dt>
          <dd>{formatCronHealthMetric(lastRun?.releasedCount)}</dd>
        </div>
        <div>
          <dt>Bản ghi lỗi</dt>
          <dd>{formatCronHealthMetric(lastRun?.failedCount)}</dd>
        </div>
        <div>
          <dt>Thời gian xử lý</dt>
          <dd>{formatCronHealthMetric(lastRun?.durationMs, " ms")}</dd>
        </div>
        <div>
          <dt>Lịch chạy</dt>
          <dd>{data.schedule} (mỗi phút)</dd>
        </div>
      </dl>
      <button className="btn secondary-btn" type="button" onClick={refresh}>
        <Icon>refresh</Icon> Làm mới trạng thái
      </button>
    </section>
  );
}

export function AdminSettingsPage() {
  const [seller, setSeller] = useState({
    displayName: "",
    label: "Người bán BabyJoy",
    messengerUrl: "",
    avatarKey: "",
    avatarUrl: "",
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [storefrontTtlDays, setStorefrontTtlDays] = useState("15");
  const [storefrontTtlBusy, setStorefrontTtlBusy] = useState(false);
  const [storefrontTtlMessage, setStorefrontTtlMessage] = useState("");
  const [storefrontTtlError, setStorefrontTtlError] = useState("");
  const [checkoutReservationMinutes, setCheckoutReservationMinutes] = useState(
    String(DEFAULT_CHECKOUT_RESERVATION_MINUTES),
  );
  const [checkoutReservationBusy, setCheckoutReservationBusy] = useState(false);
  const [checkoutReservationMessage, setCheckoutReservationMessage] = useState("");
  const [checkoutReservationError, setCheckoutReservationError] = useState("");
  const avatarInput = useRef<HTMLInputElement>(null);
  const cronHealth = useAdminCronHealth();
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/admin/settings/seller")
      .then(async (response) => {
        if (!response.ok) throw new Error("SETTINGS_LOAD_FAILED");
        return response.json() as Promise<{
          data: {
            displayName: string;
            label: string;
            messengerUrl: string;
            avatarKey: string | null;
            avatarUrl: string | null;
          };
        }>;
      })
      .then((body) => {
        if (!cancelled)
          setSeller({
            ...body.data,
            avatarKey: body.data.avatarKey ?? "",
            avatarUrl: body.data.avatarUrl ?? "",
          });
      })
      .catch(() => {
        if (!cancelled) setError("Không tải được cấu hình người bán từ D1.");
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/admin/settings/checkout")
      .then(async (response) => {
        if (!response.ok) throw new Error("CHECKOUT_SETTINGS_LOAD_FAILED");
        return response.json() as Promise<{
          data?: { checkoutReservationMinutes?: number };
        }>;
      })
      .then((body) => {
        const minutes = body.data?.checkoutReservationMinutes;
        if (!cancelled && typeof minutes === "number")
          setCheckoutReservationMinutes(String(minutes));
      })
      .catch(() => {
        if (!cancelled)
          setCheckoutReservationError("Không tải được thời gian giữ hàng.");
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/admin/settings")
      .then(async (response) => {
        if (!response.ok) throw new Error("STOREFRONT_SETTINGS_LOAD_FAILED");
        return response.json() as Promise<{
          data?: { storefrontSessionTtlSeconds?: number };
        }>;
      })
      .then((body) => {
        const seconds = body.data?.storefrontSessionTtlSeconds;
        if (!cancelled && typeof seconds === "number")
          setStorefrontTtlDays(String(seconds / 86400));
      })
      .catch(() => {
        if (!cancelled)
          setStorefrontTtlError("Không tải được thời hạn session storefront.");
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const uploadAvatar = async (file: File) => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/images", {
        method: "POST",
        headers: { "content-type": file.type },
        body: file,
      });
      const body = (await response.json()) as {
        key?: string;
        url?: string;
        error?: { message?: string };
      };
      if (!response.ok || !body.key)
        throw new Error(body.error?.message || "Chưa thể tải ảnh đại diện.");
      setSeller((current) => ({
        ...current,
        avatarKey: body.key ?? "",
        avatarUrl: body.url ?? "",
      }));
      setMessage("Ảnh đã tải lên. Hãy lưu cài đặt để áp dụng.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Chưa thể tải ảnh.");
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/settings/seller", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName: seller.displayName,
          label: seller.label,
          messengerUrl: seller.messengerUrl,
          avatarKey: seller.avatarKey || null,
        }),
      });
      const body = (await response.json()) as {
        data?: typeof seller;
        error?: { message?: string };
      };
      if (!response.ok)
        throw new Error(body.error?.message || "Chưa thể lưu cài đặt.");
      if (body.data)
        setSeller({
          ...body.data,
          avatarKey: body.data.avatarKey ?? "",
          avatarUrl: body.data.avatarUrl ?? "",
        });
      setMessage("Đã lưu liên hệ người bán.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Chưa thể lưu cài đặt.");
    } finally {
      setBusy(false);
    }
  };
  const saveStorefrontTtl = async () => {
    setStorefrontTtlBusy(true);
    setStorefrontTtlError("");
    setStorefrontTtlMessage("");
    try {
      const days = Number(storefrontTtlDays);
      if (!Number.isFinite(days) || days < 1 / 24 || days > 365)
        throw new Error("Thời hạn phải từ 1 giờ đến 365 ngày.");
      const response = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          storefrontSessionTtlSeconds: Math.round(days * 86400),
        }),
      });
      if (!response.ok) {
        const body = (await response.json()) as {
          error?: { message?: string };
        };
        throw new Error(body.error?.message || "Chưa thể lưu thời hạn session.");
      }
      setStorefrontTtlMessage("Đã lưu. Chỉ session cấp mới sẽ dùng TTL này.");
    } catch (caught) {
      setStorefrontTtlError(
        caught instanceof Error ? caught.message : "Chưa thể lưu thời hạn session.",
      );
    } finally {
      setStorefrontTtlBusy(false);
    }
  };
  const saveCheckoutReservation = async () => {
    setCheckoutReservationBusy(true);
    setCheckoutReservationError("");
    setCheckoutReservationMessage("");
    const minutes = Number(checkoutReservationMinutes);
    if (!Number.isSafeInteger(minutes)) {
      setCheckoutReservationError("Thời gian giữ hàng phải là số phút nguyên.");
      setCheckoutReservationBusy(false);
      return;
    }
    if (minutes < MIN_CHECKOUT_RESERVATION_MINUTES) {
      setCheckoutReservationError("Thời gian giữ hàng tối thiểu là 3 phút.");
      setCheckoutReservationBusy(false);
      return;
    }
    if (minutes > MAX_CHECKOUT_RESERVATION_MINUTES) {
      setCheckoutReservationError("Thời gian giữ hàng tối đa là 24 giờ.");
      setCheckoutReservationBusy(false);
      return;
    }
    try {
      const response = await fetch("/api/admin/settings/checkout", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ checkoutReservationMinutes: minutes }),
      });
      const body = (await response.json()) as {
        data?: { checkoutReservationMinutes?: number };
        error?: { message?: string };
      };
      if (!response.ok)
        throw new Error(body.error?.message || "Chưa thể lưu thời gian giữ hàng.");
      if (typeof body.data?.checkoutReservationMinutes === "number")
        setCheckoutReservationMinutes(String(body.data.checkoutReservationMinutes));
      setCheckoutReservationMessage("Đã lưu. Chỉ reservation mới dùng thời gian này.");
    } catch (caught) {
      setCheckoutReservationError(
        caught instanceof Error ? caught.message : "Chưa thể lưu thời gian giữ hàng.",
      );
    } finally {
      setCheckoutReservationBusy(false);
    }
  };
  return (
    <AdminShell title="Cài Đặt">
      <div className="admin-page-heading">
        <div>
          <h1>Cài đặt</h1>
          <p>Cấu hình thông tin công khai của BabyJoy.</p>
        </div>
      </div>
      <section className="editor-card settings-card">
        <div className="editor-card-title">
          <span>
            <Icon>store</Icon>
            <h2>Thông tin cửa hàng</h2>
          </span>
        </div>
        <label>
          Tên hiển thị
          <input defaultValue="BabyJoy" />
        </label>
        <label>
          Email liên hệ
          <input defaultValue="hello@babyjoy.vn" />
        </label>
        <label>
          Số điện thoại
          <input defaultValue="1900 123 456" />
        </label>
        <p>
          Credential kết nối Messenger được quản lý bằng Cloudflare Secret,
          không hiển thị tại đây.
        </p>
        <button className="btn primary">
          <Icon>save</Icon> LƯU CÀI ĐẶT
        </button>
      </section>
      <section className="editor-card settings-card storefront-settings-card">
        <div className="editor-card-title">
          <span>
            <Icon>lock_clock</Icon>
            <h2>Quyền truy cập storefront</h2>
          </span>
        </div>
        <p>
          Session mặc định có thời hạn cố định và không tự gia hạn khi khách
          quay lại website. TTL riêng của từng link có thể đặt tại Link truy cập.
        </p>
        <label>
          Thời hạn session mặc định (ngày)
          <input
            type="number"
            min="0.0416667"
            max="365"
            step="0.0416667"
            value={storefrontTtlDays}
            onChange={(event) => setStorefrontTtlDays(event.target.value)}
          />
        </label>
        {storefrontTtlError && <p className="form-error">{storefrontTtlError}</p>}
        {storefrontTtlMessage && <p className="form-success">{storefrontTtlMessage}</p>}
        <button
          className="btn primary"
          disabled={storefrontTtlBusy}
          onClick={() => void saveStorefrontTtl()}
        >
          <Icon>save</Icon> {storefrontTtlBusy ? "ĐANG LƯU..." : "LƯU THỜI HẠN SESSION"}
        </button>
      </section>
      <section className="editor-card settings-card checkout-reservation-settings-card">
        <div className="editor-card-title">
          <span>
            <Icon>inventory_2</Icon>
            <h2>Giữ hàng khi gửi Messenger</h2>
          </span>
        </div>
        <p>
          Khoảng thời gian sản phẩm và ưu đãi được giữ cho khách sau khi khách bấm gửi
          giỏ hàng qua Messenger. Nếu shop chưa xác nhận trước khi hết thời gian này,
          đơn sẽ tự hết hạn và hàng được trả lại để khách khác có thể mua.
        </p>
        <label>
          Thời gian giữ hàng &amp; ưu đãi (phút)
          <input
            type="number"
            min={MIN_CHECKOUT_RESERVATION_MINUTES}
            max={MAX_CHECKOUT_RESERVATION_MINUTES}
            step="1"
            value={checkoutReservationMinutes}
            onChange={(event) => setCheckoutReservationMinutes(event.target.value)}
          />
        </label>
        <small>Mặc định: {formatReservationDuration(DEFAULT_CHECKOUT_RESERVATION_MINUTES)}. Tương đương: {formatReservationDuration(Number(checkoutReservationMinutes))}.</small>
        {Number(checkoutReservationMinutes) > 60 && (
          <p className="settings-warning">
            Thời gian giữ hàng dài có thể làm giảm số lượng sản phẩm khả dụng cho khách khác.
          </p>
        )}
        {Number(checkoutReservationMinutes) >= 720 && (
          <p className="share-warning">
            Bạn đang giữ hàng trong thời gian dài. Các sản phẩm được khách gửi Messenger có thể bị khóa tồn kho đến khi shop xác nhận hoặc hết hạn.
          </p>
        )}
        {checkoutReservationError && <p className="form-error">{checkoutReservationError}</p>}
        {checkoutReservationMessage && <p className="form-success">{checkoutReservationMessage}</p>}
        <button
          className="btn primary"
          disabled={checkoutReservationBusy}
          onClick={() => void saveCheckoutReservation()}
        >
          <Icon>save</Icon> {checkoutReservationBusy ? "ĐANG LƯU..." : "LƯU THỜI GIAN GIỮ HÀNG"}
        </button>
      </section>
      <CronHealthCard {...cronHealth} />
      <section className="editor-card settings-card seller-settings-card">
        <div className="editor-card-title">
          <span>
            <Icon>support_agent</Icon>
            <h2>Liên hệ người bán</h2>
          </span>
        </div>
        <p>Một liên hệ mặc định được hiển thị cho mọi giỏ hàng BabyJoy.</p>
        <div className="seller-settings-avatar">
          {seller.avatarUrl ? (
            <img src={seller.avatarUrl} alt="Ảnh đại diện người bán" />
          ) : (
            <span><Icon>person</Icon></span>
          )}
          <div>
            <button
              className="btn secondary-btn"
              disabled={busy}
              onClick={() => avatarInput.current?.click()}
            >
              TẢI ẢNH TỪ MÁY
            </button>
            <input
              ref={avatarInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadAvatar(file);
              }}
            />
          </div>
        </div>
        <label>
          Tên hiển thị
          <input
            value={seller.displayName}
            onChange={(event) => setSeller({ ...seller, displayName: event.target.value })}
            placeholder="Nguyễn A"
          />
        </label>
        <label>
          Nhãn
          <input
            value={seller.label}
            onChange={(event) => setSeller({ ...seller, label: event.target.value })}
            placeholder="Người bán BabyJoy"
          />
        </label>
        <label>
          Messenger URL
          <input
            value={seller.messengerUrl}
            onChange={(event) => setSeller({ ...seller, messengerUrl: event.target.value })}
            placeholder="https://m.me/nguyena"
            inputMode="url"
          />
        </label>
        <label>
          Khóa ảnh R2 hiện có (không bắt buộc)
          <input
            value={seller.avatarKey}
            onChange={(event) => setSeller({ ...seller, avatarKey: event.target.value })}
            placeholder="products/2026-08-28/...webp"
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        {message && <p className="form-success">{message}</p>}
        <div className="seller-settings-actions">
          <button className="btn primary" disabled={busy} onClick={() => void save()}>
            <Icon>save</Icon> {busy ? "ĐANG LƯU..." : "LƯU LIÊN HỆ NGƯỜI BÁN"}
          </button>
          {seller.messengerUrl.startsWith("https://m.me/") && (
            <a className="btn secondary-btn" href={seller.messengerUrl} target="_blank" rel="noreferrer">
              <Icon>open_in_new</Icon> MỞ THỬ MESSENGER
            </a>
          )}
        </div>
      </section>
    </AdminShell>
  );
}
