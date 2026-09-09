PRAGMA foreign_keys = ON;

CREATE TABLE tag_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  system_key TEXT UNIQUE,
  display_name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  is_filterable INTEGER NOT NULL DEFAULT 1 CHECK (is_filterable IN (0, 1)),
  assignment_mode TEXT NOT NULL DEFAULT 'MULTI' CHECK (assignment_mode IN ('SINGLE', 'MULTI')),
  selection_mode TEXT NOT NULL DEFAULT 'MULTI_OR' CHECK (selection_mode = 'MULTI_OR'),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE tags ADD COLUMN group_id TEXT REFERENCES tag_groups(id) ON DELETE RESTRICT;
ALTER TABLE tags ADD COLUMN system_key TEXT;
ALTER TABLE tags ADD COLUMN display_name TEXT;
ALTER TABLE tags ADD COLUMN show_badge INTEGER NOT NULL DEFAULT 0 CHECK (show_badge IN (0, 1));
ALTER TABLE tags ADD COLUMN featured_section_key TEXT;

CREATE TABLE variant_tags (
  variant_id TEXT NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (variant_id, tag_id)
);

INSERT INTO tag_groups (
  id, name, slug, system_key, display_name, is_active, is_filterable,
  assignment_mode, selection_mode, sort_order
)
VALUES
  ('tag-group-attributes', 'Đặc điểm', 'dac-diem', NULL, 'Đặc điểm', 1, 1, 'MULTI', 'MULTI_OR', 20),
  ('tag-group-age', 'Độ tuổi', 'do-tuoi', 'age', 'Độ tuổi', 1, 1, 'SINGLE', 'MULTI_OR', 10),
  ('tag-group-merchandising', 'Nhãn nổi bật', 'nhan-noi-bat', 'merchandising', 'Nhãn nổi bật', 1, 0, 'MULTI', 'MULTI_OR', 30);

UPDATE tags
SET group_id = 'tag-group-age',
    display_name = name
WHERE group_id IS NULL
  AND UPPER(COALESCE(group_type, '')) IN ('AGE', 'AGES');

UPDATE tags
SET group_id = 'tag-group-attributes',
    display_name = name
WHERE group_id IS NULL;

-- Giữ nguyên ID legacy khi slug tuổi đã tồn tại trên production.
UPDATE tags
SET group_id = 'tag-group-age',
    name = '6 tháng',
    display_name = '6 tháng',
    slug = '6-thang',
    sort_order = 1,
    system_key = 'age_6_months',
    is_active = 1,
    show_badge = 0,
    featured_section_key = NULL
WHERE id = 'tag-age-6'
  AND NOT EXISTS (
    SELECT 1
    FROM tags conflicting
    WHERE conflicting.slug = '6-thang'
      AND conflicting.id <> tags.id
  );

-- Production có thể đã seed tag tuổi bằng ID khác; nâng cấp theo slug để không tạo
-- bản ghi trùng UNIQUE(slug) và không làm mất các liên kết product_tags hiện hữu.
UPDATE tags
SET group_id = 'tag-group-age',
    name = '6 tháng',
    slug = '6-thang',
    system_key = 'age_6_months',
    display_name = '6 tháng',
    sort_order = 1,
    is_active = 1,
    show_badge = 0,
    featured_section_key = NULL
WHERE slug = '6-thang';

UPDATE tags
SET group_id = 'tag-group-age',
    name = '8 tháng',
    system_key = 'age_8_months',
    display_name = '8 tháng',
    sort_order = 2,
    is_active = 1,
    show_badge = 0,
    featured_section_key = NULL
WHERE slug = '8-thang';

INSERT INTO tags (
  id, group_id, name, slug, system_key, display_name, sort_order, is_active,
  show_badge, featured_section_key
)
SELECT 'tag-age-8', 'tag-group-age', '8 tháng', '8-thang', 'age_8_months', '8 tháng', 2, 1, 0, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM tags
  WHERE slug = '8-thang' OR system_key = 'age_8_months' OR id = 'tag-age-8'
);

