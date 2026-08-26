import { Navigate, useLocation, useParams } from "react-router";
import type { Route } from "./+types/site";
import { CartProvider } from "../lib/cart";
import { CatalogProvider } from "../lib/catalog-context";
import { CartPage, CategoriesPage, HomePage, ProductDetailPage, ProductListPage, SubmitCartPage, SuccessPage } from "../components/public-pages";
import { AdminCartRequestDetailPage, AdminCartRequestsPage, AdminProductsPage, AdminSettingsPage, AdminTaxonomyPage, ProductEditorPage } from "../components/admin-pages";

export function meta({ location }: Route.MetaArgs) {
  const path = location.pathname;
  if (path.startsWith("/product/")) return [{ title: "Sản phẩm ăn dặm hữu cơ | BabyJoy" }, { name: "description", content: "Khám phá sản phẩm ăn dặm hữu cơ an toàn cho bé." }];
  if (path.startsWith("/admin")) return [{ title: "Quản trị BabyJoy" }, { name: "robots", content: "noindex,nofollow" }];
  return [{ title: "BabyJoy - Dinh dưỡng trọn vẹn cho bé yêu" }, { name: "description", content: "Đồ ăn dặm hữu cơ, an toàn và đa dạng cho bé." }];
}

function RoutedContent() {
  const { pathname } = useLocation();
  const params = useParams();
  if (pathname === "/") return <HomePage />;
  if (pathname === "/shop") return <ProductListPage />;
  if (pathname === "/search") return <ProductListPage searchMode />;
  if (pathname === "/categories") return <CategoriesPage />;
  if (pathname.startsWith("/category/")) return <ProductListPage categorySlug={params["*"]?.split("/")[1]} />;
  if (pathname.startsWith("/product/")) return <ProductDetailPage />;
  if (pathname === "/cart") return <CartPage />;
  if (pathname === "/cart/submit") return <SubmitCartPage />;
  if (pathname.startsWith("/cart/success/")) return <SuccessPage />;
  if (pathname === "/admin") return <Navigate to="/admin/products" replace />;
  if (pathname === "/admin/products") return <AdminProductsPage />;
  if (pathname === "/admin/products/new" || /^\/admin\/products\/[^/]+\/edit$/.test(pathname)) return <ProductEditorPage />;
  if (pathname === "/admin/categories") return <AdminTaxonomyPage type="categories" />;
  if (pathname === "/admin/tags") return <AdminTaxonomyPage type="tags" />;
  if (pathname === "/admin/cart-requests") return <AdminCartRequestsPage />;
  if (/^\/admin\/cart-requests\/[^/]+$/.test(pathname)) return <AdminCartRequestDetailPage />;
  if (pathname === "/admin/settings") return <AdminSettingsPage />;
  return <PublicNotFound />;
}

function PublicNotFound() {
  return <main className="not-found"><h1>Không tìm thấy trang</h1><a href="/">Về trang chủ</a></main>;
}

export default function SiteRoute() {
  return <CatalogProvider><CartProvider><RoutedContent /></CartProvider></CatalogProvider>;
}
