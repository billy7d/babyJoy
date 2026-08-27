import { Link, NavLink, useNavigate } from "react-router";
import type { Product } from "../lib/catalog";
import { findVariantInProducts, formatVnd } from "../lib/catalog";
import { useCart } from "../lib/cart";
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

export function MobileBottomNav() {
  const { totalQuantity } = useCart();
  const links = [
    ["/", "home", "Trang chủ"],
    ["/shop", "grid_view", "Sản phẩm"],
    ["/search", "search", "Tìm kiếm"],
    ["/cart", "shopping_basket", "Giỏ hàng"],
  ];
  return (
    <nav className="mobile-bottom" aria-label="Điều hướng di động">
      {links.map(([to, icon, label]) => (
        <NavLink key={to} to={to} end={to === "/"}>
          <span className="nav-icon">
            <Icon>{icon}</Icon>
            {to === "/cart" && totalQuantity > 0 && <b>{totalQuantity}</b>}
          </span>
          <small>{label}</small>
        </NavLink>
      ))}
    </nav>
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
  return (
    <>
      <PublicHeader />
      <main className="public-main">{children}</main>
      <PublicFooter />
      {!hideMobileNav && <MobileBottomNav />}
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
  const { addItem } = useCart();
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
          <button
            className="round-add"
            disabled={unavailable}
            onClick={() => addItem(variant.id)}
            aria-label={`Thêm ${product.name} vào giỏ`}
          >
            <Icon>{compact ? "add" : "add_shopping_cart"}</Icon>
          </button>
        </div>
      </div>
    </article>
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
    LEGACY: "Legacy",
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
