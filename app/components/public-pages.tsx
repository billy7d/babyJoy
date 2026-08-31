import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import {
  findVariantInProducts,
  formatVnd,
  getDefaultVariant,
  getDisplayVariant,
  getVariantAvailableQuantity,
  isVariantPurchasable,
  type Category,
  type Product,
} from "../lib/catalog";
import {
  loadProductBySlug,
  loadProductPage,
  ProductNotFoundError,
  type ProductPageResult,
  useCatalog,
} from "../lib/catalog-context";
import { cartStorageKey, parseStoredCart, useCart } from "../lib/cart";
import {
  useCartPromotionEvaluation,
  type CartPromotionResult,
} from "../lib/promotions";
import {
  cartFingerprint,
  clearPendingMessengerCart,
  getMessengerSubmissionToken,
  readPendingMessengerCart,
  writePendingMessengerCart,
  type PendingMessengerCart,
} from "../lib/messenger-checkout";
import {
  cartShareFingerprint,
  clearPreparedCartShare,
  copyCartText,
  getCartShareSubmissionToken,
  recordSellerMessengerOpened,
  readPreparedCartShare,
  runWithCurrentPreparedCartShare,
  writePreparedCartShare,
  type PreparedCartShare,
  type SellerContact,
} from "../lib/cart-share";
import { searchCatalog } from "../lib/search";
import { STORE_BRAND } from "../../shared/branding";
import { getPaginationItems } from "../../shared/pagination";
import {
  DEFAULT_CHECKOUT_RESERVATION_MINUTES,
  formatReservationDuration,
} from "../../shared/reservation";
import { ProductImage } from "./product-image";
import {
  cartDetails,
  Icon,
  Price,
  ProductCard,
  PublicShell,
  QuantityStepper,
  Tag,
} from "./ui";

