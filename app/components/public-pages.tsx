import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { formatVnd, type Product } from "../lib/catalog";
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
  copyAndOpenSeller,
  getCartShareSubmissionToken,
  recordSellerMessengerOpened,
  readPreparedCartShare,
  runNativeCartShare,
  writePreparedCartShare,
  type PreparedCartShare,
  type SellerContact,
} from "../lib/cart-share";
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
  const featured = products.filter((product) => product.featured).slice(0, 4);
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
            <h2>Sản phẩm nổi bật</h2>
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
  params: URLSearchParams,
  forcedCategory?: string,
) {
  const q = (params.get("q") ?? "").trim().toLocaleLowerCase("vi");
  const category = forcedCategory ?? params.get("category");
  const brand = params.get("brand");
  const age = params.get("age");
  const tag = params.get("tag");
  const available = params.get("available");
  const sort = params.get("sort") ?? "default";
  const filtered = source.filter((product) => {
    const searchText =
      `${product.name} ${product.brand} ${product.tags.join(" ")}`.toLocaleLowerCase(
        "vi",
      );
    return (
      (!q || searchText.includes(q)) &&
      (!category || product.category === category) &&
      (!brand || product.brand === brand) &&
      (!age || product.age.startsWith(age)) &&
      (!tag || product.tags.includes(tag)) &&
      (!available ||
        product.variants.some(
          (variant) => variant.availability === "AVAILABLE",
        ))
    );
  });
  return filtered.sort((a, b) => {
    const aPrice = a.variants[0].priceVnd;
    const bPrice = b.variants[0].priceVnd;
    if (sort === "price_asc") return aPrice - bPrice;
    if (sort === "price_desc") return bPrice - aPrice;
    if (sort === "newest") return b.id.localeCompare(a.id);
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
  const { products, categories } = useCatalog();
  const [params, setParams] = useSearchParams();
  const [mobileFilters, setMobileFilters] = useState(false);
  const filtered = useMemo(
    () => applyFilters(products, params, categorySlug),
    [products, params, categorySlug],
  );
  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
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
            type="radio"
            name="category"
            checked={(categorySlug ?? params.get("category")) === item.slug}
            disabled={Boolean(categorySlug)}
            onChange={() => setFilter("category", item.slug)}
          />
          {item.name}
        </label>
      ))}
      <h3>Độ tuổi</h3>
      {["4+", "6+", "8+", "12+"].map((item) => (
        <label key={item}>
          <input
            type="radio"
            name="age"
            checked={params.get("age") === item}
            onChange={() => setFilter("age", item)}
          />
          {item} tháng
        </label>
      ))}
      <h3>Thương hiệu</h3>
      {["Gerber", "Heinz", "HiPP", "Wakodo"].map((item) => (
        <label key={item}>
          <input
            type="radio"
            name="brand"
            checked={params.get("brand") === item}
            onChange={() => setFilter("brand", item)}
          />
          {item}
        </label>
      ))}
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
              className={params.get("category") === item.slug ? "active" : ""}
              onClick={() => setFilter("category", item.slug)}
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
  const [variantId, setVariantId] = useState(product.variants[0].id);
  const [quantity, setQuantity] = useState(1);
  const [toast, setToast] = useState(false);
  const [selectedImage, setSelectedImage] = useState(0);
  const { addItem } = useCart();
  const variant =
    product.variants.find((item) => item.id === variantId) ??
    product.variants[0];
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
            <Price value={variant.priceVnd} />
            {variant.compareAtPriceVnd && (
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
                >
                  {item.name}
                </button>
              ))}
            </div>
          </div>
          <div className="detail-quantity">
            <span>Số lượng</span>
            <QuantityStepper value={quantity} onChange={setQuantity} />
            <small>Còn hàng</small>
          </div>
          <button className="btn primary add-cart" onClick={add}>
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
        <QuantityStepper value={quantity} onChange={setQuantity} />
        <button className="btn primary" onClick={add}>
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
              {lines.map(({ product, variant, quantity, lineTotal }) => (
                <article className="cart-item" key={variant.id}>
                  <ProductImage product={product} />
                  <div className="cart-item-info">
                    <h2>{product.name}</h2>
                    <Tag>{variant.name}</Tag>
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
                  <QuantityStepper variantId={variant.id} value={quantity} />
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
        <>
          <p className="info-box">
            <Icon>info</Icon>Giỏ hàng sẽ được gửi đến người bán để kiểm tra và
            liên hệ xác nhận.
          </p>
          <Link className="btn primary" to="/cart/submit">
            GỬI CHO NGƯỜI BÁN <Icon>send</Icon>
          </Link>
        </>
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
  const fingerprint = cartShareFingerprint(cart.items);
  const [prepared, setPrepared] = useState<PreparedCartShare | null>(() =>
    readPreparedCartShare(),
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [priceChanges, setPriceChanges] = useState<PriceChange[]>([]);
  const [manualCopy, setManualCopy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [returned, setReturned] = useState(false);
  const manualTextRef = useRef<HTMLTextAreaElement>(null);
  const stale = Boolean(prepared && prepared.fingerprint !== fingerprint);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && prepared) setReturned(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [prepared]);

  const prepare = async (acceptCurrentPrices = false, forceNew = false) => {
    setBusy(true);
    setMessage("");
    setPriceChanges([]);
    try {
      if (!lines.length) throw new Error("Giỏ hàng đang trống.");
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
      setPrepared(value);
      setReturned(false);
    } catch (caught) {
      setMessage(
        caught instanceof Error ? caught.message : "Chưa thể chốt giỏ hàng.",
      );
    } finally {
      setBusy(false);
    }
  };

  const openSeller = async () => {
    if (!prepared || stale) return;
    setCopied(false);
    setMessage("");
    try {
      await copyAndOpenSeller({
        copyText: prepared.share.copyText,
        messengerUrl: prepared.seller.messengerUrl,
        code: prepared.cartRequest.code,
        onCopied: () => {
          setCopied(true);
          setReturned(true);
          console.info(
            JSON.stringify({
              event: "seller_copy_success",
              publicCode: prepared.cartRequest.code,
            }),
          );
        },
      });
    } catch {
      console.warn(
        JSON.stringify({
          event: "seller_copy_failed",
          publicCode: prepared.cartRequest.code,
        }),
      );
      setManualCopy(true);
    }
  };

  const copyManually = async () => {
    if (!prepared) return;
    try {
      await navigator.clipboard.writeText(prepared.share.copyText);
      setCopied(true);
    } catch {
      // Giữ vùng văn bản được chọn để người dùng long-press hoặc Copy thủ công.
      manualTextRef.current?.focus();
      manualTextRef.current?.select();
    }
  };

  const secondaryShare = async () => {
    if (!prepared || stale) return;
    const result = await runNativeCartShare(prepared.share);
    if (result === "CANCELLED") {
      console.info(
        JSON.stringify({
          event: "native_share_cancelled",
          publicCode: prepared.cartRequest.code,
        }),
      );
      return;
    }
    console.info(
      JSON.stringify({
        event: result === "SHARED" ? "native_share_opened" : "native_share_failed",
        publicCode: prepared.cartRequest.code,
      }),
    );
    if (result === "UNAVAILABLE" || result === "FAILED") {
      try {
        await navigator.clipboard.writeText(prepared.share.copyText);
        setCopied(true);
        setMessage("Đã sao chép thông tin giỏ hàng.");
      } catch {
        setManualCopy(true);
      }
    }
  };

  if (!prepared || stale) {
    return (
      <div className="direct-share-checkout">
        {stale && (
          <p className="share-warning" role="alert">
            Giỏ hàng đã thay đổi. Vui lòng chốt lại trước khi gửi.
          </p>
        )}
        <p className="direct-share-help">
          BabyJoy sẽ kiểm tra lại giá và tình trạng sản phẩm trước khi tạo thông
          tin gửi cho shop.
        </p>
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
          disabled={busy}
          onClick={() => void prepare(false, stale)}
        >
          {busy ? "ĐANG KIỂM TRA..." : "CHỐT GIỎ HÀNG"}
        </button>
      </div>
    );
  }

  return (
    <div className="prepared-share" role="status">
      <div className="prepared-heading">
        <Icon>check_circle</Icon>
        <div>
          <b>GIỎ HÀNG ĐÃ SẴN SÀNG</b>
          <span>Mã {prepared.cartRequest.code}</span>
        </div>
      </div>
      <p>
        {prepared.cartRequest.itemLineCount} mặt hàng • {prepared.cartRequest.totalQuantity} sản phẩm
      </p>
      <Price value={prepared.cartRequest.subtotalVnd} />
      <span className="seller-caption">GỬI GIỎ HÀNG TỚI</span>
      <div className="seller-card">
        {prepared.seller.avatarUrl ? (
          <img src={prepared.seller.avatarUrl} alt="" />
        ) : (
          <span className="seller-avatar"><Icon>person</Icon></span>
        )}
        <p>
          <b>{prepared.seller.displayName}</b>
          <span>{prepared.seller.label}</span>
          <small>Liên hệ BabyJoy</small>
        </p>
      </div>
      {copied && <p className="copy-success">Đã sao chép giỏ hàng</p>}
      {returned && (
        <p className="return-note">
          Giỏ hàng vẫn được giữ lại để bạn có thể gửi lại nếu cần.
        </p>
      )}
      <button className="btn primary messenger-primary" onClick={() => void openSeller()}>
        <Icon>forum</Icon> NHẮN SHOP QUA MESSENGER
      </button>
      <small className="copy-explanation">
        Chúng tôi sẽ sao chép nội dung giỏ hàng trước khi mở Messenger.
      </small>
      <div className="share-divider"><span>hoặc</span></div>
      <button className="btn secondary-btn web-share-secondary" onClick={() => void secondaryShare()}>
        <Icon>{typeof navigator !== "undefined" && typeof navigator.share === "function" ? "ios_share" : "content_copy"}</Icon>
        {typeof navigator !== "undefined" && typeof navigator.share === "function"
          ? "CHIA SẺ BẰNG ỨNG DỤNG KHÁC"
          : "SAO CHÉP THÔNG TIN"}
      </button>
      {message && <p className="form-error">{message}</p>}
      {manualCopy && (
        <div className="manual-copy-sheet" role="dialog" aria-modal="true" aria-labelledby="manual-copy-title">
          <div className="manual-copy-panel">
            <h2 id="manual-copy-title">SAO CHÉP GIỎ HÀNG</h2>
            <p>Trước khi mở Messenger, hãy sao chép nội dung bên dưới.</p>
            <textarea
              ref={manualTextRef}
              readOnly
              value={prepared.share.copyText}
              aria-label="Nội dung giỏ hàng để sao chép"
            />
            <button className="btn primary" onClick={() => void copyManually()}>
              <Icon>content_copy</Icon> SAO CHÉP
            </button>
            <button
              className="btn secondary-btn"
              onClick={() => {
                recordSellerMessengerOpened(prepared.cartRequest.code);
                window.location.assign(prepared.seller.messengerUrl);
              }}
            >
              MỞ MESSENGER CỦA {prepared.seller.displayName.toLocaleUpperCase("vi-VN")}
            </button>
            <button className="manual-close" onClick={() => setManualCopy(false)}>
              Đóng
            </button>
          </div>
        </div>
      )}
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
    window.location.assign(url);
  };

  const start = async (forceNew = false) => {
    setBusy(true);
    setMessage("");
    try {
      if (!lines.length) throw new Error("Giỏ hàng đang trống.");
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
        {!expired && (
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
            <button className="btn primary" onClick={() => openMessenger(pending.messengerUrl)}>
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
      <button className="btn primary" disabled={busy} onClick={() => void start()}>
        {busy ? "ĐANG TẠO PHIÊN..." : "XÁC NHẬN QUA MESSENGER"} <Icon>send</Icon>
      </button>
    </div>
  );
}

type SubmitResult = {
  success: true;
  cartRequest: {
    code: string;
    itemLineCount: number;
    totalQuantity: number;
    subtotalVnd: number;
    createdAt: string;
  };
  telegramStatus: string;
};

export function SubmitCartPage() {
  const cart = useCart();
  const { products } = useCatalog();
  const lines = cartDetails(cart.items, products);
  const navigate = useNavigate();
  const checkoutConfig = useCheckoutConfig();
  const tokenRef = useRef(
    typeof crypto !== "undefined" ? crypto.randomUUID() : `local-${Date.now()}`,
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (checkoutConfig?.enabled || checkoutConfig?.messengerCheckoutEnabled)
      navigate("/cart", { replace: true });
  }, [checkoutConfig, navigate]);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const payload = {
      submissionToken: tokenRef.current,
      customerName: form.get("name"),
      customerPhone: form.get("phone"),
      customerContact: form.get("contact"),
      customerNote: form.get("note"),
      items: lines.map(({ variant, quantity }) => ({
        variantId: variant.id,
        quantity,
        displayedPrice: variant.priceVnd,
      })),
    };
    try {
      const response = await fetch("/api/cart-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json()) as
        SubmitResult | { error?: { code?: string; message?: string } };
      if (!response.ok || !("success" in body))
        throw new Error(
          "error" in body && body.error?.message
            ? body.error.message
            : "Chưa thể gửi giỏ hàng.",
        );
      window.sessionStorage.setItem(
        "babyjoy.lastSubmittedCart.v1",
        JSON.stringify({
          ...body.cartRequest,
          items: lines,
          contactChannel: "LEGACY",
        }),
      );
      cart.clear();
      navigate(`/cart/success/${body.cartRequest.code}`);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Chưa thể gửi giỏ hàng. Thông tin của bạn vẫn được giữ lại.",
      );
    } finally {
      setBusy(false);
    }
  };
  if (!checkoutConfig || checkoutConfig.enabled || checkoutConfig.messengerCheckoutEnabled)
    return (
      <PublicShell hideMobileNav>
        <section className="submit-page">
          <div className="empty-state">
            <Icon>progress_activity</Icon>
            <p>Đang mở xác nhận Messenger...</p>
          </div>
        </section>
      </PublicShell>
    );
  return (
    <PublicShell hideMobileNav>
      <section className="submit-page">
        <div className="submit-intro">
          <Link className="submit-back" to="/cart">
            <Icon>arrow_back_ios_new</Icon>
          </Link>
          <h1>Gửi giỏ hàng</h1>
          <p>
            Để hoàn tất việc gửi giỏ hàng, vui lòng cung cấp thông tin liên hệ
            bên dưới. Người bán sẽ kiểm tra giỏ hàng và liên hệ với bạn để xác
            nhận tình trạng sản phẩm, phí giao hàng và phương thức thanh toán.
          </p>
        </div>
        <form className="contact-form" onSubmit={submit}>
          <div className="form-grid">
            <label>
              Họ và Tên
              <input
                name="name"
                required
                maxLength={120}
                autoComplete="name"
                placeholder="Nguyễn Văn A"
              />
            </label>
            <label>
              Số điện thoại *
              <input
                name="phone"
                required
                maxLength={30}
                inputMode="tel"
                autoComplete="tel"
                placeholder="0912 345 678"
              />
            </label>
          </div>
          <label>
            Telegram / Facebook Link <small>(Tuỳ chọn)</small>
            <input
              name="contact"
              maxLength={255}
              placeholder="https://t.me/username hoặc https://facebook.com/username"
            />
          </label>
          <label>
            Ghi chú thêm
            <textarea
              name="note"
              maxLength={1000}
              placeholder="Ví dụ: Bé nhà mình hay bị dị ứng đậu phộng..."
            />
          </label>
          <p className="privacy">
            <Icon>lock</Icon>Thông tin của bạn sẽ được bảo mật và chỉ sử dụng
            mục đích liên hệ xử lý giỏ hàng ăn dặm cho bé. Tham khảo{" "}
            <a href="#privacy">Chính sách bảo mật</a> của chúng tôi.
          </p>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="btn primary submit-button"
            disabled={busy || lines.length === 0}
          >
            {busy ? "ĐANG GỬI..." : "XÁC NHẬN GỬI GIỎ HÀNG"} <Icon>send</Icon>
          </button>
        </form>
        <SubmitSummary
          lines={lines}
          subtotal={cart.subtotalVnd}
          quantity={cart.totalQuantity}
        />
      </section>
    </PublicShell>
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

function SubmitSummary({
  lines,
  subtotal,
  quantity,
}: {
  lines: ReturnType<typeof cartDetails>;
  subtotal: number;
  quantity: number;
}) {
  return (
    <aside className="submit-summary">
      <h2>
        Tóm tắt giỏ hàng <Tag>{lines.length} sản phẩm</Tag>
      </h2>
      <div className="summary-lines">
        {lines.map(
          ({ product, variant, quantity: lineQuantity, lineTotal }) => (
            <div key={variant.id}>
              <ProductImage product={product} alt="" />
              <p>
                <b>{product.name}</b>
                <span>Số lượng: {lineQuantity}</span>
              </p>
              <Price value={lineTotal} />
            </div>
          ),
        )}
      </div>
      <dl>
        <div>
          <dt>Số lượng mặt hàng</dt>
          <dd>{lines.length}</dd>
        </div>
        <div>
          <dt>Tổng số lượng sản phẩm</dt>
          <dd>{quantity}</dd>
        </div>
        <div>
          <dt>Tạm tính</dt>
          <dd>{formatVnd(subtotal)}</dd>
        </div>
        <div>
          <dt>Phí giao hàng</dt>
          <dd>Chờ xác nhận</dd>
        </div>
      </dl>
      <div className="expected">
        <span>TỔNG DỰ KIẾN</span>
        <Price value={subtotal} />
      </div>
      <p className="shipping-note">
        <Icon>info</Icon>Phí giao hàng sẽ được người bán xác nhận.
      </p>
    </aside>
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
