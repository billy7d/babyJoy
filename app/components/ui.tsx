import { useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router";
import type { Availability, Product } from "../lib/catalog";
import { findVariantInProducts, formatVnd } from "../lib/catalog";
import { useCatalog } from "../lib/catalog-context";
import { useCart } from "../lib/cart";
import { searchCatalog } from "../lib/search";
import { ProductImage } from "./product-image";

export function Icon({
  children,
  className = "",
}: {
  children: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`material-symbols-outlined ${className}`}
    >
      {children}
    </span>
  );
}

export function Logo() {
  return (
    <Link to="/" className="brand" aria-label="BabyJoy - Trang chủ">
      <img src="/images/logo.png" alt="" />
      <span>BabyJoy</span>
    </Link>
  );
}

export function PublicHeader() {
  const { totalQuantity } = useCart();
  const navigate = useNavigate();
  return (
    <header className="public-header">
      <div className="header-inner">
        <Logo />
        <nav className="desktop-nav" aria-label="Điều hướng chính">
          <NavLink to="/">Trang chủ</NavLink>
          <NavLink to="/shop">Sản phẩm</NavLink>
          <NavLink to="/categories">Danh mục</NavLink>
        </nav>
        <form
          className="header-search"
          onSubmit={(event) => {
            event.preventDefault();
            const value = new FormData(event.currentTarget).get("q");
            navigate(`/search?q=${encodeURIComponent(String(value ?? ""))}`);
          }}
        >
          <Icon>search</Icon>
          <input
            name="q"
            aria-label="Tìm kiếm"
            placeholder="Tìm kiếm đồ ăn dặm cho bé..."
          />
        </form>
        <Link
          className="cart-link"
          to="/cart"
          aria-label={`Giỏ hàng, ${totalQuantity} sản phẩm`}
        >
          <Icon>shopping_cart</Icon>
          {totalQuantity > 0 && <b>{totalQuantity}</b>}
        </Link>
      </div>
    </header>
  );
}

export function MobileBottomNav({ onSearch }: { onSearch: () => void }) {
  const { totalQuantity } = useCart();
  const links = [
    ["/", "home", "Trang chủ"],
    ["/shop", "grid_view", "Sản phẩm"],
    ["/cart", "shopping_basket", "Giỏ hàng"],
  ];
  return (
    <nav className="mobile-bottom" aria-label="Điều hướng di động">
      {links.slice(0, 2).map(([to, icon, label]) => (
        <MobileNavLink key={to} to={to} icon={icon} label={label} />
      ))}
      <button type="button" onClick={onSearch} aria-label="Mở tìm kiếm">
        <span className="nav-icon"><Icon>search</Icon></span>
        <small>Tìm kiếm</small>
      </button>
      {links.slice(2).map(([to, icon, label]) => (
        <NavLink key={to} to={to}>
          <span className="nav-icon">
            <Icon>{icon}</Icon>
            {totalQuantity > 0 && <b>{totalQuantity}</b>}
          </span>
          <small>{label}</small>
        </NavLink>
      ))}
    </nav>
  );
}

function MobileNavLink({ to, icon, label }: { to: string; icon: string; label: string }) {
  return (
    <NavLink to={to} end={to === "/"}>
      <span className="nav-icon"><Icon>{icon}</Icon></span>
      <small>{label}</small>
    </NavLink>
  );
}

export function PublicFooter() {
  return (
    <footer className="public-footer">
      <div className="footer-grid">
        <div>
          <Logo />
          <p>Đồng hành cùng mẹ trong hành trình ăn dặm hạnh phúc của bé yêu.</p>
        </div>
        <div>
          <h4>Hỗ trợ</h4>
          <a href="#shipping">Chính sách vận chuyển</a>
          <a href="#guide">Hướng dẫn mua hàng</a>
          <a href="#returns">Đổi trả & Hoàn tiền</a>
        </div>
        <div>
          <h4>Liên hệ</h4>
          <p>
            <Icon>mail</Icon> hello@babyjoy.vn
          </p>
          <p>
            <Icon>call</Icon> 1900 123 456
          </p>
        </div>
      </div>
      <div className="copyright">
        © 2024 BabyJoy - Dinh dưỡng trọn vẹn cho bé yêu.
      </div>
    </footer>
  );
}

