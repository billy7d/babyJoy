PRAGMA foreign_keys = ON;

-- Ba trang footer là system page: chỉ sửa nội dung, không cho xóa hoặc đổi slug.
CREATE TABLE content_pages (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  content_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PUBLISHED' CHECK (status IN ('PUBLISHED', 'DRAFT')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO content_pages (
  id, slug, title, content_json, status, created_at, updated_at
) VALUES
  (
    'content-page-shipping-policy',
    'shipping-policy',
    'Chính sách vận chuyển',
    '{"version":1,"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Nội dung chính sách đang được cập nhật."}]},{"type":"paragraph","content":[{"type":"text","text":"Vui lòng liên hệ cửa hàng để được hỗ trợ thêm."}]}]}',
    'PUBLISHED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'content-page-buying-guide',
    'buying-guide',
    'Hướng dẫn mua hàng',
    '{"version":1,"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Nội dung hướng dẫn đang được cập nhật."}]},{"type":"paragraph","content":[{"type":"text","text":"Vui lòng liên hệ cửa hàng để được hỗ trợ thêm."}]}]}',
    'PUBLISHED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'content-page-returns-refunds',
    'returns-refunds',
    'Đổi trả & Hoàn tiền',
    '{"version":1,"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Nội dung đổi trả và hoàn tiền đang được cập nhật."}]},{"type":"paragraph","content":[{"type":"text","text":"Vui lòng liên hệ cửa hàng để được hỗ trợ thêm."}]}]}',
    'PUBLISHED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  );

-- Asset rich-text dùng chung cho Product Description và Content Pages.
ALTER TABLE product_description_assets
  ADD COLUMN content_page_slug TEXT REFERENCES content_pages(slug) ON DELETE CASCADE;

CREATE INDEX idx_product_description_assets_content_page
  ON product_description_assets(content_page_slug, created_at, id);
