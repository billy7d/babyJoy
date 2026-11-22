import { describe, expect, it } from "vitest";
import { meta as homeMeta } from "../app/routes/home";
import { meta as siteMeta } from "../app/routes/site";
import { STORE_BRAND } from "../shared/branding";

describe("public social share metadata", () => {
  it("giữ title, Open Graph và Twitter title đồng nhất với branding chung", () => {
    expect(homeMeta()).toEqual([
      { title: STORE_BRAND },
      { property: "og:title", content: STORE_BRAND },
      { name: "twitter:title", content: STORE_BRAND },
      { name: "description", content: "Đồ ăn dặm hữu cơ, an toàn và đa dạng cho bé." },
    ]);
    expect(
      siteMeta({ location: { pathname: "/" } } as Parameters<typeof siteMeta>[0]),
    ).toEqual([
      { title: STORE_BRAND },
      { property: "og:title", content: STORE_BRAND },
      { name: "twitter:title", content: STORE_BRAND },
      { name: "description", content: "Đồ ăn dặm hữu cơ, an toàn và đa dạng cho bé." },
    ]);
  });

  it("không đổi metadata đặc thù của product và CMS", () => {
    expect(siteMeta({ location: { pathname: "/product/demo" } } as Parameters<typeof siteMeta>[0])).toEqual([
      { title: "Sản phẩm ăn dặm hữu cơ | Đồ ăn dặm UK 🍼Trà Phương🍼" },
      { name: "description", content: "Khám phá sản phẩm ăn dặm hữu cơ an toàn cho bé." },
    ]);
    expect(siteMeta({ location: { pathname: "/shipping-policy" } } as Parameters<typeof siteMeta>[0])).toEqual([
      { title: "Chính sách vận chuyển | Đồ ăn dặm UK 🍼Trà Phương🍼" },
      { name: "description", content: "Chính sách vận chuyển" },
    ]);
  });
});