export function PublicShell({
  children,
  hideMobileNav = false,
}: {
  children: React.ReactNode;
  hideMobileNav?: boolean;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  return (
    <>
      <div
        className="public-shell-content"
        inert={searchOpen ? true : undefined}
        aria-hidden={searchOpen ? true : undefined}
      >
        <PublicHeader />
        <main className="public-main">{children}</main>
        <PublicFooter />
        {!hideMobileNav && <MobileBottomNav onSearch={() => setSearchOpen(true)} />}
      </div>
      {searchOpen && <MobileSearchModal onClose={() => setSearchOpen(false)} />}
    </>
  );
}

export function Price({
  value,
  className = "",
}: {
  value: number;
  className?: string;
}) {
  return <span className={`price ${className}`}>{formatVnd(value)}</span>;
}

export function Tag({
  children,
  tone = "secondary",
}: {
  children: React.ReactNode;
  tone?: "secondary" | "primary" | "error" | "neutral";
}) {
  return <span className={`tag tag-${tone}`}>{children}</span>;
}

export function ProductCard({
  product,
  compact = false,
}: {
  product: Product;
  compact?: boolean;
}) {
  const variant = product.variants[0];
  const unavailable = variant.availability !== "AVAILABLE";
  return (
    <article
      className={`product-card ${compact ? "compact" : ""} ${unavailable ? "unavailable" : ""}`}
    >
      <Link to={`/product/${product.slug}`} className="product-image">
        <ProductImage product={product} loading="lazy" />
        <span className="product-tags">
          {unavailable ? (
            <Tag tone="error">Hết hàng</Tag>
          ) : (
            product.tags.slice(0, 1).map((tag) => <Tag key={tag}>{tag}</Tag>)
          )}
          <Tag tone="neutral">{product.age}</Tag>
        </span>
      </Link>
      <div className="product-body">
        <Link to={`/product/${product.slug}`}>
          <h3>{product.name}</h3>
        </Link>
        {!compact && <p>{product.shortDescription}</p>}
        <div className="product-foot">
          <Price value={variant.priceVnd} />
          <InlineCartControl product={product} />
        </div>
      </div>
    </article>
  );
}

export function InlineCartControl({ product }: { product: Product }) {
  const cart = useCart();
  const variant = product.variants[0];
  const quantity =
    cart.items.find((item) => item.variantId === variant.id)?.quantity ?? 0;
  const unavailable = variant.availability !== "AVAILABLE";
  if (quantity === 0) {
    return (
      <button
        type="button"
        className="inline-cart-add"
        disabled={unavailable}
        onClick={() => cart.incrementItem(variant.id)}
        aria-label={`Thêm ${product.name} vào giỏ hàng`}
      >
        {unavailable ? "Hết hàng" : "Thêm giỏ hàng"}
      </button>
    );
  }
  return (
    <div className="inline-cart-quantity" aria-label={`Số lượng ${product.name}: ${quantity}`}>
      <button
        type="button"
        aria-label={`Giảm số lượng ${product.name}`}
        onClick={() => cart.decrementItem(variant.id)}
      >
        <Icon>remove</Icon>
      </button>
      <strong aria-live="polite">{quantity}</strong>
      <button
        type="button"
        aria-label={`Tăng số lượng ${product.name}`}
        disabled={isInlineCartIncrementDisabled(variant.availability, quantity)}
        onClick={() => cart.incrementItem(variant.id)}
      >
        <Icon>add</Icon>
      </button>
    </div>
  );
}

export function isInlineCartIncrementDisabled(
  availability: Availability,
  quantity: number,
) {
  return availability !== "AVAILABLE" || quantity >= 99;
}

function MobileSearchModal({ onClose }: { onClose: () => void }) {
  const { products, categories, loading } = useCatalog();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const results = useMemo(
    () => searchCatalog(products, categories, query),
    [products, categories, query],
  );
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    inputRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled])',
        ),
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);
  const go = (to: string) => {
    onClose();
    navigate(to);
  };
  const hasQuery = query.trim().length > 0;
  const noResults = hasQuery && !results.categories.length && !results.products.length;
  return (
    <div
      ref={dialogRef}
      className="mobile-search-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mobile-search-title"
    >
      <header>
        <h2 id="mobile-search-title">Tìm kiếm</h2>
        <button type="button" onClick={onClose} aria-label="Đóng tìm kiếm">
          <Icon>close</Icon>
        </button>
      </header>
      <label className="mobile-search-input">
        <Icon>search</Icon>
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Tìm kiếm đồ ăn dặm cho bé..."
          aria-label="Tìm kiếm sản phẩm và danh mục"
        />
        {query && (
          <button type="button" onClick={() => setQuery("")} aria-label="Xóa từ khóa">
            <Icon>cancel</Icon>
          </button>
        )}
      </label>
      <div className="mobile-search-results">
        {!hasQuery && (
          <section>
            <h3>Danh mục</h3>
            <div className="mobile-search-categories">
              {results.categories.map((category) => (
                <button key={category.id} type="button" onClick={() => go(`/category/${category.slug}`)}>
                  <img src={category.image} alt="" />
                  <span>{category.name}</span>
                  <Icon>chevron_right</Icon>
                </button>
              ))}
            </div>
          </section>
        )}
        {hasQuery && results.categories.length > 0 && (
          <section>
            <h3>Danh mục</h3>
            <div className="mobile-search-category-matches">
              {results.categories.map((category) => (
                <button key={category.id} type="button" onClick={() => go(`/category/${category.slug}`)}>
                  {category.name}<Icon>arrow_forward</Icon>
                </button>
              ))}
            </div>
          </section>
        )}
        {hasQuery && results.products.length > 0 && (
          <section>
            <h3>Sản phẩm</h3>
            <div className="mobile-search-products">
              {results.products.map((product) => (
                <article key={product.id}>
                  <button className="search-product-link" type="button" onClick={() => go(`/product/${product.slug}`)}>
                    <ProductImage product={product} />
                    <span><b>{product.name}</b><Price value={product.variants[0].priceVnd} /></span>
                  </button>
                  <InlineCartControl product={product} />
                </article>
              ))}
            </div>
          </section>
        )}
        {loading && <p className="mobile-search-status">Đang cập nhật sản phẩm…</p>}
        {noResults && (
          <div className="mobile-search-empty" role="status">
            <Icon>search_off</Icon>
            <h3>Không tìm thấy sản phẩm phù hợp</h3>
            <p>Hãy thử một từ khóa ngắn hơn hoặc tên danh mục.</p>
          </div>
        )}
      </div>
    </div>
  );
}

