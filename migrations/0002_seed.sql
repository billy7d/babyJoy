INSERT INTO categories (id, name, slug, description, image_key, sort_order) VALUES
  ('cat-cereal', 'Bột ăn dặm', 'bot-an-dam', 'Bột và ngũ cốc ăn dặm', 'images/category-cereal.jpg', 1),
  ('cat-snack', 'Bánh ăn dặm', 'banh-an-dam', 'Bánh mềm và bánh gạo', 'images/category-snack.jpg', 2),
  ('cat-porridge', 'Cháo hữu cơ', 'chao-huu-co', 'Cháo hữu cơ cho bé', 'images/category-porridge.jpg', 3),
  ('cat-puree', 'Trái cây nghiền', 'trai-cay-nghien', 'Rau củ và trái cây nghiền', 'images/category-puree.jpg', 4);

INSERT INTO products (id, name, slug, brand, short_description, description, status, featured, sort_order) VALUES
  ('prod-little-sprouts', 'Little Sprouts – Cà rốt & Táo nghiền hữu cơ', 'little-sprouts-ca-rot-tao-huu-co', 'Little Sprouts', 'Sự kết hợp nhẹ nhàng giữa cà rốt hữu cơ và táo hữu cơ.', 'Có vị ngọt tự nhiên và kết cấu mịn phù hợp cho bé từ 6 tháng tuổi.', 'AVAILABLE', 1, 1),
  ('prod-gerber', 'Bột ăn dặm Gerber Organic Yến mạch & Chuối', 'bot-an-dam-gerber-organic-yen-mach-chuoi', 'Gerber', 'Giàu vitamin và chất xơ, hỗ trợ tiêu hóa tốt.', 'Bột ăn dặm hữu cơ mịn.', 'AVAILABLE', 1, 2),
  ('prod-rice-apple', 'Bánh gạo ăn dặm vị Táo', 'banh-gao-an-dam-vi-tao', 'Nature''s First Bites', 'Tan nhanh trong miệng, giúp bé tập nhai.', 'Bánh gạo hữu cơ vị táo.', 'AVAILABLE', 1, 3),
  ('prod-vegetable-puree', 'Rau củ quả nghiền hữu cơ', 'rau-cu-qua-nghien-huu-co', 'Sprout', 'Rau củ hữu cơ xay nhuyễn, dễ tiêu hóa.', 'Rau củ quả hữu cơ phối trộn cân bằng.', 'AVAILABLE', 0, 4),
  ('prod-hipp', 'Dinh dưỡng đóng lọ HiPP Cà rốt & Khoai tây nghiền', 'hipp-ca-rot-khoai-tay-nghien', 'HiPP', 'Cà rốt và khoai tây hữu cơ nghiền mịn.', 'Phù hợp cho giai đoạn làm quen hương vị.', 'AVAILABLE', 0, 5),
  ('prod-heinz', 'Bột ăn dặm Heinz Gạo xay nhuyễn & Rau củ', 'heinz-gao-rau-cu', 'Heinz', 'Gạo và rau củ xay nhuyễn.', 'Sản phẩm hiện tạm hết hàng.', 'OUT_OF_STOCK', 0, 6),
  ('prod-wakodo-rice', 'Bánh gạo lứt Gerber vị rau bina & dâu tây', 'banh-gao-lut-wakodo', 'Wakodo', 'Bánh gạo lứt nhỏ gọn, tan nhanh.', 'Bánh gạo dành cho bé từ 6 tháng.', 'AVAILABLE', 0, 7),
  ('prod-baby-oil', 'Dầu Olive Extra Virgin cho bé', 'dau-olive-extra-virgin-cho-be', 'Bio Organic', 'Dầu olive nguyên chất dùng cho bữa ăn dặm.', 'Bổ sung chất béo tốt.', 'AVAILABLE', 0, 8);

