import { useEffect, useState, type ImgHTMLAttributes } from "react";
import {
  PRODUCT_IMAGE_PLACEHOLDER,
  getPublicImageUrl,
} from "../../shared/images";
import type { Product, ProductImageRecord } from "../lib/catalog";

type ProductImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  r2Key?: string | null;
  url?: string | null;
  legacySrc?: string | null;
  product?: Product;
  image?: ProductImageRecord;
};

function initialSource({
  r2Key,
  url,
  legacySrc,
}: Pick<ProductImageProps, "r2Key" | "url" | "legacySrc">) {
  if (r2Key) return url || getPublicImageUrl(r2Key);
  return url || legacySrc || PRODUCT_IMAGE_PLACEHOLDER;
}

export function ProductImage({
  r2Key,
  url,
  legacySrc,
  product,
  image,
  className = "",
  alt,
  ...props
}: ProductImageProps) {
  r2Key = image?.r2Key ?? r2Key ?? product?.imageKey;
  url = image?.url ?? url ?? product?.images?.[0]?.url;
  legacySrc = legacySrc ?? product?.image;
  alt = alt ?? image?.altText ?? product?.name ?? "";
  const resolved = initialSource({ r2Key, url, legacySrc });
  const [source, setSource] = useState(resolved);
  useEffect(() => setSource(resolved), [resolved]);
  const placeholder = source === PRODUCT_IMAGE_PLACEHOLDER;
  return (
    <img
      {...props}
      className={`${className}${placeholder ? " product-image-placeholder" : ""}`.trim()}
      src={source}
      alt={alt}
      onError={(event) => {
        // Gỡ handler trước khi đổi sang placeholder để không tạo vòng lặp onError vô hạn.
        event.currentTarget.onerror = null;
        setSource(PRODUCT_IMAGE_PLACEHOLDER);
      }}
    />
  );
}
