-- BabyJoy Product Taxonomy v1: mở rộng additive, giữ nguyên category/brand legacy.
PRAGMA foreign_keys = ON;

CREATE TABLE brands (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE products ADD COLUMN brand_id TEXT REFERENCES brands(id);
ALTER TABLE products ADD COLUMN min_age_months INTEGER CHECK (min_age_months IS NULL OR min_age_months BETWEEN 0 AND 240);
ALTER TABLE products ADD COLUMN is_best_seller INTEGER NOT NULL DEFAULT 0 CHECK (is_best_seller IN (0, 1));
ALTER TABLE products ADD COLUMN best_seller_rank INTEGER CHECK (best_seller_rank IS NULL OR best_seller_rank >= 1);
ALTER TABLE products ADD COLUMN archived_at TEXT;
ALTER TABLE product_categories ADD COLUMN created_at TEXT;

-- Seed chuẩn của PRD; ON CONFLICT giúp seed có thể chạy lại mà không nhân đôi.
INSERT INTO categories (id, name, slug, description, image_key, sort_order, is_active)
VALUES
  ('cat-cereal', 'Bột ăn dặm', 'bot-an-dam', 'Bột và ngũ cốc ăn dặm', 'images/category-cereal.jpg', 1, 1),
  ('cat-snack', 'Bánh ăn dặm', 'banh-an-dam', 'Bánh mềm và bánh gạo', 'images/category-snack.jpg', 2, 1),
  ('cat-puree', 'Trái cây nghiền', 'trai-cay-nghien', 'Rau củ và trái cây nghiền', 'images/category-puree.jpg', 3, 1),
  ('cat-pudding-custard-nutrition-jar', 'Pudding, Custard, Hũ dinh dưỡng', 'pudding-custard-hu-dinh-duong', '', NULL, 4, 1),
  ('cat-food-pouch', 'Túi thức ăn', 'tui-thuc-an', '', NULL, 5, 1),
  ('cat-food-jar', 'Hũ thức ăn', 'hu-thuc-an', '', NULL, 6, 1)
ON CONFLICT(slug) DO UPDATE SET
  name = excluded.name,
  description = excluded.description,
  sort_order = excluded.sort_order,
  updated_at = CURRENT_TIMESTAMP;

UPDATE categories SET sort_order = 7, updated_at = CURRENT_TIMESTAMP
WHERE slug = 'chao-huu-co';

INSERT INTO brands (id, name, slug, sort_order) VALUES
  ('brand-heinz', 'Heinz', 'heinz', 1),
  ('brand-ellas-kitchen', 'Ella''s Kitchen', 'ellas-kitchen', 2),
  ('brand-organix', 'Organix', 'organix', 3),
  ('brand-kiddylicious', 'Kiddylicious', 'kiddylicious', 4),
  ('brand-cerelac', 'Cerelac', 'cerelac', 5),
  ('brand-hipp', 'HiPP', 'hipp', 6),
  ('brand-kendamil', 'Kendamil', 'kendamil', 7),
  ('brand-gerber', 'Gerber', 'gerber', 8),
  ('brand-little-sprouts', 'Little Sprouts', 'little-sprouts', 9),
  ('brand-natures-first-bites', 'Nature''s First Bites', 'natures-first-bites', 10),
  ('brand-sprout', 'Sprout', 'sprout', 11),
  ('brand-wakodo', 'Wakodo', 'wakodo', 12),
  ('brand-bio-organic', 'Bio Organic', 'bio-organic', 13)
ON CONFLICT(slug) DO UPDATE SET
  name = excluded.name,
  sort_order = excluded.sort_order,
  updated_at = CURRENT_TIMESTAMP;

-- Backfill theo brand legacy, không xóa hay sửa giá trị text cũ.
UPDATE products
SET brand_id = (
  SELECT brands.id FROM brands
  WHERE lower(brands.name) = lower(products.brand)
  LIMIT 1
)
WHERE brand_id IS NULL AND brand IS NOT NULL;

-- Dữ liệu seed hiện tại đã mô tả tuổi trong UI; backfill để cutover không làm đổi catalog.
UPDATE products SET min_age_months = CASE id
  WHEN 'prod-little-sprouts' THEN 6
  WHEN 'prod-gerber' THEN 6
  WHEN 'prod-rice-apple' THEN 8
  WHEN 'prod-vegetable-puree' THEN 6
  WHEN 'prod-hipp' THEN 4
  WHEN 'prod-heinz' THEN 4
  WHEN 'prod-wakodo-rice' THEN 6
  WHEN 'prod-baby-oil' THEN 6
  ELSE min_age_months
END
WHERE min_age_months IS NULL;

UPDATE product_categories
SET created_at = CURRENT_TIMESTAMP
WHERE created_at IS NULL;

CREATE INDEX idx_product_categories_category_id ON product_categories(category_id, product_id);
CREATE INDEX idx_products_brand_id ON products(brand_id);
CREATE INDEX idx_products_min_age_months ON products(min_age_months);
CREATE INDEX idx_products_best_seller ON products(is_best_seller, best_seller_rank);
