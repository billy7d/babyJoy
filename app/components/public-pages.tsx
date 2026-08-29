import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import {
  formatVnd,
  getDefaultVariant,
  getDisplayVariant,
  type Category,
  type Product,
} from "../lib/catalog";
import { useCatalog } from "../lib/catalog-context";
import { useCart } from "../lib/cart";
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
            Khám phá thế giới dinh dưỡng sạch, an toàn và đa dạng. Cùng BabyJoy
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
          {featured.map((product) => (
            <ProductCard key={product.id} product={product} compact />
          ))}
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
      (!tag || product.tags.includes(tag)) &&
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
  const { products, categories, brands } = useCatalog();
  const [params, setParams] = useSearchParams();
  const [mobileFilters, setMobileFilters] = useState(false);
  const filtered = useMemo(
    () => applyFilters(products, categories, params, categorySlug),
    [products, categories, params, categorySlug],
  );
  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
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
        {[
          "Hữu cơ",
          "Không chứa sữa",
          "Không thêm đường",
          "Không biến đổi gen",
        ].map((item) => (
          <button
            className={params.get("tag") === item ? "active" : ""}
            key={item}
            onClick={() =>
              setFilter("tag", params.get("tag") === item ? "" : item)
            }
          >
            {item}
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
        onClick={() => setParams(new URLSearchParams())}
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
            <p>{filtered.length} sản phẩm dinh dưỡng cho bé</p>
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
            className={!params.get("category") ? "active" : ""}
            onClick={() => setFilter("category", "")}
          >
            Tất cả
          </button>
          {categories.map((item) => (
            <button
              key={item.id}
              className={(params.get("category") ?? "").split(",").includes(item.slug) ? "active" : ""}
              onClick={() => toggleCsvFilter("category", item.slug)}
            >
              {item.name}
            </button>
          ))}
        </div>
        <div className="mobile-list-status">
          <span>Hiển thị {filtered.length} sản phẩm</span>
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
            {filtered.length ? (
              <div className="product-grid listing-grid">
                {filtered.map((product) => (
                  <ProductCard key={product.id} product={product} />
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <Icon>search_off</Icon>
                <h2>Chưa tìm thấy sản phẩm</h2>
                <p>Hãy thử từ khóa hoặc bộ lọc khác.</p>
              </div>
            )}
            <nav className="pagination" aria-label="Phân trang">
              <button disabled>‹</button>
              <button className="active">1</button>
              <button>2</button>
              <button>3</button>
              <span>…</span>
              <button>›</button>
            </nav>
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
  const { products } = useCatalog();
  const slug = decodeURIComponent(
    useLocation().pathname.split("/").filter(Boolean).at(-1) ?? "",
  );
  const product = products.find((item) => item.slug === slug) ?? products[0];
  const [variantId, setVariantId] = useState(
    () => getDefaultVariant(product)?.id ?? "",
  );
  const [quantity, setQuantity] = useState(1);
  const [toast, setToast] = useState(false);
  const [selectedImage, setSelectedImage] = useState(0);
  const { addItem } = useCart();
  useEffect(() => {
    setVariantId((current) =>
      product.variants.some((item) => item.id === current)
        ? current
        : (getDefaultVariant(product)?.id ?? ""),
    );
  }, [product]);
  const variant =
    product.variants.find((item) => item.id === variantId) ??
    getDefaultVariant(product);
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
    if (!variant || variant.availability !== "AVAILABLE") return;
    addItem(variant.id, quantity);
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
            />
            <small>
              {variant?.availability === "AVAILABLE"
                ? "Còn hàng"
                : variant?.availability === "OUT_OF_STOCK"
                  ? "Tạm hết hàng"
                  : "Không bán"
              }
            </small>
          </div>
          <button
            className="btn primary add-cart"
            onClick={add}
            disabled={!variant || variant.availability !== "AVAILABLE"}
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
              alt="Nông trại hữu cơ BabyJoy tại Đà Lạt"
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
        />
        <button
          className="btn primary"
          onClick={add}
          disabled={!variant || variant.availability !== "AVAILABLE"}
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
          <span>{lines.length} mặt hàng</span>
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
              {lines.map(({ product, variant, quantity, lineTotal, unavailable }) => (
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
                      <Price value={variant.priceVnd} />
                    </div>
                  </div>
                  <QuantityStepper
                    variantId={variant.id}
                    value={quantity}
                    availability={variant.availability}
                  />
                  <div className="line-total">
                    <span>Thành tiền</span>
                    <Price value={lineTotal} />
                  </div>
                </article>
              ))}
            </div>
            <CartSummary />
          </div>
        )}
      </section>
    </PublicShell>
  );
}

function CartSummary() {
  const cart = useCart();
  const { products } = useCatalog();
  const lines = cartDetails(cart.items, products);
  const checkoutConfig = useCheckoutConfig();
  return (
    <aside className="cart-summary">
      <h2>Tóm tắt giỏ hàng</h2>
      <div>
        <span>Tổng số lượng</span>
        <b>{cart.totalQuantity}</b>
      </div>
      <div className="subtotal">
        <span>Tạm tính</span>
        <Price value={cart.subtotalVnd} />
      </div>
      {checkoutConfig?.enabled === true ? (
        <DirectSellerShareControls lines={lines} seller={checkoutConfig.seller} />
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

function DirectSellerShareControls({
  lines,
  seller,
}: {
  lines: ReturnType<typeof cartDetails>;
  seller: SellerContact | null;
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
        cartRequest: body.cartRequest,
        share: body.share,
        seller: body.seller,
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
      <p>Giỏ hàng này đã được chốt và sẵn sàng gửi cho {prepared.seller.displayName}.</p>
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
        setMessage("BabyJoy chưa gửi được giỏ hàng qua Messenger. Giỏ hàng của bạn vẫn được giữ lại.");
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
                ? "BabyJoy đang gửi giỏ hàng"
                : "Đang chờ xác nhận trên Messenger"}
        </b>
        {hasUnavailable ? (
          <p className="form-error" role="alert">
            Phiên này có phân loại không còn khả dụng. Vui lòng quay lại giỏ hàng và xóa dòng đó.
          </p>
        ) : !expired && (
          <p>
            Mở Messenger, xác nhận giỏ hàng và quay lại BabyJoy. Shop sẽ nhận
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
  items: Array<{
    productName: string;
    variantName: string;
    imageUrl: string;
    unitPriceVnd: number;
    quantity: number;
    lineTotalVnd: number;
  }>;
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
      <Link to="/" className="share-brand" aria-label="BabyJoy - Trang chủ">
        <img src="/images/logo.png" alt="" />
        <span>BABYJOY</span>
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
          </header>
          <div className="public-share-items">
            {data.items.map((item, index) => (
              <section key={`${item.productName}-${item.variantName}-${index}`}>
                <img src={item.imageUrl} alt="" />
                <p>
                  <b>{item.productName}</b>
                  <span>{item.variantName}</span>
                  <small>{formatVnd(item.unitPriceVnd)} × {item.quantity}</small>
                </p>
                <Price value={item.lineTotalVnd} />
              </section>
            ))}
          </div>
          <footer>
            <p><span>Tổng số lượng</span><b>{data.totalQuantity}</b></p>
            <p><span>Tạm tính</span><Price value={data.subtotalVnd} /></p>
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
  const stale = prepared.fingerprint !== currentFingerprint;
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

  const openMessenger = () => {
    runWithCurrentPreparedCartShare(prepared, cart.items, () => {
      recordSellerMessengerOpened(prepared.cartRequest.code);
      console.info(
        JSON.stringify({
          event: "checkout_messenger_click",
          publicCode: prepared.cartRequest.code,
        }),
      );
      window.location.assign(prepared.seller.messengerUrl);
    }, () => !cartDetails(cart.items, products).some((line) => line.unavailable));
  };
  const copied = copyStatus === "COPIED";
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
            onMessenger={openMessenger}
          />
        </section>
        <MessengerGuideIllustration seller={prepared.seller} />
      </div>
      <div className="cart-guide-mobile-actions">
        <GuideActions
          copied={copied}
          feedback={copyFeedback}
          onCopy={() => void copyAgain()}
          onMessenger={openMessenger}
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
}: {
  copied: boolean;
  feedback: string;
  onCopy: () => void;
  onMessenger: () => void;
}) {
  return (
    <div className="cart-guide-actions">
      <span>Mở Messenger → Dán → Gửi</span>
      <button type="button" className="btn primary" onClick={onMessenger}>
        <Icon>chat_bubble</Icon> Nhắn shop trên Messenger
      </button>
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
      <div className="messenger-mockup">
        <header>
          {seller.avatarUrl ? <img src={seller.avatarUrl} alt="" /> : <span><Icon>storefront</Icon></span>}
          <p><b>{seller.displayName}</b><small>● Đang hoạt động</small></p>
        </header>
        <div className="messenger-chat">
          <p>🛒 Chi tiết giỏ hàng của bạn...</p>
        </div>
        <div className="messenger-paste-tip">Dán <Icon>content_paste</Icon></div>
        <div className="messenger-input">
          <Icon>add_circle</Icon><span>Nhắn tin...</span><Icon>send</Icon>
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
              ? "BabyJoy đã gửi chi tiết giỏ hàng vào cuộc trò chuyện Messenger của bạn. Shop sẽ tư vấn và xác nhận hàng ngay tại đó."
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
