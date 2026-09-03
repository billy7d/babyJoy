-- Variant đã có lịch sử inventory được retire mềm để giữ nguyên audit.
ALTER TABLE product_variants ADD COLUMN archived_at TEXT;

CREATE INDEX idx_product_variants_product_archived_sort
  ON product_variants(product_id, archived_at, sort_order, created_at, id);
