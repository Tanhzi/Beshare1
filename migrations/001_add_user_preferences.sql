-- Thêm cột preferences riêng cho từng user
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS auto_download BOOLEAN DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS auto_view BOOLEAN DEFAULT false;

-- Xoá cột cũ trong connections (không còn dùng)
ALTER TABLE public.connections DROP COLUMN IF EXISTS setting_auto_download;
ALTER TABLE public.connections DROP COLUMN IF EXISTS setting_auto_view;
