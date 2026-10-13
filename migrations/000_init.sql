-- 000_init.sql — Schema đầy đủ cho ShareDocu/BeShare (idempotent)
-- Chạy được trên cả database mới lẫn database đã có (ALTER ... IF NOT EXISTS).
-- Thứ tự chạy: 000_init.sql -> 001_add_user_preferences.sql -> 002_add_token_version.sql -> 003_unique_connections.sql

-- ============================================================
-- 1. EXTENSION
-- ============================================================
CREATE EXTENSION IF NOT EXISTS postgis;

-- ============================================================
-- 2. BẢNG users
-- ============================================================
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  avatar_url TEXT,
  reset_code TEXT,
  reset_code_hash TEXT,
  reset_code_expires TIMESTAMPTZ,
  token_version INT NOT NULL DEFAULT 1,
  auto_download BOOLEAN DEFAULT false,
  auto_view BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cột có thể thiếu trên database cũ
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS reset_code TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS reset_code_hash TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS reset_code_expires TIMESTAMPTZ;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS token_version INT NOT NULL DEFAULT 1;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS auto_download BOOLEAN DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS auto_view BOOLEAN DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email ON public.users (email);

-- ============================================================
-- 3. BẢNG documents
-- ============================================================
CREATE TABLE IF NOT EXISTS public.documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID REFERENCES public.users (id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  file_url TEXT NOT NULL DEFAULT '',
  file_type TEXT NOT NULL,
  file_size BIGINT NOT NULL DEFAULT 0,
  is_protected BOOLEAN NOT NULL DEFAULT false,
  password_hash TEXT,
  is_anonymous BOOLEAN NOT NULL DEFAULT false,
  expires_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active',
  location GEOGRAPHY (POINT, 4326),
  text_content TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_documents_status CHECK (status IN ('active', 'expired'))
);

ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS text_content TEXT;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS location GEOGRAPHY (POINT, 4326);

CREATE INDEX IF NOT EXISTS idx_documents_location ON public.documents USING GIST (location);
CREATE INDEX IF NOT EXISTS idx_documents_owner ON public.documents (owner_id);
CREATE INDEX IF NOT EXISTS idx_documents_expires ON public.documents (expires_at);

-- ============================================================
-- 4. BẢNG connections
-- ============================================================
CREATE TABLE IF NOT EXISTS public.connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  receiver_id UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_connections_status CHECK (status IN ('pending', 'connected'))
);

ALTER TABLE public.connections ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE public.connections ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';

CREATE INDEX IF NOT EXISTS idx_connections_requester ON public.connections (requester_id, status);
CREATE INDEX IF NOT EXISTS idx_connections_receiver ON public.connections (receiver_id, status);

-- ============================================================
-- 5. BẢNG transfer_history
-- ============================================================
CREATE TABLE IF NOT EXISTS public.transfer_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES public.documents (id) ON DELETE CASCADE,
  sender_id UUID REFERENCES public.users (id) ON DELETE SET NULL,
  receiver_id UUID REFERENCES public.users (id) ON DELETE SET NULL,
  action_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_transfer_action_type
    CHECK (action_type IN ('share', 'download', 'private_share'))
);

-- Database cũ: cho phép sender null (doc public không rõ chủ sở hữu)
ALTER TABLE public.transfer_history ALTER COLUMN sender_id DROP NOT NULL;
ALTER TABLE public.transfer_history ALTER COLUMN receiver_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transfer_document ON public.transfer_history (document_id);
CREATE INDEX IF NOT EXISTS idx_transfer_receiver ON public.transfer_history (receiver_id, created_at);
CREATE INDEX IF NOT EXISTS idx_transfer_sender ON public.transfer_history (sender_id, receiver_id);

-- ============================================================
-- 6. RPC quét tài liệu gần (B5 - schema chốt cho FE)
--   Trả về: ...cột documents + distance (mét) + owner_name (null nếu ẩn danh)
--   Lọc sẵn: status = active, chưa hết hạn, trong bán kính
--   Bắt buộc DROP bản cũ: Postgres không cho CREATE OR REPLACE
--   đổi kiểu cột trả về (lỗi 42P13) nếu hàm đã tồn tại.
-- ============================================================
DROP FUNCTION IF EXISTS public.get_nearby_documents(double precision, double precision, double precision);
DROP FUNCTION IF EXISTS public.get_nearby_documents(double precision, double precision);

CREATE OR REPLACE FUNCTION public.get_nearby_documents (
  lat double precision,
  long double precision,
  radius_meters double precision DEFAULT 30
)
RETURNS TABLE (
  id uuid,
  owner_id uuid,
  name text,
  file_url text,
  file_type text,
  file_size bigint,
  is_protected boolean,
  is_anonymous boolean,
  expires_at timestamptz,
  status text,
  created_at timestamptz,
  distance double precision,
  owner_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    d.id,
    d.owner_id,
    d.name,
    d.file_url,
    d.file_type,
    d.file_size,
    d.is_protected,
    d.is_anonymous,
    d.expires_at,
    d.status,
    d.created_at,
    ST_Distance(
      d.location::geography,
      ST_SetSRID(ST_MakePoint(long, lat), 4326)::geography
    ) AS distance,
    CASE WHEN d.is_anonymous THEN NULL ELSE u.full_name END AS owner_name
  FROM public.documents d
  LEFT JOIN public.users u ON u.id = d.owner_id
  WHERE d.location IS NOT NULL
    AND d.status = 'active'
    AND (d.expires_at IS NULL OR d.expires_at > now())
    AND ST_DWithin(
      d.location::geography,
      ST_SetSRID(ST_MakePoint(long, lat), 4326)::geography,
      radius_meters
    )
  ORDER BY distance ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_nearby_documents (double precision, double precision, double precision)
  TO service_role, anon, authenticated;

-- ============================================================
-- 7. STORAGE BUCKETS
--   - documents: private (chỉ server tải về, cấp signed URL)
--   - avatars:   public  (FE hiển thị trực tiếp qua public URL)
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;
