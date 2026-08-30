-- Xóa đúng 3 product test đã audit trên production bằng immutable ID.
-- Không xóa brands, categories, tags hoặc lịch sử cart/checkout.
-- Chỉ xóa metadata product_images; không xóa physical object R2.

-- Cart item là snapshot lịch sử; tháo reference hiện tại nhưng giữ snapshot.
UPDATE cart_request_items
SET product_id = NULL,
    variant_id = NULL
WHERE product_id IN (
  '00201127-c850-4130-bf2e-ddaaeaf7a9e0',
  'a2f5fd08-2f14-4034-829f-8d0bfc9b784a',
  'b25e2654-a980-4a14-b522-919faa6b574c'
)
OR variant_id IN (
  SELECT id
  FROM product_variants
  WHERE product_id IN (
    '00201127-c850-4130-bf2e-ddaaeaf7a9e0',
    'a2f5fd08-2f14-4034-829f-8d0bfc9b784a',
    'b25e2654-a980-4a14-b522-919faa6b574c'
  )
);

-- Xóa product-owned data theo đúng ba ID đã xác nhận.
DELETE FROM product_images
WHERE product_id IN (
  '00201127-c850-4130-bf2e-ddaaeaf7a9e0',
  'a2f5fd08-2f14-4034-829f-8d0bfc9b784a',
  'b25e2654-a980-4a14-b522-919faa6b574c'
);

DELETE FROM product_tags
WHERE product_id IN (
  '00201127-c850-4130-bf2e-ddaaeaf7a9e0',
  'a2f5fd08-2f14-4034-829f-8d0bfc9b784a',
  'b25e2654-a980-4a14-b522-919faa6b574c'
);

DELETE FROM product_categories
WHERE product_id IN (
  '00201127-c850-4130-bf2e-ddaaeaf7a9e0',
  'a2f5fd08-2f14-4034-829f-8d0bfc9b784a',
  'b25e2654-a980-4a14-b522-919faa6b574c'
);

DELETE FROM product_variants
WHERE product_id IN (
  '00201127-c850-4130-bf2e-ddaaeaf7a9e0',
  'a2f5fd08-2f14-4034-829f-8d0bfc9b784a',
  'b25e2654-a980-4a14-b522-919faa6b574c'
);

DELETE FROM products
WHERE id IN (
  '00201127-c850-4130-bf2e-ddaaeaf7a9e0',
  'a2f5fd08-2f14-4034-829f-8d0bfc9b784a',
  'b25e2654-a980-4a14-b522-919faa6b574c'
);
