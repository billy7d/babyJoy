-- Xóa đúng bản ghi seed demo, giữ nguyên catalog và mọi snapshot lịch sử khác.
DELETE FROM cart_request_items
WHERE cart_request_id = 'request-canonical'
  AND EXISTS (
    SELECT 1
    FROM cart_requests
    WHERE cart_requests.id = cart_request_items.cart_request_id
      AND cart_requests.submission_token = 'seed-canonical-request-token'
  );

DELETE FROM cart_requests
WHERE id = 'request-canonical'
  AND submission_token = 'seed-canonical-request-token';
