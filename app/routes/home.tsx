import { HomePage } from "../components/public-pages";
import { CartProvider } from "../lib/cart";
import { CatalogProvider } from "../lib/catalog-context";
import { DEFAULT_STORE_SETTINGS } from "../../shared/store-settings";

export function meta() {
  return [
    { title: `${DEFAULT_STORE_SETTINGS.displayName} - Dinh dưỡng trọn vẹn cho bé yêu` },
    { name: "description", content: "Đồ ăn dặm hữu cơ, an toàn và đa dạng cho bé." },
  ];
}

export default function HomeRoute() {
  return <CatalogProvider><CartProvider><HomePage /></CartProvider></CatalogProvider>;
}
