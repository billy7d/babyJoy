export type Availability = "AVAILABLE" | "OUT_OF_STOCK" | "HIDDEN";

export type Variant = {
  id: string;
  name: string;
  sku: string;
  priceVnd: number;
  compareAtPriceVnd?: number;
  availability: Availability;
};

export type ProductImageRecord = {
  id?: string;
  r2Key: string;
  altText: string;
  sortOrder: number;
  url: string;
};

export type Product = {
  id: string;
  slug: string;
  name: string;
  brand: string;
  brandId?: string | null;
  brandSlug?: string | null;
  shortDescription: string;
  description: string;
  image: string;
  imageKey?: string | null;
  images?: ProductImageRecord[];
  category: string;
  categories?: string[];
  categoryIds?: string[];
  age: string;
  minAgeMonths?: number | null;
  isBestSeller?: boolean;
  bestSellerRank?: number | null;
  archivedAt?: string | null;
  tags: string[];
  featured?: boolean;
  variants: Variant[];
};

export type Category = {
  id: string;
  name: string;
  slug: string;
  image: string;
  description?: string;
  sortOrder?: number;
  isActive?: boolean;
  productCount?: number;
};

export type Brand = {
  id: string;
  name: string;
  slug: string;
  sortOrder?: number;
  isActive?: boolean;
};

export const categories: Category[] = [
  { id: "cat-cereal", name: "Bột ăn dặm", slug: "bot-an-dam", image: "/images/category-cereal.jpg" },
  { id: "cat-snack", name: "Bánh ăn dặm", slug: "banh-an-dam", image: "/images/category-snack.jpg" },
  { id: "cat-porridge", name: "Cháo hữu cơ", slug: "chao-huu-co", image: "/images/category-porridge.jpg" },
  { id: "cat-puree", name: "Trái cây nghiền", slug: "trai-cay-nghien", image: "/images/category-puree.jpg" },
];