UPDATE tags
SET group_id = 'tag-group-age',
    name = '10 tháng',
    system_key = 'age_10_months',
    display_name = '10 tháng',
    sort_order = 3,
    is_active = 1,
    show_badge = 0,
    featured_section_key = NULL
WHERE slug = '10-thang';

INSERT INTO tags (
  id, group_id, name, slug, system_key, display_name, sort_order, is_active,
  show_badge, featured_section_key
)
SELECT 'tag-age-10', 'tag-group-age', '10 tháng', '10-thang', 'age_10_months', '10 tháng', 3, 1, 0, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM tags
  WHERE slug = '10-thang' OR system_key = 'age_10_months' OR id = 'tag-age-10'
);

UPDATE tags
SET group_id = 'tag-group-age',
    name = '12 tháng',
    system_key = 'age_12_months',
    display_name = '12 tháng',
    sort_order = 4,
    is_active = 1,
    show_badge = 0,
    featured_section_key = NULL
WHERE slug = '12-thang';

INSERT INTO tags (
  id, group_id, name, slug, system_key, display_name, sort_order, is_active,
  show_badge, featured_section_key
)
SELECT 'tag-age-12', 'tag-group-age', '12 tháng', '12-thang', 'age_12_months', '12 tháng', 4, 1, 0, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM tags
  WHERE slug = '12-thang' OR system_key = 'age_12_months' OR id = 'tag-age-12'
);

-- Đồng bộ các slug tuổi legacy khác (ví dụ 7-thang) trước khi tạo tag mới.
UPDATE tags
SET group_id = 'tag-group-age',
    name = CAST(REPLACE(slug, '-thang', '') AS INTEGER) || ' tháng',
    system_key = 'age_' || CAST(REPLACE(slug, '-thang', '') AS INTEGER) || '_months',
    display_name = CAST(REPLACE(slug, '-thang', '') AS INTEGER) || ' tháng',
    sort_order = CAST(REPLACE(slug, '-thang', '') AS INTEGER),
    is_active = 1,
    show_badge = 0,
    featured_section_key = NULL
WHERE slug LIKE '%-thang'
  AND REPLACE(slug, '-thang', '') <> ''
  AND REPLACE(slug, '-thang', '') NOT GLOB '*[^0-9]*'
  AND CAST(REPLACE(slug, '-thang', '') AS INTEGER) BETWEEN 0 AND 240
  AND CAST(REPLACE(slug, '-thang', '') AS INTEGER) NOT IN (6, 8, 10, 12);

INSERT INTO tags (
  id, group_id, name, slug, system_key, display_name, sort_order, is_active,
  show_badge, featured_section_key
)
SELECT
  'tag-age-' || CAST(p.min_age_months AS TEXT),
  'tag-group-age',
  CAST(p.min_age_months AS TEXT) || ' tháng',
  CAST(p.min_age_months AS TEXT) || '-thang',
  'age_' || CAST(p.min_age_months AS TEXT) || '_months',
  CAST(p.min_age_months AS TEXT) || ' tháng',
  p.min_age_months,
  1,
  0,
  NULL
FROM products p
WHERE p.min_age_months IS NOT NULL
  AND p.min_age_months BETWEEN 0 AND 240
  AND p.min_age_months NOT IN (6, 8, 10, 12)
  AND NOT EXISTS (
    SELECT 1 FROM tags existing
    WHERE existing.slug = CAST(p.min_age_months AS TEXT) || '-thang'
       OR existing.system_key = 'age_' || CAST(p.min_age_months AS TEXT) || '_months'
       OR existing.id = 'tag-age-' || CAST(p.min_age_months AS TEXT)
  )
GROUP BY p.min_age_months;

UPDATE tags
SET group_id = 'tag-group-merchandising',
    name = 'Best Seller',
    system_key = 'best_seller',
    display_name = 'Best Seller',
    sort_order = 1,
    is_active = 1,
    show_badge = 1,
    featured_section_key = 'best_seller'