export function HomePage() {
  const { products, categories } = useCatalog();
  const bestSellers = products
    .filter((product) => product.isBestSeller)
    .sort(
      (left, right) =>
        (left.bestSellerRank ?? Number.MAX_SAFE_INTEGER) -
        (right.bestSellerRank ?? Number.MAX_SAFE_INTEGER),
    );
  const featured = (bestSellers.length
    ? bestSellers
    : products.filter((product) => product.featured)
  ).slice(0, 4);
  return (
    <PublicShell>
      <section className="hero">
        <picture>
          <source media="(max-width: 639px)" srcSet="/images/hero-mobile.jpg" />
          <img src="/images/hero-desktop.jpg" alt="Bé vui vẻ bên món ăn dặm" />
        </picture>
        <div className="hero-shade" />
        <div className="hero-content">
          <Tag>Dinh dưỡng trọn vẹn</Tag>
          <h1>
            Món ngon cho bé,
            <br />
            mẹ an tâm
          </h1>
          <p className="hero-desktop-copy">
            Khám phá thế giới dinh dưỡng sạch, an toàn và đa dạng. Cùng {STORE_BRAND}{" "}
            kiến tạo những bữa ăn dặm đầy niềm vui và phát triển toàn diện cho
            bé yêu của bạn.
          </p>
          <p className="hero-mobile-copy">
            Dinh dưỡng khởi đầu hoàn hảo, với nguyên liệu hữu cơ an toàn cho hệ
            tiêu hóa non nớt.
          </p>
          <div>
            <Link className="btn primary" to="/shop">
              Xem sản phẩm <Icon>arrow_forward</Icon>
            </Link>
            <Link className="btn secondary-btn" to="/categories">
              Xem danh mục
            </Link>
          </div>
        </div>
      </section>
      <section className="mobile-categories section">
        <div className="section-heading">
          <h2>Danh mục dinh dưỡng</h2>
          <Link to="/categories">
            Xem tất cả <Icon>arrow_forward</Icon>
          </Link>
        </div>
        <div className="category-row">
          {categories.map((category) => (
            <Link key={category.id} to={`/category/${category.slug}`}>
              <img src={category.image} alt="" />
              <span>{category.name}</span>
            </Link>
          ))}
        </div>
      </section>
      <section className="journey section">
        <div className="center-heading">
          <h2>Hành trình ăn dặm dễ dàng</h2>
          <p>
            Chỉ với 3 bước đơn giản để mang bữa ăn ngon lành đến cho bé yêu.
          </p>
        </div>
        <div className="journey-grid">
          {[
            [
              "01",
              "search",
              "Chọn sản phẩm",
              "Khám phá đa dạng các loại bột, bánh ăn dặm hữu cơ, giàu dinh dưỡng phù hợp với từng giai đoạn của bé.",
            ],
            [
              "02",
              "shopping_cart",
              "Thêm vào giỏ",
              "Lựa chọn số lượng và thêm vào giỏ hàng những sản phẩm mẹ ưng ý nhất cho thực đơn của bé.",
            ],
            [
              "03",
              "send",
              "Gửi cho người bán",
              "Kiểm tra tạm tính và gửi giỏ hàng để người bán liên hệ xác nhận.",
            ],
          ].map(([number, icon, title, text]) => (
            <article key={number}>
              <div className="step-icon">
                <Icon>{icon}</Icon>
              </div>
              <b>{number}</b>
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="featured section">
        <div className="section-heading">
          <div>
            <h2>{bestSellers.length ? "Best seller" : "Sản phẩm nổi bật"}</h2>
            <p>Những hương vị được các bé yêu thích nhất.</p>
          </div>
          <Link to="/shop">
            Xem tất cả <Icon>arrow_forward</Icon>
          </Link>
        </div>
        <div className="product-grid">
          {products.length === 0 ? (
            <div className="empty-state product-empty-state">
              <Icon>inventory_2</Icon>
              <h2>Chưa có sản phẩm</h2>
              <p>{STORE_BRAND} đang chuẩn bị danh sách sản phẩm mới.</p>
              <Link className="btn primary" to="/shop">
                Xem cửa hàng
              </Link>
            </div>
          ) : (
            featured.map((product) => (
              <ProductCard key={product.id} product={product} compact />
            ))
          )}
        </div>
      </section>
    </PublicShell>
  );
}

export function applyFilters(
  source: Product[],
  categories: Category[],
  params: URLSearchParams,
  forcedCategory?: string,
) {
  const q = params.get("q") ?? "";
  const selectedCategories = (forcedCategory ?? params.get("category") ?? "")
    .split(",")
    .filter(Boolean);
  const selectedBrands = (params.get("brand") ?? "").split(",").filter(Boolean);
  const age = Number.parseInt(params.get("age") ?? "", 10);
  const bestSeller = params.get("bestSeller") === "1";
  const tag = params.get("tag");
  const available = params.get("available");
  const sort = params.get("sort") ?? "default";
  const searchSource = q
    ? searchCatalog(source, categories, q).products
    : source;
  const filtered = searchSource.filter((product) => {
    const productMinAge =
      product.minAgeMonths ?? Number.parseInt(product.age, 10);
    return (
      (!selectedCategories.length ||
        selectedCategories.some((category) =>
          (product.categories ?? [product.category]).includes(category),
        )) &&
      (!selectedBrands.length ||
        selectedBrands.some(
          (brand) => product.brandSlug === brand || product.brand === brand,
        )) &&
      (!Number.isFinite(age) ||
        (Number.isFinite(productMinAge) && productMinAge <= age)) &&
      (!bestSeller || product.isBestSeller) &&
      (!tag || product.tags.includes(tag) || product.tagSlugs?.includes(tag)) &&
      (!available ||
        product.variants.some(
          (variant) => variant.availability === "AVAILABLE",
        ))
    );
  });
  return filtered.sort((a, b) => {
    const aPrice = getDisplayVariant(a)?.priceVnd ?? Number.MAX_SAFE_INTEGER;
    const bPrice = getDisplayVariant(b)?.priceVnd ?? Number.MAX_SAFE_INTEGER;
    if (sort === "price_asc") return aPrice - bPrice;
    if (sort === "price_desc") return bPrice - aPrice;
    if (sort === "newest") return b.id.localeCompare(a.id);
    if (sort === "best_seller")
      return (
        (a.bestSellerRank ?? Number.MAX_SAFE_INTEGER) -
        (b.bestSellerRank ?? Number.MAX_SAFE_INTEGER)
      );
    return 0;
  });
}

export function ProductListPage({
  searchMode = false,
  categorySlug,
}: {
  searchMode?: boolean;
  categorySlug?: string;
}) {
  const { categories, brands, tagOptions, mergeProducts } = useCatalog();
  const [params, setParams] = useSearchParams();
  const [mobileFilters, setMobileFilters] = useState(false);
  const [listing, setListing] = useState<ProductPageResult | null>(null);
  const [loadError, setLoadError] = useState("");
  const queryKey = params.toString();
  useEffect(() => {
    let cancelled = false;
    setListing(null);
    setLoadError("");
    void loadProductPage(new URLSearchParams(queryKey), categorySlug)
      .then((result) => {
        if (cancelled) return;
        mergeProducts(result.products);
        setListing(result);
        const requestedPage = Number(new URLSearchParams(queryKey).get("page"));
        const normalizedRequestedPage =
          Number.isSafeInteger(requestedPage) && requestedPage >= 1
            ? requestedPage
            : 1;
        if (result.pagination.page !== normalizedRequestedPage) {
          const canonicalParams = new URLSearchParams(queryKey);
          canonicalParams.set("page", String(result.pagination.page));
          setParams(canonicalParams, { replace: true });
        }
      })
      .catch(() => {
        if (!cancelled) setLoadError("Không tải được danh sách sản phẩm từ D1.");
      });
    return () => {
      cancelled = true;
    };
  }, [categorySlug, mergeProducts, queryKey, setParams]);

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    // Mọi thay đổi bộ lọc/sort phải quay về trang đầu của tập kết quả mới.
    next.set("page", "1");
    setParams(next);
  };
  const setPage = (page: number) => {
    const next = new URLSearchParams(params);
    next.set("page", String(page));
    setParams(next);
  };
  const toggleCsvFilter = (key: "category" | "brand", value: string) => {
    const selected = new Set((params.get(key) ?? "").split(",").filter(Boolean));
    if (selected.has(value)) selected.delete(value);
    else selected.add(value);
    setFilter(key, [...selected].join(","));
  };
  const title = searchMode
    ? `Kết quả tìm kiếm${params.get("q") ? ` cho “${params.get("q")}”` : ""}`
    : categorySlug
      ? (categories.find((item) => item.slug === categorySlug)?.name ??
        "Sản phẩm ăn dặm")
      : "Sản phẩm ăn dặm";
  const totalItems = listing?.pagination.totalItems ?? 0;
  const hasFilters = Boolean(
    categorySlug ||
      params.get("q") ||
      params.get("category") ||
      params.get("brand") ||
      params.get("age") ||
      params.get("bestSeller") ||
      params.get("tag") ||
      params.get("available"),
  );
  const filters = (
    <div className="filters-inner">
      <h3>Danh mục</h3>
      {categories.map((item) => (
        <label key={item.id}>
          <input
            type="checkbox"
            name="category"
            checked={(categorySlug
              ? [categorySlug]
              : (params.get("category") ?? "").split(",")
            ).includes(item.slug)}
            disabled={Boolean(categorySlug)}
            onChange={() => toggleCsvFilter("category", item.slug)}
          />
          {item.name}
        </label>
      ))}
      <h3>Độ tuổi</h3>
      {["6", "7", "10", "12"].map((item) => (
        <label key={item}>
          <input
            type="radio"
            name="age"
            checked={params.get("age") === item}
            onChange={() => setFilter("age", item)}
          />
          {item}m+
        </label>
      ))}
      <h3>Thương hiệu</h3>
      {brands.map((item) => (
        <label key={item.id}>
          <input
            type="checkbox"
            name="brand"
            checked={(params.get("brand") ?? "").split(",").includes(item.slug)}
            onChange={() => toggleCsvFilter("brand", item.slug)}
          />
          {item.name}
        </label>
      ))}
      <h3>Best seller</h3>
      <label>
        <input
          type="checkbox"
          checked={params.get("bestSeller") === "1"}
          onChange={(event) =>
            setFilter("bestSeller", event.target.checked ? "1" : "")
          }
        />
        Chỉ xem Best seller
      </label>
      <h3>Đặc tính</h3>
      <div className="filter-tags">
        {/* Chỉ hiển thị tag active do D1 trả về để tag đã xóa không còn trong filter. */}
        {tagOptions.map((item) => (
          <button
            className={params.get("tag") === item.slug ? "active" : ""}
            key={item.slug}
            onClick={() =>
              setFilter("tag", params.get("tag") === item.slug ? "" : item.slug)
            }
          >
            {item.name}
          </button>
        ))}
      </div>
      <h3>Tình trạng</h3>
      <label>
        <input
          type="checkbox"
          checked={params.get("available") === "1"}
          onChange={(event) =>
            setFilter("available", event.target.checked ? "1" : "")
          }
        />
        Còn hàng
      </label>
      <button
        className="clear-filter"
        onClick={() => setParams(new URLSearchParams("page=1"))}
      >
        Xóa bộ lọc
      </button>
    </div>
  );
  return (
    <PublicShell>
      <div className="listing-shell">
        <div className="breadcrumbs">
          Trang chủ <Icon>chevron_right</Icon> Sản phẩm
        </div>
        <div className="listing-title">
          <div>
            <h1>{title}</h1>
            <p>{listing ? `${totalItems} sản phẩm dinh dưỡng cho bé` : "Đang tải sản phẩm…"}</p>
          </div>
          <button
            className="mobile-filter-btn"
            onClick={() => setMobileFilters(true)}
          >
            <Icon>tune</Icon> Bộ lọc
          </button>
          <label className="sort">
            Sắp xếp theo:{" "}
            <select
              value={params.get("sort") ?? "default"}
              onChange={(event) => setFilter("sort", event.target.value)}
            >
              <option value="default">Mặc định</option>
              <option value="newest">Mới nhất</option>
              <option value="price_asc">Giá thấp đến cao</option>
              <option value="price_desc">Giá cao đến thấp</option>
              <option value="best_seller">Best seller</option>
            </select>
          </label>
        </div>
        <div className="mobile-category-chips">
          <button
            className={!categorySlug && !params.get("category") ? "active" : ""}
            onClick={() => setFilter("category", "")}
          >
            Tất cả
          </button>
          {categories.map((item) => (
            <button
              key={item.id}
              className={(categorySlug
                ? categorySlug === item.slug
                : (params.get("category") ?? "").split(",").includes(item.slug))
                ? "active"
                : ""}
              onClick={() => toggleCsvFilter("category", item.slug)}
            >
              {item.name}
            </button>
          ))}
        </div>
        <div className="mobile-list-status">
          <span>
            {listing ? `Hiển thị ${totalItems} sản phẩm` : "Đang tải sản phẩm…"}
          </span>
          <button
            onClick={() =>
              setFilter(
                "sort",
                params.get("sort") === "price_asc" ? "price_desc" : "price_asc",
              )
            }
          >
            <Icon>sort</Icon> Sắp xếp
          </button>
        </div>
        <div className="listing-content">
          <aside className="filter-sidebar">{filters}</aside>
          <div className="listing-products">
            {listing?.products.length ? (
              <div className="product-grid listing-grid">
                {listing.products.map((product) => (
                  <ProductCard key={product.id} product={product} />
                ))}
              </div>
            ) : listing && !loadError ? (
              <div className="empty-state product-empty-state">
                <Icon>{hasFilters ? "search_off" : "inventory_2"}</Icon>
                <h2>{hasFilters ? "Không tìm thấy sản phẩm phù hợp" : "Chưa có sản phẩm"}</h2>
                <p>
                  {hasFilters
                    ? "Hãy thử từ khóa hoặc bộ lọc khác."
                    : `${STORE_BRAND} đang chuẩn bị danh sách sản phẩm mới.`}
                </p>
              </div>
            ) : loadError ? (
              <div className="empty-state product-empty-state" role="alert">
                <Icon>error</Icon>
                <h2>Không thể tải sản phẩm</h2>
                <p>{loadError}</p>
              </div>
            ) : (
              <div className="empty-state product-empty-state" role="status">
                <Icon>progress_activity</Icon>
                <h2>Đang tải sản phẩm…</h2>
              </div>
            )}
            {listing && listing.pagination.totalPages > 1 && !loadError && (
              <nav className="pagination" aria-label="Phân trang">
                <button
                  type="button"
                  disabled={!listing.pagination.hasPrevious}
                  onClick={() => setPage(listing.pagination.page - 1)}
                  aria-label="Trang trước"
                >
                  ‹
                </button>
                {getPaginationItems(
                  listing.pagination.page,
                  listing.pagination.totalPages,
                ).map((item, index) =>
                  item === "ellipsis" ? (
                    <span key={`ellipsis-${index}`} aria-hidden="true">
                      …
                    </span>
                  ) : (
                    <button
                      type="button"
                      key={item}
                      className={
                        item === listing.pagination.page ? "active" : ""
                      }
                      aria-current={
                        item === listing.pagination.page ? "page" : undefined
                      }
                      aria-label={`Trang ${item}`}
                      onClick={() => setPage(item)}
                    >
                      {item}
                    </button>
                  ),
                )}
                <button
                  type="button"
                  disabled={!listing.pagination.hasNext}
                  onClick={() => setPage(listing.pagination.page + 1)}
                  aria-label="Trang sau"
                >
                  ›
                </button>
              </nav>
            )}
          </div>
        </div>
      </div>
      {mobileFilters && (
        <div
          className="filter-sheet"
          role="dialog"
          aria-modal="true"
          aria-label="Bộ lọc"
        >
          <button
            className="sheet-close"
            onClick={() => setMobileFilters(false)}
          >
            <Icon>close</Icon>
          </button>
          <h2>Bộ lọc</h2>
          {filters}
          <button
            className="btn primary sheet-apply"
            onClick={() => setMobileFilters(false)}
          >
            Áp dụng
          </button>
        </div>
      )}
    </PublicShell>
  );
}

export function CategoriesPage() {
  const { categories } = useCatalog();
  return (
    <PublicShell>
      <section className="categories-page section">
        <h1>Danh mục dinh dưỡng</h1>
        <p>Khám phá sản phẩm phù hợp với từng bữa ăn của bé.</p>
        <div className="category-overview">
          {categories.map((category) => (
            <Link key={category.id} to={`/category/${category.slug}`}>
              <img src={category.image} alt={category.name} />
              <h2>{category.name}</h2>
              <span>
                Xem sản phẩm <Icon>arrow_forward</Icon>
              </span>
            </Link>
          ))}
        </div>
      </section>
    </PublicShell>
  );
}

export function ProductDetailPage() {
  const { mergeProducts } = useCatalog();
  const location = useLocation();
  const slug = decodeURIComponent(
    location.pathname.split("/").filter(Boolean).at(-1) ?? "",
  );
  const [product, setProduct] = useState<Product | null>(null);
  const [detailError, setDetailError] = useState<"not-found" | "load" | "">("");
  const [loading, setLoading] = useState(true);
  const [variantId, setVariantId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [toast, setToast] = useState(false);
  const [selectedImage, setSelectedImage] = useState(0);
  const { addItem } = useCart();
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setProduct(null);
    setDetailError("");
    void loadProductBySlug(slug)
      .then((loadedProduct) => {
        if (cancelled) return;
        mergeProducts([loadedProduct]);
        setProduct(loadedProduct);
      })
      .catch((caught) => {
        if (cancelled) return;
        setDetailError(
          caught instanceof ProductNotFoundError ? "not-found" : "load",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mergeProducts, slug]);
  useEffect(() => {
    setVariantId(product ? getDefaultVariant(product)?.id ?? "" : "");
    setQuantity(1);
    setSelectedImage(0);
  }, [product]);
  if (loading) {
    return (
      <PublicShell hideMobileNav>
        <section className="empty-state" role="status">
          <Icon>progress_activity</Icon>
          <h1>Đang tải sản phẩm…</h1>
        </section>
      </PublicShell>
    );
  }
  if (detailError || !product) {
    return (
      <PublicShell hideMobileNav>
        <section className="empty-state" role={detailError === "load" ? "alert" : undefined}>
          <Icon>{detailError === "load" ? "error" : "inventory_2"}</Icon>
          <h1>
            {detailError === "not-found"
              ? "Không tìm thấy sản phẩm"
              : detailError === "load"
                ? "Không thể tải sản phẩm"
                : "Chưa có sản phẩm"}
          </h1>
          <p>
            {detailError === "not-found"
              ? "Sản phẩm có thể đã được gỡ khỏi danh sách."
              : detailError === "load"
                ? "Vui lòng thử lại sau."
                : `${STORE_BRAND} đang chuẩn bị danh sách sản phẩm mới.`}
          </p>
          <Link className="btn primary" to="/shop">
            Về cửa hàng
          </Link>
        </section>
      </PublicShell>
    );
  }
  const variant =
    product.variants.find((item) => item.id === variantId) ??
    getDefaultVariant(product);
  const variantPurchasable = Boolean(variant && isVariantPurchasable(variant));
  const productImages = product.images?.length
    ? product.images
    : [
        { r2Key: "", altText: product.name, sortOrder: 0, url: product.image },
        {
          r2Key: "",
          altText: `${product.name} - ảnh phụ`,
          sortOrder: 1,
          url: "/images/featured-puree.jpg",
        },
        {
          r2Key: "",
          altText: `${product.name} - ảnh phụ`,
          sortOrder: 2,
          url: "/images/category-puree.jpg",
        },
      ];
  const add = () => {
    if (!variant || !isVariantPurchasable(variant)) return;
    addItem(variant.id, quantity, product);
    setToast(true);
    window.setTimeout(() => setToast(false), 2200);
  };
  return (
    <PublicShell hideMobileNav>
      <div className="mobile-detail-header">
        <Link to="/shop">
          <Icon>arrow_back_ios_new</Icon>
        </Link>
        <strong>Chi Tiết Món Ăn</strong>
      </div>
      <article className="detail-page">
        <div className="detail-gallery">
          <ProductImage
            className="detail-main-image"
            product={product}
            image={productImages[selectedImage]}
          />
          <div className="detail-thumbs">
            {productImages.map((image, index) => (
              <button
                key={`${image.r2Key || image.url}-${index}`}
                className={index === selectedImage ? "active" : ""}
                onClick={() => setSelectedImage(index)}
              >
                <ProductImage product={product} image={image} alt="" />
              </button>
            ))}
          </div>
        </div>
        <div className="detail-info">
          <div className="detail-breadcrumbs">
            Trang chủ <Icon>chevron_right</Icon> Bột ăn dặm{" "}
            <Icon>chevron_right</Icon> Vị Rau Củ Quả
          </div>
          <div className="detail-tags">
            <Tag>Hữu cơ</Tag>
            <Tag tone="primary">6+ tháng</Tag>
            <Tag tone="neutral">Không thêm đường</Tag>
          </div>
          <h1>{product.name}</h1>
          <p>{product.description}</p>
          <div className="detail-price">
            <Price value={variant?.priceVnd ?? 0} />
            {variant?.compareAtPriceVnd && (
              <del>{formatVnd(variant.compareAtPriceVnd)}</del>
            )}
          </div>
          <div className="variant-block">
            <div className="field-heading">
              <span>Chọn quy cách</span>
              <a href="#guide">Hướng dẫn chọn loại</a>
            </div>
            <div className="variant-buttons">
              {product.variants.map((item) => (
                <button
                  key={item.id}
                  className={variantId === item.id ? "active" : ""}
                  onClick={() => setVariantId(item.id)}
                  aria-pressed={variantId === item.id}
                >
                  {item.name}
                </button>
              ))}
            </div>
          </div>
          <div className="detail-quantity">
            <span>Số lượng</span>
            <QuantityStepper
              value={quantity}
              onChange={setQuantity}
              availability={variant?.availability}
              maxQuantity={variant ? getVariantAvailableQuantity(variant) : null}
            />
            <small>
              {variantPurchasable
                ? "Còn hàng"
                : variant?.availability === "OUT_OF_STOCK"
                  ? "Tạm hết hàng"
                  : variant
                    ? "Tạm hết hàng"
                    : "Không bán"
              }
            </small>
          </div>
          <button
            className="btn primary add-cart"
            onClick={add}
            disabled={!variantPurchasable}
          >
            <Icon>shopping_bag</Icon> THÊM VÀO GIỎ
          </button>
          <div className="detail-benefits">
            <div>
              <Icon>eco</Icon>
              <b>Hữu cơ</b>
              <small>Chứng nhận EU</small>
            </div>
            <div>
              <Icon>no_drinks</Icon>
              <b>Không thêm đường</b>
              <small>Ngọt tự nhiên</small>
            </div>
            <div>
              <Icon>local_shipping</Icon>
              <b>Xác nhận giao hàng</b>
              <small>Người bán xác nhận</small>
            </div>
          </div>
        </div>
        <section className="nutrition">
          <aside>
            <h2>Câu chuyện & Dinh dưỡng</h2>
            <a href="#farm">Hành trình từ nông trại</a>
            <a href="#ingredients">Thành phần chi tiết</a>
            <a href="#guide">Hướng dẫn pha chế</a>
          </aside>
          <div>
            <h2>Cà rốt & Táo – vị ngọt tự nhiên cho bé</h2>
            <p>{product.description}</p>
            <img
              src="/images/hero-desktop.jpg"
              alt={`Nông trại hữu cơ ${STORE_BRAND} tại Đà Lạt`}
            />
            <div className="ingredients" id="ingredients">
              <h3>Thành phần tự nhiên 100%</h3>
              {[
                "Táo hữu cơ (60%)",
                "Cà rốt hữu cơ (40%)",
                "Một chút nước cốt chanh để giữ độ tươi",
              ].map((item) => (
                <p key={item}>
                  <Icon>check_circle</Icon>
                  {item}
                </p>
              ))}
            </div>
          </div>
        </section>
      </article>
      <div className="mobile-add-bar">
        <QuantityStepper
            value={quantity}
            onChange={setQuantity}
            availability={variant?.availability}
            maxQuantity={variant ? getVariantAvailableQuantity(variant) : null}
        />
        <button
          className="btn primary"
          onClick={add}
          disabled={!variantPurchasable}
        >
          <Icon>shopping_bag</Icon> THÊM VÀO GIỎ
        </button>
      </div>
      {toast && (
        <div className="toast">
          <Icon>check_circle</Icon> Đã thêm vào giỏ
        </div>
      )}
    </PublicShell>
  );
}

export function CartPage() {
  const cart = useCart();
  const { products } = useCatalog();
  const lines = cartDetails(cart.items, products);
  const promotion = useCartPromotionEvaluation(cart.items, cart.hydrated);
  const evaluatedByVariant = new Map(
    promotion.data?.items.map((item) => [item.variantId, item]) ?? [],
  );
  const giftCount = promotion.data?.gifts.length ?? 0;
  return (
    <PublicShell>
      <section className="cart-page">
        <div className="cart-heading">
          <div>
            <h1>Giỏ hàng của bạn</h1>
            <p className="mobile-only">
              {cart.totalQuantity} món ngon đang chờ được thưởng thức!
            </p>
          </div>
          <span>{lines.length + giftCount} mặt hàng</span>
        </div>
        {lines.length === 0 ? (
          <div className="empty-state">
            <Icon>shopping_basket</Icon>
            <h2>Giỏ hàng đang trống</h2>
            <p>Khám phá các món ăn dặm phù hợp cho bé.</p>
            <Link className="btn primary" to="/shop">
              Xem sản phẩm
            </Link>
          </div>
        ) : (
          <div className="cart-layout">
            <div className="cart-items">
              {lines.map(({ product, variant, quantity, lineTotal, unavailable }) => {
                const evaluated = evaluatedByVariant.get(variant.id);
                const shownLineTotal = evaluated?.lineTotalVnd ?? lineTotal;
                return (
                  <article
                    className={`cart-item ${unavailable ? "cart-item-unavailable" : ""}`}
                    key={variant.id}
                  >
                    <ProductImage product={product} />
                    <div className="cart-item-info">
                      <h2>{product.name}</h2>
                      <Tag>{variant.name}</Tag>
                      {unavailable && (
                        <p className="form-error" role="alert">
                          Phân loại này không còn khả dụng. Bạn có thể xóa khỏi giỏ hàng.
                        </p>
                      )}
                      <button
                        className="remove-line"
                        onClick={() => cart.removeItem(variant.id)}
                      >
                        <Icon>delete</Icon>
                        <span>Xóa</span>
                      </button>
                      <div className="unit-price">
                        <span>Đơn giá</span>
                        <Price value={evaluated?.priceVnd ?? variant.priceVnd} />
                      </div>
                      {evaluated && evaluated.discountAmountVnd > 0 && (
                        <small className="cart-line-discount">
                          Tiết kiệm {formatVnd(evaluated.discountAmountVnd)}
                        </small>
                      )}
                    </div>
                    <QuantityStepper
                      variantId={variant.id}
                      value={quantity}
                      availability={variant.availability}
                      maxQuantity={getVariantAvailableQuantity(variant)}
                    />
                    <div className="line-total">
                      <span>Thành tiền</span>
                      <Price value={shownLineTotal} />
                    </div>
                  </article>
                );
              })}
              {promotion.data?.gifts.map((gift) => (
                <article className="cart-item promotion-gift-cart-item" key={`${gift.promotionId}-${gift.variantId}`}>
                  <ProductImage r2Key={gift.imageKey} alt={gift.productName} />
                  <div className="cart-item-info">
                    <h2>{gift.productName}</h2>
                    <Tag tone="primary">Quà tặng khuyến mãi</Tag>
                    <p className="promotion-gift-meta">{gift.variantName} × {gift.quantity}</p>
                    <small>Không thể chỉnh sửa số lượng quà tặng.</small>
                  </div>
                  <div className="line-total promotion-gift-total">
                    <span>Giá quà</span>
                    <Price value={0} />
                  </div>
                </article>
              ))}
            </div>
            <CartSummary
              lines={lines}
              promotion={promotion.data}
              promotionLoading={promotion.loading}
              promotionError={promotion.error}
            />
          </div>
        )}
      </section>
    </PublicShell>
  );
}

function CartSummary({
  lines,
  promotion,
  promotionLoading,
  promotionError,
}: {
  lines: ReturnType<typeof cartDetails>;
  promotion: CartPromotionResult | null;
  promotionLoading: boolean;
  promotionError: string;
}) {
  const cart = useCart();
  const checkoutConfig = useCheckoutConfig();
  const subtotalVnd = promotion?.subtotalVnd ?? cart.subtotalVnd;
  const finalTotalVnd = promotion?.finalTotalVnd ?? subtotalVnd;
  return (
    <aside className="cart-summary">
      <h2>Tóm tắt giỏ hàng</h2>
      <div>
        <span>Tổng số lượng</span>
        <b>{cart.totalQuantity}</b>
      </div>
      <div className="subtotal">
        <span>Tạm tính</span>
        <Price value={subtotalVnd} />
      </div>
      {promotion && promotion.discountTotalVnd > 0 && (
        <div className="promotion-total-row">
          <span>Khuyến mãi</span>
          <b>-{formatVnd(promotion.discountTotalVnd)}</b>
        </div>
      )}
      <div className="cart-final-total">
        <span>Tổng</span>
        <Price value={finalTotalVnd} />
      </div>
      {promotionLoading && (
        <p className="promotion-loading" role="status">
          <Icon>sync</Icon> Đang kiểm tra khuyến mãi...
        </p>
      )}
      {promotionError && (
        <p className="info-box" role="status">
          <Icon>info</Icon> Chưa thể tải ưu đãi mới nhất. Khi chốt giỏ hàng, hệ thống sẽ kiểm tra lại.
        </p>
      )}
      {promotion?.appliedPromotions.some((item) => item.discountAmountVnd > 0 || item.giftUnavailable) && (
        <div className="promotion-breakdown">
          <b>Ưu đãi đang áp dụng</b>
          {promotion.appliedPromotions.map((item) => (
            <p key={item.promotionId}>
              <span>{item.promotionName}</span>
              {item.discountAmountVnd > 0 && <strong>-{formatVnd(item.discountAmountVnd)}</strong>}
              {item.giftUnavailable && <small>Quà hiện tạm hết hàng</small>}
            </p>
          ))}
        </div>
      )}
      {promotion?.progress.length ? (
        <div className="promotion-progress" aria-live="polite">
          {promotion.progress.slice(0, 2).map((item) => (
            <p key={item.promotionId}>
              <Icon>local_offer</Icon> {item.message}
            </p>
          ))}
        </div>
      ) : null}
      {checkoutConfig?.enabled === true ? (
        <DirectSellerShareControls
          lines={lines}
          seller={checkoutConfig.seller}
          reservationMinutes={checkoutConfig.reservationMinutes}
        />
      ) : checkoutConfig?.messengerCheckoutEnabled === true ? (
        <MessengerCheckoutControls lines={lines} />
      ) : checkoutConfig ? (
        <p className="info-box">
          <Icon>info</Icon>Kênh xác nhận giỏ hàng hiện chưa sẵn sàng. Vui lòng
          quay lại sau.
        </p>
      ) : (
        <button className="btn primary" disabled>
          ĐANG TẢI KÊNH XÁC NHẬN...
        </button>
      )}
      <small>
        <Icon>lock</Icon> Thông tin của bạn được bảo mật an toàn
      </small>
    </aside>
  );
}

type CheckoutConfig = {
  mode: "DIRECT_SELLER_SHARE";
  enabled: boolean;
  seller: SellerContact | null;
  reservationMinutes: number;
  messengerCheckoutEnabled?: boolean;
};

function useCheckoutConfig() {
  const [config, setConfig] = useState<CheckoutConfig | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/checkout-config")
      .then(async (response) => {
        if (!response.ok) throw new Error("CHECKOUT_CONFIG_FAILED");
        return response.json() as Promise<CheckoutConfig>;
      })
      .then((body) => {
        if (!cancelled) setConfig(body);
      })
      .catch(() => {
        if (!cancelled)
          setConfig({
            mode: "DIRECT_SELLER_SHARE",
            enabled: false,
            seller: null,
            reservationMinutes: DEFAULT_CHECKOUT_RESERVATION_MINUTES,
            messengerCheckoutEnabled: false,
          });
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return config;
}

type PriceChange = {
  variantId: string;
  displayedPrice: number;
  currentPrice: number;
};

function findCurrentCartPrice(
  variantId: string,
  products: Product[],
  fallback?: number,
) {
  return findVariantInProducts(products, variantId)?.variant.priceVnd ?? fallback;
}

function DirectSellerShareControls({
  lines,
  seller,
  reservationMinutes,
}: {
  lines: ReturnType<typeof cartDetails>;
  seller: SellerContact | null;
  reservationMinutes: number;
}) {
  const cart = useCart();
  const navigate = useNavigate();
  const fingerprint = cartShareFingerprint(cart.items);
  const prepared = readPreparedCartShare();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [priceChanges, setPriceChanges] = useState<PriceChange[]>([]);
  const stale = Boolean(prepared && prepared.fingerprint !== fingerprint);
  const hasUnavailable = lines.some((line) => line.unavailable);

  const showGuide = async (value: PreparedCartShare) => {
    const copied = await copyCartText(value.share.copyText);
    const next = { ...value, clipboardStatus: copied ? "COPIED" : "FAILED" } as const;
    writePreparedCartShare(next);
    console[copied ? "info" : "warn"](
      JSON.stringify({
        event: copied ? "checkout_cart_copied" : "checkout_cart_copy_failed",
        publicCode: value.cartRequest.code,
      }),
    );
    navigate(`/cart/guide/${encodeURIComponent(value.cartRequest.code)}`);
  };

  const prepare = async (acceptCurrentPrices = false, forceNew = false) => {
    setBusy(true);
    setMessage("");
    setPriceChanges([]);
    try {
      if (!lines.length) throw new Error("Giỏ hàng đang trống.");
      if (hasUnavailable)
        throw new Error("Có phân loại không còn khả dụng. Vui lòng xóa khỏi giỏ hàng.");
      if (!seller) throw new Error("Người bán chưa được cấu hình.");
      if (forceNew) clearPreparedCartShare();
      const submissionToken = getCartShareSubmissionToken(fingerprint, forceNew);
      const response = await fetch("/api/cart/share/prepare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          submissionToken,
          acceptCurrentPrices,
          items: lines.map(({ variant, quantity }) => ({
            variantId: variant.id,
            quantity,
            displayedPrice: variant.priceVnd,
          })),
        }),
      });
      const body = (await response.json()) as
        | Omit<PreparedCartShare, "fingerprint"> & { success: true }
        | {
            error?: {
              code?: string;
              message?: string;
              items?: PriceChange[];
            };
          };
      if (!response.ok || !("success" in body)) {
        const issue = "error" in body ? body.error : undefined;
        if (issue?.code === "PRICE_CHANGED" && issue.items?.length) {
          setPriceChanges(issue.items);
          setMessage("Giá của một số sản phẩm vừa thay đổi.");
          return;
        }
        throw new Error(issue?.message || "Chưa thể chốt giỏ hàng.");
      }
      const value: PreparedCartShare = {
        fingerprint,
        submissionToken,
        cartRequest: body.cartRequest,
        share: body.share,
        seller: body.seller,
        serverNow: body.serverNow,
      };
      writePreparedCartShare(value);
      await showGuide(value);
    } catch (caught) {
      setMessage(
        caught instanceof Error ? caught.message : "Chưa thể chốt giỏ hàng.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (!prepared || stale || hasUnavailable) {
    return (
      <div className="direct-share-checkout">
        <p className="direct-share-help">
          Sản phẩm và ưu đãi chưa được giữ ở bước này. Sau khi gửi giỏ hàng qua Messenger,
          sản phẩm và ưu đãi sẽ được giữ tối đa {formatReservationDuration(reservationMinutes)} để shop xác nhận.
        </p>
        {stale && (
          <p className="share-warning" role="alert">
            Giỏ hàng đã thay đổi. Vui lòng chốt lại trước khi gửi.
          </p>
        )}
        {hasUnavailable && (
          <p className="share-warning" role="alert">
            Có phân loại không còn khả dụng. Vui lòng xóa khỏi giỏ hàng trước khi chốt.
          </p>
        )}
        {message && <p className="form-error">{message}</p>}
        {priceChanges.length > 0 && (
          <div className="price-change-list">
            {priceChanges.map((change) => {
              const line = lines.find(
                ({ variant }) => variant.id === change.variantId,
              );
              return (
                <p key={change.variantId}>
                  <b>{line?.product.name ?? change.variantId}</b>
                  <span>
                    {formatVnd(change.displayedPrice)} → {formatVnd(change.currentPrice)}
                  </span>
                </p>
              );
            })}
            <button
              className="btn secondary-btn"
              disabled={busy}
              onClick={() => void prepare(true)}
            >
              XÁC NHẬN GIÁ MỚI
            </button>
          </div>
        )}
        <button
          className="btn primary direct-prepare"
          disabled={busy || hasUnavailable}
          onClick={() => void prepare(false, stale)}
        >
          {busy ? "ĐANG KIỂM TRA..." : "CHỐT GIỎ HÀNG"}
        </button>
      </div>
    );
  }

  return (
    <div className="prepared-share" role="status">
      <p>
        Giỏ hàng này đã được chốt và sẵn sàng gửi cho {prepared.seller.displayName}.
        {prepared.cartRequest.checkoutState === "WAITING_SELLER_CONFIRM"
          ? ` Hàng và ưu đãi đang được giữ đến ${prepared.cartRequest.reservationExpiresAt ? new Date(prepared.cartRequest.reservationExpiresAt).toLocaleString("vi-VN") : "khi shop xác nhận"}.`
          : " Sản phẩm và ưu đãi chưa được giữ ở bước này; sau khi gửi, thời gian giữ sẽ theo cấu hình hiện tại của shop."}
      </p>
      <button className="btn primary messenger-primary" disabled={busy} onClick={() => void showGuide(prepared)}>
        <Icon>arrow_forward</Icon> TIẾP TỤC GỬI GIỎ HÀNG
      </button>
    </div>
  );
}

type MessengerStartResult = {
  success: true;
  code: string;
  messengerUrl: string;
  statusToken: string;
  expiresAt: string;
  messengerStatus: string;
  cartRequest: PendingMessengerCart["cartRequest"];
};

function MessengerCheckoutControls({
  lines,
}: {
  lines: ReturnType<typeof cartDetails>;
}) {
  const cart = useCart();
  const navigate = useNavigate();
  const fingerprint = cartFingerprint(cart.items);
  const [pending, setPending] = useState<PendingMessengerCart | null>(() =>
    readPendingMessengerCart(),
  );
  const [status, setStatus] = useState(
    pending ? "AWAITING_USER" : "",
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const hasUnavailable = lines.some((line) => line.unavailable);

  const completeSentCart = (value: PendingMessengerCart) => {
    // Chỉ xóa đúng snapshot đã submit; thay đổi mới của khách luôn được giữ lại.
    if (cartFingerprint(cart.items) === value.fingerprint) cart.clear();
    window.sessionStorage.setItem(
      "babyjoy.lastSubmittedCart.v1",
      JSON.stringify({ ...value.cartRequest, contactChannel: "MESSENGER" }),
    );
    clearPendingMessengerCart();
    setPending(null);
    navigate(`/cart/success/${encodeURIComponent(value.code)}`);
  };

  const checkStatus = async (quiet = false) => {
    const value = pending ?? readPendingMessengerCart();
    if (!value) return;
    if (!quiet) setBusy(true);
    setMessage("");
    try {
      const response = await fetch(
        `/api/cart/messenger/status/${encodeURIComponent(value.code)}`,
        { headers: { authorization: `Bearer ${value.statusToken}` } },
      );
      const body = (await response.json()) as {
        status?: string;
        error?: { message?: string };
      };
      if (!response.ok || !body.status)
        throw new Error(body.error?.message || "Chưa thể kiểm tra trạng thái.");
      setStatus(body.status);
      if (body.status === "SENT") completeSentCart(value);
      else if (body.status === "FAILED")
        setMessage(`${STORE_BRAND} chưa gửi được giỏ hàng qua Messenger. Giỏ hàng của bạn vẫn được giữ lại.`);
    } catch (caught) {
      if (!quiet)
        setMessage(
          caught instanceof Error
            ? caught.message
            : "Chưa thể kiểm tra trạng thái Messenger.",
        );
    } finally {
      if (!quiet) setBusy(false);
    }
  };

  useEffect(() => {
    if (!pending) return;
    const refresh = () => void checkStatus(true);
    const visible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [pending, fingerprint]);

  const openMessenger = (url: string) => {
    // Điều hướng same-tab ổn định trên cả mobile và desktop, không phụ thuộc popup.
    if (hasUnavailable) return;
    window.location.assign(url);
  };

  const start = async (forceNew = false) => {
    setBusy(true);
    setMessage("");
    try {
      if (!lines.length) throw new Error("Giỏ hàng đang trống.");
      if (hasUnavailable)
        throw new Error("Có phân loại không còn khả dụng. Vui lòng xóa khỏi giỏ hàng.");
      if (forceNew) {
        clearPendingMessengerCart();
        setPending(null);
      }
      const submissionToken = getMessengerSubmissionToken(
        fingerprint,
        forceNew,
      );
      const response = await fetch("/api/cart/messenger/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          submissionToken,
          items: lines.map(({ variant, quantity }) => ({
            variantId: variant.id,
            quantity,
          })),
        }),
      });
      const body = (await response.json()) as
        | MessengerStartResult
        | { error?: { message?: string } };
      if (!response.ok || !("success" in body)) {
        const failure = "error" in body ? body.error : undefined;
        throw new Error(failure?.message || "Chưa thể tạo phiên Messenger.");
      }
      const value: PendingMessengerCart = {
        code: body.code,
        messengerUrl: body.messengerUrl,
        statusToken: body.statusToken,
        expiresAt: body.expiresAt,
        fingerprint,
        cartRequest: body.cartRequest,
      };
      writePendingMessengerCart(value);
      setPending(value);
      setStatus(body.messengerStatus);
      openMessenger(body.messengerUrl);
    } catch (caught) {
      setMessage(
        caught instanceof Error
          ? caught.message
          : "Chưa thể mở Messenger. Giỏ hàng của bạn vẫn được giữ lại.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (pending) {
    const expired = status === "EXPIRED";
    return (
      <div className="messenger-pending" role="status">
        <Icon>{expired ? "schedule" : "forum"}</Icon>
        <b>
          {expired
            ? "Phiên xác nhận Messenger đã hết hạn."
            : status === "IDENTIFIED"
              ? "Messenger đã được nhận diện"
              : status === "CONFIRMED" || status === "SENDING"
                ? `${STORE_BRAND} đang gửi giỏ hàng`
                : "Đang chờ xác nhận trên Messenger"}
        </b>
        {hasUnavailable ? (
          <p className="form-error" role="alert">
            Phiên này có phân loại không còn khả dụng. Vui lòng quay lại giỏ hàng và xóa dòng đó.
          </p>
        ) : !expired && (
          <p>
            Mở Messenger, xác nhận giỏ hàng và quay lại {STORE_BRAND}. Shop sẽ nhận
            giỏ hàng ngay trong cuộc trò chuyện của bạn.
          </p>
        )}
        {message && <p className="form-error">{message}</p>}
        {expired ? (
          <button className="btn primary" disabled={busy} onClick={() => void start(true)}>
            XÁC NHẬN LẠI
          </button>
        ) : (
          <div className="messenger-actions">
            <button className="btn primary" disabled={hasUnavailable} onClick={() => openMessenger(pending.messengerUrl)}>
              MỞ MESSENGER
            </button>
            <button className="btn secondary-btn" disabled={busy} onClick={() => void checkStatus()}>
              {busy ? "ĐANG KIỂM TRA..." : "KIỂM TRA TRẠNG THÁI"}
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="messenger-checkout">
      <p className="info-box">
        <Icon>forum</Icon>Shop sẽ nhận giỏ hàng và tư vấn trực tiếp với bạn trên
        Messenger.
      </p>
      {message && <p className="form-error">{message}</p>}
      {hasUnavailable && (
        <p className="share-warning" role="alert">
          Có phân loại không còn khả dụng. Vui lòng xóa khỏi giỏ hàng trước khi gửi.
        </p>
      )}
      <button className="btn primary" disabled={busy || hasUnavailable} onClick={() => void start()}>
        {busy ? "ĐANG TẠO PHIÊN..." : "XÁC NHẬN QUA MESSENGER"} <Icon>send</Icon>
      </button>
    </div>
  );
}

type PublicCartShareDto = {
  code: string;
  createdAt: string;
  itemLineCount: number;
  totalQuantity: number;
  subtotalVnd: number;
  promotionDiscountVnd?: number;
  finalTotalVnd?: number;
  checkoutState?: string;
  reservationStartedAt?: string | null;
  reservationExpiresAt?: string | null;
  reservationDurationMinutes?: number | null;
  orderExpired?: boolean;
  reservationMessage?: string;
  promotions?: Array<{
    promotionName: string;
    discountAmountVnd: number;
  }>;
  items: Array<{
    productName: string;
    variantName: string;
    imageUrl: string;
    unitPriceVnd: number;
    quantity: number;
    lineTotalVnd: number;
    isPromotionGift?: boolean;
    promotionId?: string;
  }>;
};

type ActivationGiftChange = {
  productName?: string;
  variantName?: string;
  quantity: number;
};

type ActivationIssue = {
  code?: string;
  message?: string;
  items?: PriceChange[];
  variantIds?: string[];
  subtotalVnd?: number;
  discountTotalVnd?: number;
  finalTotalVnd?: number;
  gifts?: ActivationGiftChange[];
};

export function PublicCartSharePage() {
  const { pathname } = useLocation();
  const token = pathname.split("/").filter(Boolean).at(-1) ?? "";
  const [data, setData] = useState<PublicCartShareDto | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/cart/share/${encodeURIComponent(token)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("CART_SHARE_UNAVAILABLE");
        return response.json() as Promise<PublicCartShareDto>;
      })
      .then((body) => {
        if (!cancelled) setData(body);
      })
      .catch(() => {
        if (!cancelled) setUnavailable(true);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);
  return (
    <main className="public-share-page">
      <Link to="/" className="share-brand" aria-label={`${STORE_BRAND} - Trang chủ`}>
        <img src="/images/logo.png" alt="" />
        <span>{STORE_BRAND}</span>
      </Link>
      {unavailable ? (
        <section className="share-unavailable">
          <Icon>link_off</Icon>
          <h1>Liên kết giỏ hàng không còn khả dụng.</h1>
          <Link className="btn primary" to="/shop">XEM SẢN PHẨM</Link>
        </section>
      ) : !data ? (
        <section className="share-unavailable">
          <Icon>progress_activity</Icon>
          <p>Đang tải giỏ hàng...</p>
        </section>
      ) : (
        <article className="public-share-card">
          <header>
            <span>GIỎ HÀNG</span>
            <h1>{data.code}</h1>
            <small>{new Date(data.createdAt).toLocaleString("vi-VN")}</small>
            {data.orderExpired ? (
              <p className="share-warning">{data.reservationMessage || "Đơn này đã hết thời gian giữ hàng."}</p>
            ) : data.reservationExpiresAt ? (
              <p className="reservation-active-note">
                Hàng và ưu đãi được giữ đến {new Date(data.reservationExpiresAt).toLocaleString("vi-VN")}.
              </p>
            ) : null}
          </header>
          <div className="public-share-items">
            {data.items.map((item, index) => (
              <section
                className={item.isPromotionGift ? "promotion-gift-share-item" : ""}
                key={`${item.productName}-${item.variantName}-${index}`}
              >
                <img src={item.imageUrl} alt="" />
                <p>
                  <b>{item.productName}</b>
                  <span>{item.variantName}</span>
                  <small>
                    {item.isPromotionGift
                      ? `Quà tặng khuyến mãi · 0 ₫ × ${item.quantity}`
                      : `${formatVnd(item.unitPriceVnd)} × ${item.quantity}`}
                  </small>
                </p>
                <Price value={item.lineTotalVnd} />
              </section>
            ))}
          </div>
          <footer>
            <p><span>Tổng số lượng</span><b>{data.totalQuantity}</b></p>
            <p><span>Tạm tính</span><Price value={data.subtotalVnd} /></p>
            {data.promotions?.map((promotion) => (
              <p key={promotion.promotionName}>
                <span>{promotion.promotionName}</span>
                <b className="promotion-value">-{formatVnd(promotion.discountAmountVnd)}</b>
              </p>
            ))}
            {(data.promotionDiscountVnd ?? 0) > 0 && (
              <p><span>Khuyến mãi</span><b className="promotion-value">-{formatVnd(data.promotionDiscountVnd ?? 0)}</b></p>
            )}
            <p className="share-final-total"><span>Tổng</span><Price value={data.finalTotalVnd ?? data.subtotalVnd} /></p>
          </footer>
        </article>
      )}
    </main>
  );
}

export function CartShareGuidePage() {
  const navigate = useNavigate();
  const cart = useCart();
  const { products } = useCatalog();
  const code = decodeURIComponent(
    useLocation().pathname.split("/").filter(Boolean).at(-1) ?? "",
  );
  const [prepared, setPrepared] = useState<PreparedCartShare | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [copyStatus, setCopyStatus] = useState<"COPIED" | "FAILED">("FAILED");
  const [copyFeedback, setCopyFeedback] = useState("");
  const [clickGuardStale, setClickGuardStale] = useState(false);
  const [activationBusy, setActivationBusy] = useState(false);
  const [activationError, setActivationError] = useState("");
  const [activationIssue, setActivationIssue] = useState<ActivationIssue | null>(null);
  const checkoutConfig = useCheckoutConfig();
  const manualTextRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const value = readPreparedCartShare();
    if (value?.cartRequest.code === code) {
      setPrepared(value);
      setCopyStatus(value.clipboardStatus ?? "FAILED");
    }
    setLoaded(true);
  }, [code]);

  const copyAgain = async () => {
    if (!prepared) return;
    const copied = await copyCartText(prepared.share.copyText);
    const status = copied ? "COPIED" : "FAILED";
    setCopyStatus(status);
    setCopyFeedback(copied ? "Đã sao chép" : "Chưa thể sao chép tự động");
    writePreparedCartShare({ ...prepared, clipboardStatus: status });
    if (!copied) {
      window.setTimeout(() => {
        manualTextRef.current?.focus();
        manualTextRef.current?.select();
      });
    }
    console[copied ? "info" : "warn"](
      JSON.stringify({
        event: copied ? "checkout_copy_again" : "checkout_cart_copy_failed",
        publicCode: prepared.cartRequest.code,
      }),
    );
  };

  // Chờ CartProvider đọc localStorage trước khi kết luận snapshot đã cũ.
  if (!loaded || !cart.hydrated)
    return <main className="cart-guide-loading">Đang mở hướng dẫn…</main>;
  if (!prepared) {
    return (
      <main className="cart-guide-unavailable">
        <Icon>content_paste_off</Icon>
        <h1>Chưa có giỏ hàng để gửi</h1>
        <p>Vui lòng quay lại giỏ hàng và chọn Chốt giỏ hàng.</p>
        <Link className="btn primary" to="/cart">Quay lại giỏ hàng</Link>
      </main>
    );
  }

  const hasUnavailable = cartDetails(cart.items, products).some(
    (line) => line.unavailable,
  );
  if (hasUnavailable) {
    return (
      <main className="cart-guide-unavailable">
        <Icon>inventory_2</Icon>
        <h1>Phân loại trong giỏ không còn khả dụng</h1>
        <p>
          Một phân loại đã bị xóa hoặc tạm ngưng sau khi chốt giỏ. Vui lòng
          quay lại giỏ hàng, xóa dòng này và chốt lại trước khi gửi cho shop.
        </p>
        <Link className="btn primary" to="/cart">QUAY LẠI GIỎ HÀNG</Link>
      </main>
    );
  }

  const currentFingerprint = cartShareFingerprint(cart.items);
  const stale = clickGuardStale || prepared.fingerprint !== currentFingerprint;
  if (stale) {
    return (
      <main className="cart-guide-unavailable">
        <Icon>sync_problem</Icon>
        <h1>Giỏ hàng đã thay đổi</h1>
        <p>
          Giỏ hàng hiện tại không còn giống với giỏ hàng đã chốt trước đó.
          Vui lòng quay lại giỏ hàng và chốt lại trước khi gửi cho shop.
        </p>
        <Link className="btn primary" to="/cart">QUAY LẠI GIỎ HÀNG</Link>
      </main>
    );
  }

  const activateAndOpenMessenger = async (acceptCurrentPrices = false) => {
    if (activationBusy || !prepared) return;
    setActivationError("");
    setActivationIssue(null);
    // Đọc lại localStorage tại thời điểm click để chặn thay đổi từ tab khác.
    const latestItems = parseStoredCart(window.localStorage.getItem(cartStorageKey));
    const allowed = runWithCurrentPreparedCartShare(prepared, latestItems,
      () => undefined,
      () => !cartDetails(latestItems, products).some((line) => line.unavailable),
    );
    if (!allowed) {
      setClickGuardStale(true);
      return;
    }
    setActivationBusy(true);
    try {
      const submissionToken =
        prepared.submissionToken ?? getCartShareSubmissionToken(prepared.fingerprint);
      const response = await fetch("/api/cart/share/activate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          submissionToken,
          acceptCurrentPrices,
          items: latestItems.map((item) => ({
            variantId: item.variantId,
            quantity: item.quantity,
            displayedPrice: findCurrentCartPrice(item.variantId, products, item.priceVnd),
          })),
        }),
      });
      const body = (await response.json()) as
        | (Omit<PreparedCartShare, "fingerprint"> & { success: true })
        | { error?: ActivationIssue };
      if (!response.ok || !("success" in body)) {
        const issue = "error" in body ? body.error : undefined;
        setActivationIssue(issue ?? null);
        setActivationError(issue?.message || "Chưa thể giữ hàng trước khi mở Messenger.");
        return;
      }
      const next: PreparedCartShare = {
        fingerprint: cartShareFingerprint(latestItems),
        submissionToken,
        cartRequest: body.cartRequest,
        share: body.share,
        seller: body.seller,
        serverNow: body.serverNow,
      };
      setPrepared(next);
      writePreparedCartShare(next);
      const copied = await copyCartText(next.share.copyText);
      const copyState = copied ? "COPIED" : "FAILED";
      setCopyStatus(copyState);
      writePreparedCartShare({ ...next, clipboardStatus: copyState });
      if (!copied) {
        setActivationError("Chưa thể sao chép tự động. Hãy sao chép nội dung bên dưới trước khi mở Messenger.");
        window.setTimeout(() => {
          manualTextRef.current?.focus();
          manualTextRef.current?.select();
        });
        return;
      }
      // Kiểm tra fingerprint lần cuối ngay trước các side effect analytics/navigation.
      const latestBeforeNavigation = parseStoredCart(
        window.localStorage.getItem(cartStorageKey),
      );
      const allowed = runWithCurrentPreparedCartShare(
        next,
        latestBeforeNavigation,
        () => {
          recordSellerMessengerOpened(next.cartRequest.code);
          console.info(
            JSON.stringify({
              event: "checkout_messenger_click",
              publicCode: next.cartRequest.code,
            }),
          );
          const messengerUrl = next.seller.messengerUrl || prepared.seller.messengerUrl;
          window.location.assign(messengerUrl);
        },
        () => !cartDetails(latestBeforeNavigation, products).some((line) => line.unavailable),
      );
      if (!allowed) setClickGuardStale(true);
    } catch (caught) {
      setActivationError(
        caught instanceof Error ? caught.message : "Chưa thể giữ hàng trước khi mở Messenger.",
      );
    } finally {
      setActivationBusy(false);
    }
  };
  const copied = copyStatus === "COPIED";
  const reservationMinutes =
    prepared.cartRequest.reservationDurationMinutes ??
    checkoutConfig?.reservationMinutes ??
    DEFAULT_CHECKOUT_RESERVATION_MINUTES;
  return (
    <main className="cart-guide-page">
      <header className="cart-guide-mobile-header">
        <button type="button" onClick={() => navigate(-1)} aria-label="Quay lại giỏ hàng">
          <Icon>arrow_back</Icon>
        </button>
        <span>Gửi giỏ hàng cho shop</span>
      </header>
      <div className="cart-guide-layout">
        <section className="cart-guide-instructions">
          <div className={`cart-guide-check ${copied ? "copied" : "failed"}`}>
            <Icon>{copied ? "check" : "content_paste_off"}</Icon>
          </div>
          <div className="cart-guide-heading">
            <h1>{copied ? "Giỏ hàng đã được sao chép" : "Chưa thể tự động sao chép giỏ hàng"}</h1>
            <p>
              {copied ? "Chỉ còn 2 bước để gửi đơn cho " : "Hãy sao chép lại giỏ hàng trước khi mở Messenger của "}
              <strong>{prepared.seller.displayName}</strong>
            </p>
            {prepared.cartRequest.checkoutState === "WAITING_SELLER_CONFIRM" ? (
              <p className="reservation-active-note">
                Đã giữ hàng trong {formatReservationDuration(reservationMinutes)}; hạn xác nhận: {prepared.cartRequest.reservationExpiresAt ? new Date(prepared.cartRequest.reservationExpiresAt).toLocaleString("vi-VN") : "đang cập nhật"}.
              </p>
            ) : (
              <p className="reservation-pending-note">
                Sản phẩm và ưu đãi chưa được giữ ở bước này. Sau khi bạn bấm gửi, hệ thống sẽ giữ tối đa {formatReservationDuration(reservationMinutes)} để shop xác nhận.
              </p>
            )}
            <span className="cart-guide-mnemonic">Mở → Dán → Gửi</span>
          </div>
          <div className="cart-guide-steps">
            <article>
              <span>1</span>
              <div>
                <h2>Mở Messenger</h2>
                <p>Nhấn nút Nhắn shop bên dưới để mở cuộc trò chuyện với {prepared.seller.displayName}.</p>
              </div>
            </article>
            <article>
              <span>2</span>
              <div>
                <h2>Dán giỏ hàng và gửi</h2>
                <p>Trong Messenger, nhấn giữ ô nhập tin nhắn → chọn <b>Dán</b> → nhấn <b>Gửi</b>.</p>
              </div>
            </article>
          </div>
          {!copied && (
            <label className="cart-guide-manual-copy">
              <span>Nếu trình duyệt vẫn chặn sao chép, nhấn giữ nội dung bên dưới và chọn Sao chép.</span>
              <textarea ref={manualTextRef} readOnly value={prepared.share.copyText} aria-label="Nội dung giỏ hàng để sao chép thủ công" />
            </label>
          )}
          <GuideActions
            copied={copied}
            feedback={copyFeedback}
            onCopy={() => void copyAgain()}
           onMessenger={() => void activateAndOpenMessenger()}
            onConfirmChanges={() => void activateAndOpenMessenger(true)}
            busy={activationBusy}
            error={activationError}
            issue={activationIssue}
            products={products}
            reservationMinutes={reservationMinutes}
          />
        </section>
        <MessengerGuideIllustration seller={prepared.seller} />
      </div>
      <div className="cart-guide-mobile-actions">
        <GuideActions
          copied={copied}
          feedback={copyFeedback}
          onCopy={() => void copyAgain()}
           onMessenger={() => void activateAndOpenMessenger()}
           onConfirmChanges={() => void activateAndOpenMessenger(true)}
           busy={activationBusy}
           error={activationError}
           issue={activationIssue}
           products={products}
           reservationMinutes={reservationMinutes}
        />
      </div>
    </main>
  );
}

function GuideActions({
  copied,
  feedback,
  onCopy,
  onMessenger,
  onConfirmChanges,
  busy,
  error,
  issue,
  products,
  reservationMinutes,
}: {
  copied: boolean;
  feedback: string;
  onCopy: () => void;
  onMessenger: () => void;
  onConfirmChanges: () => void;
  busy: boolean;
  error: string;
  issue: ActivationIssue | null;
  products: Product[];
  reservationMinutes: number;
}) {
  const changedPrices =
    issue?.items?.map((change) => ({
      ...change,
      productName:
        findVariantInProducts(products, change.variantId)?.product.name ?? change.variantId,
    })) ?? [];
  const unavailableVariants =
    issue?.variantIds?.map(
      (variantId) => findVariantInProducts(products, variantId)?.product.name ?? variantId,
    ) ?? [];
  const hasActivationChange =
    issue?.code === "PRICE_CHANGED" || issue?.code === "PROMOTION_CHANGED";
  return (
    <div className="cart-guide-actions">
      <span>Mở Messenger → Dán → Gửi</span>
      <button type="button" className="btn primary" disabled={busy} onClick={onMessenger}>
        <Icon>chat_bubble</Icon> {busy ? "ĐANG GIỮ HÀNG..." : `Gửi ngay để giữ hàng & ưu đãi ${formatReservationDuration(reservationMinutes)}`}
      </button>
      {error && <p className="form-error" role="alert">{error}</p>}
      {hasActivationChange && (
        <div className="activation-change-card" role="alert">
          <b>Giỏ hàng vừa có thay đổi</b>
          {changedPrices.map((change) => (
            <p key={change.variantId}>
              <span>{change.productName}</span>
              <span>{formatVnd(change.displayedPrice)} → {formatVnd(change.currentPrice)}</span>
            </p>
          ))}
          {issue?.discountTotalVnd !== undefined && (
            <p>
              <span>Khuyến mãi hiện tại</span>
              <span>-{formatVnd(issue.discountTotalVnd)}</span>
            </p>
          )}
          {issue?.finalTotalVnd !== undefined && (
            <p>
              <span>Tổng hiện tại</span>
              <b>{formatVnd(issue.finalTotalVnd)}</b>
            </p>
          )}
          {issue?.gifts?.length ? (
            <p>
              <span>Quà tặng hiện tại</span>
              <span>{issue.gifts.map((gift) => `${gift.productName ?? "Quà tặng"} × ${gift.quantity}`).join(", ")}</span>
            </p>
          ) : null}
          <button type="button" className="btn secondary-btn" disabled={busy} onClick={onConfirmChanges}>
            XÁC NHẬN THAY ĐỔI &amp; GIỮ HÀNG
          </button>
        </div>
      )}
      {issue?.code === "INSUFFICIENT_STOCK" && unavailableVariants.length > 0 && (
        <div className="activation-change-card" role="alert">
          <b>Một số sản phẩm vừa hết hàng hoặc không còn đủ số lượng</b>
          <p>{unavailableVariants.join(", ")}</p>
          <span>Vui lòng quay lại giỏ hàng để giảm số lượng hoặc xóa sản phẩm trước khi gửi.</span>
        </div>
      )}
      <p className={copied ? "copy-ready" : "copy-warning"} role="status">
        <Icon>{copied ? "check_circle" : "error"}</Icon>
        {copied ? "Giỏ hàng đã được sao chép sẵn" : "Giỏ hàng chưa được sao chép"}
      </p>
      <button type="button" className="cart-guide-copy-again" onClick={onCopy}>
        {feedback || "Sao chép lại giỏ hàng"}
      </button>
    </div>
  );
}

function MessengerGuideIllustration({ seller }: { seller: SellerContact }) {
  return (
    <section className="messenger-guide" aria-label="Minh họa cách dán và gửi giỏ hàng trong Messenger">
      <h2>Hướng dẫn nhanh: Nhấn giữ → Dán → Gửi</h2>
      <div
        className="messenger-mockup"
        data-animation="finger-touch-long-press-paste-send"
      >
        <header>
          {seller.avatarUrl ? <img src={seller.avatarUrl} alt="" /> : <span><Icon>storefront</Icon></span>}
          <p><b>{seller.displayName}</b><small>● Đang hoạt động</small></p>
        </header>
        <div className="messenger-chat">
          <p>🛒 Chi tiết giỏ hàng của bạn...</p>
        </div>
        <div className="messenger-paste-tip" data-animation-step="paste-menu">
          Dán <Icon>content_paste</Icon>
        </div>
        <span
          className="messenger-paste-ping"
          data-animation-step="paste-ping"
          aria-hidden="true"
        />
        <div className="messenger-input" data-animation-step="input">
          <span className="messenger-input-action" aria-hidden="true"><Icon>add_circle</Icon></span>
          <span className="messenger-input-copy messenger-input-copy-placeholder">Nhắn tin...</span>
          <span className="messenger-input-copy messenger-input-copy-populated">[Đơn hàng]...</span>
          <span
            className="messenger-finger"
            data-animation-step="finger-touch-long-press"
            aria-hidden="true"
          >
            <svg className="messenger-finger-icon" fill="currentColor" viewBox="0 0 24 24">
              <path d="M9 11.24V7.5C9 6.12 10.12 5 11.5 5S14 6.12 14 7.5v3.74c1.21-.81 2-2.18 2-3.74C16 5.01 13.99 3 11.5 3S7 5.01 7 7.5c0 1.56.79 2.93 2 3.74zm9.84 4.63l-4.54-2.26c-.17-.07-.35-.11-.54-.11H13v-6c0-.83-.67-1.5-1.5-1.5S10 6.67 10 7.5v10.74l-3.43-.72c-.08-.01-.15-.03-.24-.03-.31 0-.59.13-.79.33l-.79.8 4.94 4.94c.27.27.65.44 1.06.44h6.79c.75 0 1.33-.55 1.44-1.28l.75-5.27c.01-.07.02-.14.02-.2 0-.62-.38-1.16-.91-1.38z" />
            </svg>
          </span>
          <span className="messenger-touch-pulse" data-animation-step="touch-pulse" aria-hidden="true" />
          <span className="messenger-send" data-animation-step="send" aria-hidden="true"><Icon>send</Icon></span>
        </div>
      </div>
      <p className="messenger-caption"><Icon>touch_app</Icon> Nhấn giữ khung chat để dán</p>
    </section>
  );
}

export function SuccessPage() {
  const code = decodeURIComponent(
    useLocation().pathname.split("/").filter(Boolean).at(-1) ??
      "GH-260825-X7K2",
  );
  const [data, setData] = useState({
    code,
    itemLineCount: 3,
    totalQuantity: 4,
    subtotalVnd: 367000,
    promotionDiscountVnd: 0,
    finalTotalVnd: 367000,
    createdAt: "2026-08-25T15:12:00+07:00",
    contactChannel: "LEGACY",
  });
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const raw = window.sessionStorage.getItem("babyjoy.lastSubmittedCart.v1");
    if (raw) {
      try {
        setData(JSON.parse(raw) as typeof data);
      } catch {
        /* Dữ liệu demo được giữ nếu session không hợp lệ. */
      }
    }
  }, []);
  const copy = async () => {
    await navigator.clipboard.writeText(data.code);
    setCopied(true);
  };
  return (
    <PublicShell hideMobileNav>
      <section className="success-page">
        <article className="success-card">
          <div className="success-icon">
            <Icon>check</Icon>
          </div>
          <h1>
            {data.contactChannel === "MESSENGER"
              ? "Giỏ hàng đã được gửi qua Messenger"
              : "Đã gửi giỏ hàng"}
          </h1>
          <p>
            {data.contactChannel === "MESSENGER"
              ? `${STORE_BRAND} đã gửi chi tiết giỏ hàng vào cuộc trò chuyện Messenger của bạn. Shop sẽ tư vấn và xác nhận hàng ngay tại đó.`
              : "Người bán sẽ liên hệ với bạn để xác nhận tình trạng sản phẩm, phí giao hàng và phương thức thanh toán."}
          </p>
          <div className="success-data">
            <div className="cart-code">
              <span>MÃ GIỎ HÀNG CỦA BẠN</span>
              <button onClick={copy}>
                <b>{data.code}</b>
                <Icon>{copied ? "check" : "content_copy"}</Icon>
              </button>
            </div>
            <div className="request-meta">
              <div>
                <span>Thời gian gửi</span>
                <b>25/08/2026 • 15:12</b>
              </div>
              <div>
                <span>Số lượng</span>
                <b>
                  {data.itemLineCount} mặt hàng, Tổng số lượng:{" "}
                  {data.totalQuantity}
                </b>
              </div>
              <div className="meta-total">
                <span>Tạm tính (chưa gồm phí ship)</span>
                <Price value={data.subtotalVnd} />
              </div>
              {data.promotionDiscountVnd > 0 && (
                <div className="meta-promotion">
                  <span>Khuyến mãi</span>
                  <b>-{formatVnd(data.promotionDiscountVnd)}</b>
                </div>
              )}
              {data.finalTotalVnd !== undefined && data.finalTotalVnd !== data.subtotalVnd && (
                <div className="meta-total">
                  <span>Tổng sau ưu đãi</span>
                  <Price value={data.finalTotalVnd} />
                </div>
              )}
            </div>
          </div>
          <p className="mobile-success-note">
            <Icon>info</Icon>Người bán sẽ liên hệ với bạn để xác nhận tình trạng
            sản phẩm, phí giao hàng và phương thức thanh toán.
          </p>
          <div className="success-actions">
            <Link className="btn secondary-btn" to="/cart">
              <Icon>receipt_long</Icon> XEM LẠI GIỎ HÀNG
            </Link>
            <Link className="btn primary" to="/shop">
              <Icon>shopping_bag</Icon> TIẾP TỤC XEM SẢN PHẨM
            </Link>
          </div>
        </article>
      </section>
    </PublicShell>
  );
}