export const products: Product[] = [
  {
    id: "prod-little-sprouts",
    slug: "little-sprouts-ca-rot-tao-huu-co",
    name: "Little Sprouts – Cà rốt & Táo nghiền hữu cơ",
    brand: "Little Sprouts",
    shortDescription: "Sự kết hợp nhẹ nhàng giữa cà rốt hữu cơ và táo hữu cơ.",
    description: "Sự kết hợp nhẹ nhàng giữa cà rốt hữu cơ và táo hữu cơ, có vị ngọt tự nhiên và kết cấu mịn phù hợp cho bé từ 6 tháng tuổi.",
    image: "/images/detail-main.jpg",
    category: "bot-an-dam",
    age: "6+ tháng",
    tags: ["Hữu cơ", "Không thêm đường"],
    featured: true,
    variants: [
      { id: "variant-little-120", name: "Hũ 120g", sku: "LS-120", priceVnd: 89000, compareAtPriceVnd: 110000, availability: "AVAILABLE" },
      { id: "variant-little-200", name: "Túi 200g", sku: "LS-200", priceVnd: 129000, availability: "AVAILABLE" },
    ],
  },
  {
    id: "prod-gerber",
    slug: "bot-an-dam-gerber-organic-yen-mach-chuoi",
    name: "Bột ăn dặm Gerber Organic Yến mạch & Chuối",
    brand: "Gerber",
    shortDescription: "Giàu vitamin và chất xơ, hỗ trợ tiêu hóa tốt.",
    description: "Bột ăn dặm hữu cơ mịn, phù hợp cho bé từ 6 tháng.",
    image: "/images/product-gerber.jpg",
    category: "bot-an-dam",
    age: "6+ tháng",
    tags: ["Hữu cơ"],
    featured: true,
    variants: [{ id: "variant-gerber-227", name: "227g", sku: "GER-227", priceVnd: 125000, availability: "AVAILABLE" }],
  },
  {
    id: "prod-rice-apple",
    slug: "banh-gao-an-dam-vi-tao",
    name: "Bánh gạo ăn dặm vị Táo",
    brand: "Nature's First Bites",
    shortDescription: "Tan nhanh trong miệng, giúp bé tập nhai.",
    description: "Bánh gạo hữu cơ vị táo dành cho bé từ 8 tháng.",
    image: "/images/cart-rice-crackers.jpg",
    category: "banh-an-dam",
    age: "8+ tháng",
    tags: ["Không thêm đường"],
    featured: true,
    variants: [{ id: "variant-rice-50", name: "50g", sku: "RICE-50", priceVnd: 68000, availability: "AVAILABLE" }],
  },
  {
    id: "prod-vegetable-puree",
    slug: "rau-cu-qua-nghien-huu-co",
    name: "Rau củ quả nghiền hữu cơ",
    brand: "Sprout",
    shortDescription: "Rau củ hữu cơ xay nhuyễn, dễ tiêu hóa.",
    description: "Rau củ quả hữu cơ phối trộn cân bằng cho bữa ăn nhẹ của bé.",
    image: "/images/cart-puree.jpg",
    category: "trai-cay-nghien",
    age: "6+ tháng",
    tags: ["Hữu cơ", "Không biến đổi gen"],
    variants: [{ id: "variant-puree-120", name: "120g", sku: "PUREE-120", priceVnd: 49000, availability: "AVAILABLE" }],
  },
  {
    id: "prod-hipp",
    slug: "hipp-ca-rot-khoai-tay-nghien",
    name: "Dinh dưỡng đóng lọ HiPP Cà rốt & Khoai tây nghiền",
    brand: "HiPP",
    shortDescription: "Cà rốt và khoai tây hữu cơ nghiền mịn.",
    description: "Thực phẩm bổ sung phù hợp cho giai đoạn làm quen hương vị.",
    image: "/images/product-hipp.jpg",
    category: "trai-cay-nghien",
    age: "4+ tháng",
    tags: ["Hữu cơ"],
    variants: [{ id: "variant-hipp-125", name: "125g", sku: "HIPP-125", priceVnd: 55000, availability: "AVAILABLE" }],
  },
  {
    id: "prod-heinz",
    slug: "heinz-gao-rau-cu",
    name: "Bột ăn dặm Heinz Gạo xay nhuyễn & Rau củ",
    brand: "Heinz",
    shortDescription: "Gạo và rau củ xay nhuyễn.",
    description: "Sản phẩm hiện tạm hết hàng.",
    image: "/images/product-heinz.jpg",
    category: "bot-an-dam",
    age: "4+ tháng",
    tags: [],
    variants: [{ id: "variant-heinz-120", name: "120g", sku: "HEINZ-120", priceVnd: 89000, availability: "OUT_OF_STOCK" }],
  },
  {
    id: "prod-wakodo-rice",
    slug: "banh-gao-lut-wakodo",
    name: "Bánh gạo lứt Gerber vị rau bina & dâu tây",
    brand: "Wakodo",
    shortDescription: "Bánh gạo lứt nhỏ gọn, tan nhanh.",
    description: "Bánh gạo dành cho bé từ 6 tháng.",
    image: "/images/product-wakodo.jpg",
    category: "banh-an-dam",
    age: "6+ tháng",
    tags: ["Không chứa sữa"],
    variants: [{ id: "variant-wakodo-42", name: "42g", sku: "WAK-42", priceVnd: 75000, availability: "AVAILABLE" }],
  },
  {
    id: "prod-baby-oil",
    slug: "dau-olive-extra-virgin-cho-be",
    name: "Dầu Olive Extra Virgin cho bé",
    brand: "Bio Organic",
    shortDescription: "Dầu olive nguyên chất dùng cho bữa ăn dặm.",
    description: "Bổ sung chất béo tốt cho thực đơn của bé.",
    image: "/images/product-oil.jpg",
    category: "gia-vi-cho-be",
    age: "6+ tháng",
    tags: ["Không thêm đường"],
    variants: [{ id: "variant-oil-250", name: "250ml", sku: "OIL-250", priceVnd: 120000, availability: "AVAILABLE" }],
  },
];

export const canonicalVariantIds = ["variant-gerber-227", "variant-rice-50", "variant-puree-120"];

export function formatVnd(value: number): string {
  return `${new Intl.NumberFormat("vi-VN").format(value)} ₫`;
}

export function findVariant(variantId: string) {
  return findVariantInProducts(products, variantId);
}

export function findVariantInProducts(source: Product[], variantId: string) {
  for (const product of source) {
    const variant = product.variants.find((item) => item.id === variantId);
    if (variant) return { product, variant };
  }
  return undefined;
}

/** Chọn phân loại mặc định có thể mua; chỉ dùng phần tử đầu tiên làm phương án cuối. */
export function getDefaultVariant(product: Product) {
  return (
    product.variants.find((variant) => variant.availability === "AVAILABLE") ??
    product.variants.find((variant) => variant.availability !== "HIDDEN") ??
    product.variants.at(0)
  );
}

/** Giá đại diện luôn lấy mức thấp nhất đang hiển thị, không khóa vào phần tử đầu tiên. */
export function getDisplayVariant(product: Product) {
  return product.variants
    .filter((variant) => variant.availability !== "HIDDEN")
    .sort((left, right) => left.priceVnd - right.priceVnd)[0] ?? getDefaultVariant(product);
}