WHERE slug = 'best-seller';

INSERT INTO tags (
  id, group_id, name, slug, system_key, display_name, sort_order, is_active,
  show_badge, featured_section_key
)
SELECT 'tag-best-seller', 'tag-group-merchandising', 'Best Seller', 'best-seller', 'best_seller', 'Best Seller', 1, 1, 1, 'best_seller'
WHERE NOT EXISTS (
  SELECT 1 FROM tags
  WHERE slug = 'best-seller' OR system_key = 'best_seller' OR id = 'tag-best-seller'
);

UPDATE tags
SET group_id = 'tag-group-merchandising',
    name = 'Must Try',
    system_key = 'must_try',
    display_name = 'Must Try',
    sort_order = 2,
    is_active = 1,
    show_badge = 1,
    featured_section_key = 'must_try'
WHERE slug = 'must-try';

INSERT INTO tags (
  id, group_id, name, slug, system_key, display_name, sort_order, is_active,
  show_badge, featured_section_key
)
SELECT 'tag-must-try', 'tag-group-merchandising', 'Must Try', 'must-try', 'must_try', 'Must Try', 2, 1, 1, 'must_try'
WHERE NOT EXISTS (
  SELECT 1 FROM tags
  WHERE slug = 'must-try' OR system_key = 'must_try' OR id = 'tag-must-try'
);

CREATE INDEX idx_tags_group_active_sort ON tags(group_id, is_active, sort_order, name);
CREATE INDEX idx_tags_system_key ON tags(system_key);
CREATE UNIQUE INDEX idx_tags_system_key_unique ON tags(system_key) WHERE system_key IS NOT NULL;
CREATE INDEX idx_variant_tags_tag_variant ON variant_tags(tag_id, variant_id);

INSERT OR IGNORE INTO variant_tags (variant_id, tag_id)
SELECT pv.id, pt.tag_id
FROM product_tags pt
JOIN products p ON p.id = pt.product_id
JOIN product_variants pv ON pv.product_id = pt.product_id
JOIN tags t ON t.id = pt.tag_id
WHERE t.group_id IS NOT NULL
  AND t.group_id != 'tag-group-age';

INSERT OR IGNORE INTO variant_tags (variant_id, tag_id)
SELECT pv.id, t.id
FROM products p
JOIN product_variants pv ON pv.product_id = p.id
JOIN tags t
  ON t.group_id = 'tag-group-age'
 AND t.system_key = 'age_' || CAST(p.min_age_months AS TEXT) || '_months'
WHERE p.min_age_months IS NOT NULL
  AND p.min_age_months BETWEEN 0 AND 240;

INSERT OR IGNORE INTO variant_tags (variant_id, tag_id)
SELECT pv.id,
  (
    SELECT pt.tag_id
    FROM product_tags pt
    JOIN tags legacy_age ON legacy_age.id = pt.tag_id
    WHERE pt.product_id = p.id
      AND legacy_age.group_id = 'tag-group-age'
    ORDER BY legacy_age.sort_order, legacy_age.id
    LIMIT 1
  )
FROM products p
JOIN product_variants pv ON pv.product_id = p.id
WHERE p.min_age_months IS NULL
  AND EXISTS (
    SELECT 1
    FROM product_tags pt
    JOIN tags legacy_age ON legacy_age.id = pt.tag_id
    WHERE pt.product_id = p.id
      AND legacy_age.group_id = 'tag-group-age'
  );

INSERT OR IGNORE INTO variant_tags (variant_id, tag_id)
SELECT pv.id, t.id
FROM products p
JOIN product_variants pv ON pv.product_id = p.id
JOIN tags t
  ON t.group_id = 'tag-group-merchandising'
 AND t.system_key = 'best_seller'
WHERE p.is_best_seller = 1;

