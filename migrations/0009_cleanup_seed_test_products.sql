-- Xóa đúng 8 product seed đã được xác nhận là dữ liệu test bằng immutable ID.
-- Không xóa brands, categories, tags hoặc lịch sử cart/checkout.
-- Chỉ xóa metadata product_images; không xóa physical object R2.

-- Cart item là snapshot lịch sử; tháo reference hiện tại nhưng giữ snapshot.
UPDATE cart_request_items
SET product_id = NULL,
    variant_id = NULL
WHERE product_id IN (
  'prod-baby-oil',
  'prod-gerber',
  'prod-heinz',
  'prod-hipp',
  'prod-little-sprouts',
  'prod-rice-apple',
  'prod-vegetable-puree',
  'prod-wakodo-rice'
)
OR variant_id IN (
  SELECT id
  FROM product_variants
  WHERE product_id IN (
    'prod-baby-oil',
    'prod-gerber',
    'prod-heinz',
    'prod-hipp',
    'prod-little-sprouts',
    'prod-rice-apple',
    'prod-vegetable-puree',
    'prod-wakodo-rice'
  )
);

-- Xóa product-owned data theo đúng tám ID đã xác nhận.
DELETE FROM product_images
WHERE product_id IN (
  'prod-baby-oil',
  'prod-gerber',
  'prod-heinz',
  'prod-hipp',
  'prod-little-sprouts',
  'prod-rice-apple',
  'prod-vegetable-puree',
  'prod-wakodo-rice'
);

DELETE FROM product_tags
WHERE product_id IN (
  'prod-baby-oil',
  'prod-gerber',
  'prod-heinz',
  'prod-hipp',
  'prod-little-sprouts',
  'prod-rice-apple',
  'prod-vegetable-puree',
  'prod-wakodo-rice'
);

DELETE FROM product_categories
WHERE product_id IN (
  'prod-baby-oil',
  'prod-gerber',
  'prod-heinz',
  'prod-hipp',
  'prod-little-sprouts',
  'prod-rice-apple',
  'prod-vegetable-puree',
  'prod-wakodo-rice'
);

DELETE FROM product_variants
WHERE product_id IN (
  'prod-baby-oil',
  'prod-gerber',
  'prod-heinz',
  'prod-hipp',
  'prod-little-sprouts',
  'prod-rice-apple',
  'prod-vegetable-puree',
  'prod-wakodo-rice'
);

DELETE FROM products
WHERE id IN (
  'prod-baby-oil',
  'prod-gerber',
  'prod-heinz',
  'prod-hipp',
  'prod-little-sprouts',
  'prod-rice-apple',
  'prod-vegetable-puree',
  'prod-wakodo-rice'
);