INSERT INTO product_variants (id, product_id, name, sku, price_vnd, compare_at_price_vnd, availability, sort_order) VALUES
  ('variant-little-120', 'prod-little-sprouts', 'Hũ 120g', 'LS-120', 89000, 110000, 'AVAILABLE', 1),
  ('variant-little-200', 'prod-little-sprouts', 'Túi 200g', 'LS-200', 129000, NULL, 'AVAILABLE', 2),
  ('variant-gerber-227', 'prod-gerber', '227g', 'GER-227', 125000, NULL, 'AVAILABLE', 1),
  ('variant-rice-50', 'prod-rice-apple', '50g', 'RICE-50', 68000, NULL, 'AVAILABLE', 1),
  ('variant-puree-120', 'prod-vegetable-puree', '120g', 'PUREE-120', 49000, NULL, 'AVAILABLE', 1),
  ('variant-hipp-125', 'prod-hipp', '125g', 'HIPP-125', 55000, NULL, 'AVAILABLE', 1),
  ('variant-heinz-120', 'prod-heinz', '120g', 'HEINZ-120', 89000, NULL, 'OUT_OF_STOCK', 1),
  ('variant-wakodo-42', 'prod-wakodo-rice', '42g', 'WAK-42', 75000, NULL, 'AVAILABLE', 1),
  ('variant-oil-250', 'prod-baby-oil', '250ml', 'OIL-250', 120000, NULL, 'AVAILABLE', 1);

INSERT INTO product_categories (product_id, category_id) VALUES
  ('prod-little-sprouts', 'cat-puree'), ('prod-gerber', 'cat-cereal'), ('prod-rice-apple', 'cat-snack'),
  ('prod-vegetable-puree', 'cat-puree'), ('prod-hipp', 'cat-puree'), ('prod-heinz', 'cat-cereal'), ('prod-wakodo-rice', 'cat-snack');

INSERT INTO tags (id, name, slug, group_type, sort_order) VALUES
  ('tag-organic', 'Hữu cơ', 'huu-co', 'ATTRIBUTE', 1),
  ('tag-no-sugar', 'Không thêm đường', 'khong-them-duong', 'ATTRIBUTE', 2),
  ('tag-dairy-free', 'Không chứa sữa', 'khong-chua-sua', 'ATTRIBUTE', 3),
  ('tag-age-6', '6–8 tháng', '6-8-thang', 'AGE', 4);

INSERT INTO cart_requests (id, public_code, submission_token, customer_name, customer_phone, customer_contact, customer_note, item_line_count, total_quantity, subtotal_vnd, status, telegram_status, telegram_last_error, created_at, updated_at) VALUES
  ('request-canonical', 'GH-260825-X7K2', 'seed-canonical-request-token', 'Nguyễn Văn A', '0901 234 567', NULL, 'Bé nhà mình bị dị ứng đạm sữa bò, shop tư vấn thêm giúp mình các sản phẩm ăn dặm phù hợp nhé. Gọi cho mình sau 5h chiều.', 3, 4, 367000, 'SUBMITTED', 'FAILED', '400 Bad Request', '2026-08-25T15:12:00+07:00', '2026-08-25T15:13:00+07:00');

INSERT INTO cart_request_items (id, cart_request_id, product_id, variant_id, product_name_snapshot, variant_name_snapshot, sku_snapshot, image_key_snapshot, unit_price_vnd, quantity, line_total_vnd) VALUES
  ('request-item-1', 'request-canonical', 'prod-gerber', 'variant-gerber-227', 'Bột ăn dặm Gerber Organic Yến mạch & Chuối', '227g', 'GER-227', 'images/product-gerber.jpg', 125000, 2, 250000),
  ('request-item-2', 'request-canonical', 'prod-rice-apple', 'variant-rice-50', 'Bánh gạo ăn dặm vị Táo', '50g', 'RICE-50', 'images/cart-rice-crackers.jpg', 68000, 1, 68000),
  ('request-item-3', 'request-canonical', 'prod-vegetable-puree', 'variant-puree-120', 'Rau củ quả nghiền hữu cơ', '120g', 'PUREE-120', 'images/cart-puree.jpg', 49000, 1, 49000);