CREATE TRIGGER tag_groups_require_stable_system_key
BEFORE UPDATE OF system_key ON tag_groups
WHEN OLD.system_key IS NOT NULL
  AND OLD.system_key IS NOT NEW.system_key
BEGIN
  SELECT RAISE(ABORT, 'SYSTEM_TAG_GROUP_KEY_IMMUTABLE');
END;

CREATE TRIGGER tags_require_stable_system_contract
BEFORE UPDATE OF system_key, featured_section_key ON tags
WHEN (
    OLD.system_key IS NOT NULL
    AND OLD.system_key IS NOT NEW.system_key
  )
  OR (
    OLD.featured_section_key IS NOT NULL
    AND OLD.featured_section_key IS NOT NEW.featured_section_key
  )
BEGIN
  SELECT RAISE(ABORT, 'SYSTEM_TAG_KEY_IMMUTABLE');
END;

CREATE TRIGGER tags_require_group_for_new_rows
BEFORE INSERT ON tags
WHEN NEW.group_id IS NULL
BEGIN
  SELECT RAISE(ABORT, 'TAG_GROUP_REQUIRED');
END;

CREATE TRIGGER tags_require_group_for_updates
BEFORE UPDATE OF group_id ON tags
WHEN NEW.group_id IS NULL
BEGIN
  SELECT RAISE(ABORT, 'TAG_GROUP_REQUIRED');
END;

CREATE TRIGGER tags_system_group_immutable
BEFORE UPDATE OF group_id ON tags
WHEN OLD.system_key IS NOT NULL
  AND OLD.group_id IS NOT NEW.group_id
BEGIN
  SELECT RAISE(ABORT, 'SYSTEM_TAG_GROUP_IMMUTABLE');
END;

CREATE TRIGGER tag_groups_guard_single_assignment
BEFORE UPDATE OF assignment_mode ON tag_groups
WHEN NEW.assignment_mode = 'SINGLE'
  AND EXISTS (
    SELECT 1
    FROM variant_tags vt
    JOIN tags t ON t.id = vt.tag_id
    WHERE t.group_id = NEW.id
    GROUP BY vt.variant_id
    HAVING COUNT(*) > 1
  )
BEGIN
  SELECT RAISE(ABORT, 'SINGLE_TAG_GROUP_CONFLICT');
END;

CREATE TRIGGER variant_tags_guard_single_assignment
BEFORE INSERT ON variant_tags
WHEN EXISTS (
  SELECT 1
  FROM tags new_tag
  JOIN tag_groups new_group ON new_group.id = new_tag.group_id
  WHERE new_tag.id = NEW.tag_id
    AND new_group.assignment_mode = 'SINGLE'
    AND EXISTS (
      SELECT 1
      FROM variant_tags existing_assignment
      JOIN tags existing_tag ON existing_tag.id = existing_assignment.tag_id
      WHERE existing_assignment.variant_id = NEW.variant_id
        AND existing_tag.group_id = new_tag.group_id
        AND existing_assignment.tag_id != NEW.tag_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'SINGLE_TAG_GROUP_CONFLICT');
END;

CREATE TRIGGER variant_tags_guard_single_assignment_update
BEFORE UPDATE OF variant_id, tag_id ON variant_tags
WHEN EXISTS (
  SELECT 1
  FROM tags new_tag
  JOIN tag_groups new_group ON new_group.id = new_tag.group_id
  WHERE new_tag.id = NEW.tag_id
    AND new_group.assignment_mode = 'SINGLE'
    AND EXISTS (
      SELECT 1
      FROM variant_tags existing_assignment
      JOIN tags existing_tag ON existing_tag.id = existing_assignment.tag_id
      WHERE existing_assignment.variant_id = NEW.variant_id
        AND existing_tag.group_id = new_tag.group_id
        AND NOT (
          existing_assignment.variant_id = OLD.variant_id
          AND existing_assignment.tag_id = OLD.tag_id
        )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'SINGLE_TAG_GROUP_CONFLICT');
END;
