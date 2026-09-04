import { useEffect, useState } from "react";
import { redirect, useLocation, useParams } from "react-router";
import type { Route } from "./+types/site";
import { CartProvider } from "../lib/cart";
import { CatalogProvider } from "../lib/catalog-context";
import { AccessRequiredPage } from "../components/access-required";
import { CartPage, CartShareGuidePage, CategoriesPage, HomePage, ProductDetailPage, ProductListPage, PublicCartSharePage, SuccessPage } from "../components/public-pages";
import { AdminCartRequestDetailPage, AdminCartRequestsPage, AdminProductsPage, AdminSettingsPage, AdminTaxonomyPage, ProductEditorPage } from "../components/admin-pages";
import { AdminAccessLinksPage } from "../components/admin-access-links";
import { AdminPromotionsPage, PromotionEditorPage } from "../components/promotion-pages";
import {
  AdminContentPageEditorPage,
  AdminContentPagesPage,
  PublicContentPage,
} from "../components/content-pages";
import {
  contentPageLabel,
  isContentPageSlug,
} from "../../shared/content-pages";
import { STORE_BRAND } from "../../shared/branding";

export function loader({ request }: Route.LoaderArgs) {
  return new URL(request.url).pathname === "/admin"
    ? redirect("/admin/products")
    : null;
}

export function meta({ location }: Route.MetaArgs) {
  const path = location.pathname;
  if (path.startsWith("/product/")) return [{ title: `Sản phẩm ăn dặm hữu cơ | ${STORE_BRAND}` }, { name: "description", content: "Khám phá sản phẩm ăn dặm hữu cơ an toàn cho bé." }];
  if (path.startsWith("/admin")) return [{ title: `Quản trị ${STORE_BRAND}` }, { name: "robots", content: "noindex,nofollow" }];
  if (path.startsWith("/c/")) return [{ title: `Giỏ hàng ${STORE_BRAND}` }, { name: "robots", content: "noindex,nofollow,noarchive" }, { name: "referrer", content: "no-referrer" }];
  const contentPageSlug = path.slice(1);
  if (isContentPageSlug(contentPageSlug))
    return [
      { title: `${contentPageLabel(contentPageSlug)} | ${STORE_BRAND}` },
      { name: "description", content: contentPageLabel(contentPageSlug) },
    ];
  return [{ title: `${STORE_BRAND} - Dinh dưỡng trọn vẹn cho bé yêu` }, { name: "description", content: "Đồ ăn dặm hữu cơ, an toàn và đa dạng cho bé." }];
}

function RoutedContent() {
  const { pathname } = useLocation();
  const params = useParams();
  if (pathname === "/") return <HomePage />;
  if (pathname === "/access-required") return <AccessRequiredPage />;
  const contentPageSlug = pathname.slice(1);
  if (isContentPageSlug(contentPageSlug))
    return <PublicContentPage slug={contentPageSlug} />;
  if (pathname === "/shop") return <ProductListPage />;
  if (pathname === "/search") return <ProductListPage searchMode />;
  if (pathname === "/categories") return <CategoriesPage />;
  if (pathname.startsWith("/category/")) return <ProductListPage categorySlug={params["*"]?.split("/")[1]} />;
  if (pathname.startsWith("/product/")) return <ProductDetailPage />;
  if (pathname === "/cart") return <CartPage />;
  if (/^\/c\/[^/]+$/.test(pathname)) return <PublicCartSharePage />;
  if (pathname.startsWith("/cart/guide/")) return <CartShareGuidePage />;
  if (pathname.startsWith("/cart/success/")) return <SuccessPage />;
  if (pathname === "/admin/content-pages") return <AdminContentPagesPage />;
  if (/^\/admin\/content-pages\/[^/]+\/edit$/.test(pathname))
    return <AdminContentPageEditorPage />;
  if (pathname === "/admin/products") return <AdminProductsPage />;
  if (pathname === "/admin/products/new" || /^\/admin\/products\/[^/]+\/edit$/.test(pathname)) return <ProductEditorPage />;
  if (pathname === "/admin/promotions") return <AdminPromotionsPage />;
  if (pathname === "/admin/promotions/new" || /^\/admin\/promotions\/[^/]+\/edit$/.test(pathname)) return <PromotionEditorPage />;
  if (pathname === "/admin/categories") return <AdminTaxonomyPage type="categories" />;
  if (pathname === "/admin/tags") return <AdminTaxonomyPage type="tags" />;
  if (pathname === "/admin/cart-requests") return <AdminCartRequestsPage />;
  if (/^\/admin\/cart-requests\/[^/]+$/.test(pathname)) return <AdminCartRequestDetailPage />;
  if (pathname === "/admin/access-links") return <AdminAccessLinksPage />;
  if (pathname === "/admin/settings") return <AdminSettingsPage />;
  return <PublicNotFound />;
}

function PublicNotFound() {
  return <main className="not-found"><h1>Không tìm thấy trang</h1><a href="/">Về trang chủ</a></main>;
}

function ProtectedStorefrontApp() {
  const { pathname } = useLocation();
  const [allowed, setAllowed] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const response = await fetch("/api/storefront/session", {
          headers: { accept: "application/json" },
        });
        if (!cancelled && !response.ok)
          setAllowed(false);
      } catch {
        // The server-side route gate remains authoritative during a transient
        // client check failure.
      }
    };
    void check();
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, [pathname]);

  if (!allowed) return <AccessRequiredPage />;
  return <CatalogProvider><CartProvider><RoutedContent /></CartProvider></CatalogProvider>;
}

export default function SiteRoute() {
  const pathname = useLocation().pathname;
  const noCatalogProvider =
    pathname.startsWith("/admin") ||
    pathname === "/access-required" ||
    /^\/c\/[^/]+$/.test(pathname);
  if (noCatalogProvider) return <RoutedContent />;
  return <ProtectedStorefrontApp />;
}
