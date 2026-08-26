import { HomePage } from "../components/public-pages";
import { CartProvider } from "../lib/cart";

export function meta() {
  return [
    { title: "BabyJoy - Dinh dưỡng trọn vẹn cho bé yêu" },
    { name: "description", content: "Đồ ăn dặm hữu cơ, an toàn và đa dạng cho bé." },
  ];
}

export default function HomeRoute() {
  return <CartProvider><HomePage /></CartProvider>;
}
