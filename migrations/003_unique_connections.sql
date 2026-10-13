-- 003_unique_connections.sql — Chống race condition chèn connection trùng lặp (B3)
-- Chạy TRƯỚC khi deploy code mới (code bắt lỗi 23505 khi unique index đã có).
-- Idempotent: đã chạy lại được.

-- 1. Xoá bản ghi trùng lặp (giữ bản cũ nhất) nếu database đã có
DELETE FROM public.connections a
USING public.connections b
WHERE a.id > b.id
  AND a.requester_id = b.requester_id
  AND a.receiver_id = b.receiver_id;

-- 2. Unique index — 2 request song song không thể cùng chèn 1 cặp
CREATE UNIQUE INDEX IF NOT EXISTS uq_connections_pair
  ON public.connections (requester_id, receiver_id);