export function QuantityStepper({
  variantId,
  value,
  onChange,
}: {
  variantId?: string;
  value: number;
  onChange?: (value: number) => void;
}) {
  const cart = useCart();
  const update = (next: number) =>
    onChange ? onChange(next) : variantId && cart.setQuantity(variantId, next);
  return (
    <div className="quantity-stepper">
      <button
        aria-label="Giảm số lượng"
        onClick={() => update(Math.max(1, value - 1))}
      >
        <Icon>remove</Icon>
      </button>
      <span>{value}</span>
      <button
        aria-label="Tăng số lượng"
        onClick={() => update(Math.min(99, value + 1))}
      >
        <Icon>add</Icon>
      </button>
    </div>
  );
}

const adminLinks = [
  ["/admin/products", "restaurant_menu", "Sản phẩm"],
  ["/admin/categories", "category", "Danh mục"],
  ["/admin/tags", "sell", "Tags"],
  ["/admin/cart-requests", "shopping_basket", "Giỏ hàng gửi đến"],
  ["/admin/settings", "settings", "Cài đặt"],
];

export function AdminShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <Logo />
        <nav>
          {adminLinks.map(([to, icon, label]) => (
            <NavLink key={to} to={to}>
              <Icon>{icon}</Icon>
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <section className="admin-workspace">
        <header className="admin-top">
          <h2>{title}</h2>
          <div>
            <Icon>search</Icon>
            <Icon>notifications</Icon>
            <span className="admin-avatar">
              <Icon>person</Icon>
            </span>
          </div>
        </header>
        <main className="admin-main">{children}</main>
      </section>
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    AVAILABLE: "Đang bán",
    OUT_OF_STOCK: "Hết hàng",
    HIDDEN: "Đã ẩn",
    SUBMITTED: "Mới",
    CONTACTED: "Đã liên hệ",
    CONFIRMED: "Đã xác nhận",
    COMPLETED: "Hoàn thành",
    CANCELLED: "Đã hủy",
    SENT: "Đã gửi",
    FAILED: "Gửi lỗi",
    NOT_APPLICABLE: "Không áp dụng",
    PENDING: "Chờ xác nhận",
    SENDING: "Đang gửi",
    CREATED: "Chờ xác nhận",
    IDENTIFIED: "Đã nhận diện",
    EXPIRED: "Hết hạn",
    MESSENGER: "Messenger",
    LEGACY: "Kênh cũ",
    SHARE: "Chia sẻ thủ công",
    SHARE_READY: "Đã tạo giỏ chia sẻ",
  };
  return (
    <span className={`status status-${status.toLowerCase()}`}>
      {map[status] ?? status}
    </span>
  );
}

export function cartDetails(
  items: { variantId: string; quantity: number }[],
  products: Product[],
) {
  return items.flatMap((line) => {
    const found = findVariantInProducts(products, line.variantId);
    return found
      ? [
          {
            ...found,
            ...line,
            lineTotal: found.variant.priceVnd * line.quantity,
          },
        ]
      : [];
  });
}
