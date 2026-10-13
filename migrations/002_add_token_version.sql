-- 002: Thêm cột token_version để thu hồi JWT khi đổi/đặt lại mật khẩu
-- Chạy trên Supabase SQL Editor trước khi deploy code mới.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS token_version INT NOT NULL DEFAULT 1;

-- Backfill bản ghi cũ (nếu cột đã tồn tại từ trước, nullable)
UPDATE public.users SET token_version = 1 WHERE token_version IS NULL;
