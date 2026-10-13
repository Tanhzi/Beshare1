# BeShare — Backend API

> REST API cho nền tảng chia sẻ tài liệu theo vị trí địa lý (ShareDocu)

![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript&logoColor=white)
![Express](https://img.shields.io/badge/Express-5.x-000000?logo=express&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-PostGIS-336791?logo=postgresql&logoColor=white)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](LICENSE)

**Frontend:** [Tanhzi/Share](https://github.com/Tanhzi/Share) — React Native (Android, iOS, Web)

## Mục lục

1. [Tổng quan](#1-tổng-quan)
2. [Tính năng](#2-tính-năng)
3. [Bảo mật](#3-bảo-mật)
4. [Công nghệ](#4-công-nghệ)
5. [Kiến trúc](#5-kiến-thúc)
6. [Cài đặt & chạy](#6-cài-đặt--chạy)
7. [Cấu trúc thư mục](#7-cấu-trúc-thư-mục)
8. [API Endpoints](#8-api-endpoints)
9. [Cấu trúc database](#9-cấu-trúc-database)
10. [Ghi chú kỹ thuật](#10-ghi-chú-kỹ-thuật)
11. [License](#11-license)

## 1. Tổng quan

**BeShare** là backend API của nền tảng chia sẻ tài liệu dựa trên vị trí địa lý. Người dùng chia sẻ file, hình ảnh, video, văn bản và liên kết với những người khác **trong cùng khu vực địa lý** (bán kính mặc định 30m).

Dự án dùng **kiến trúc REST API thuần** (pull mechanism) — client chủ động gọi API để lấy dữ liệu, không dùng real-time push.

## 2. Tính năng

- **Chia sẻ theo vị trí**: tìm người dùng trong bán kính gần (PostGIS + RPC `get_nearby_documents`)
- **Đa dạng loại nội dung**: Photos, Videos, Files, Links, Text
- **Bảo vệ bằng mật khẩu**: tài liệu nhạy cảm đặt mật khẩu (bcrypt)
- **Thời gian hết hạn**: 1 giờ, 6 giờ, 1 ngày, 3 ngày, 7 ngày hoặc không hết hạn
- **Chia sẻ ẩn danh**: không lộ danh tính người chia sẻ
- **Chia sẻ công khai**: không cần đăng nhập (các endpoint `*-public`)
- **Kết nối tài khoản (Sync)**: liên kết 2 tài khoản để chia sẻ riêng tư (`private_share`)
- **Cài đặt cá nhân**: auto-download / auto-view riêng cho từng người dùng
- **Lịch sử giao dịch**: ghi log `share`, `download`, `private_share`
- **Xác thực JWT**: bảo mật API bằng token tự ký

## 3. Bảo mật

| Biện pháp | Mô tả |
|---|---|
| **JWT + token_version** | Đổi/đặt lại mật khẩu → tăng `token_version` → mọi token cũ trả 401 `Token revoked` |
| **bcrypt** | Mật khẩu người dùng, mật khẩu bảo vệ tài liệu và mã OTP đều được hash |
| **Rate limiting** | Login 10 lần/15 phút/IP; OTP 5 lần/15 phút/IP; share-public 10 lần/phút/IP (trả `code: RATE_LIMITED`) |
| **Validate input (zod)** | Validate tập trung — trả 400 + `code: VALIDATION_ERROR` |
| **Upload allowlist** | Chặn file nguy hiểm (`.exe`, `.svg`, `.html`...); avatar bắt buộc `image/*`; header `nosniff` |
| **Kiểm tra khi tải** | Check `is_protected` (401) và `expires_at` (410) trước khi cấp signed URL |
| **Signed URL** | Link tải hết hạn sau 300 giây — không lộ đường dẫn Storage lâu dài |
| **Helmet + CORS** | Cấu hình header an toàn; CORS không bật credentials (xác thực bằng Bearer token) |
| **Giới hạn tài nguyên** | JSON limit 1MB; tối đa 5 upload file trong RAM đồng thời (chống OOM) |
| **Không leak lỗi nội bộ** | Response chỉ trả message chung; chi tiết lỗi chỉ ghi log server |

## 4. Công nghệ

| Công nghệ | Mục đích |
|---|---|
| **Node.js + Express 5** | Framework REST API |
| **TypeScript** | Kiểu dữ liệu tĩnh |
| **@supabase/supabase-js** | Client kết nối Supabase (dùng `service_role_key`) |
| **JWT (jsonwebtoken)** | Xác thực người dùng |
| **bcryptjs** | Mã hoá mật khẩu & bảo vệ tài liệu |
| **zod** | Validate input tập trung |
| **Multer** | Upload file (memory storage, giới hạn 100MB) |
| **express-rate-limit** | Giới hạn request (login / OTP / share-public) |
| **Axios + Brevo API** | Gửi email OTP đặt lại mật khẩu |
| **Helmet + CORS + dotenv** | Bảo mật header, CORS, biến môi trường |

### Database & Storage

| Công nghệ | Mục đích |
|---|---|
| **PostgreSQL + PostGIS** | Lưu dữ liệu, truy vấn toạ độ `POINT(long lat)` qua RPC `get_nearby_documents` |
| **Supabase Storage** | Lưu file upload (bucket `documents` private, `avatars` public), cấp signed URL |

## 5. Kiến trúc

```
┌─────────────────────────────────────┐
│  Share — Frontend                  │
│  React Native (Android/iOS/Web)    │
│  github.com/Tanhzi/Share           │
└──────────────────┬──────────────────┘
                   │  REST API + JWT (Bearer)
┌──────────────────▼──────────────────┐
│  BeShare — Express + TypeScript    │
│  routes → middleware → controllers │
│  (validate, rate-limit, auth)      │
└──────────────────┬──────────────────┘
                   │
        ┌──────────▼───────────┐
        │  Supabase            │
        │  PostgreSQL + PostGIS│
        │  Storage (file/ảnh)  │
        └──────────────────────┘
```

## 6. Cài đặt & chạy

### Yêu cầu hệ thống

- Node.js >= 20.x, npm
- Tài khoản **Supabase** (Database + Storage)

### Bước 1: Cài dependencies

```bash
npm install
```

### Bước 2: Cấu hình biến môi trường

Copy `.env.example` thành `.env` ở thư mục gốc:

```env
# Server
PORT=5000
JWT_SECRET=your_jwt_secret_min_32_chars

# Supabase
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# Brevo Email (tùy chọn — cho quên mật khẩu)
BREVO_API_KEY=your_brevo_api_key
SENDER_EMAIL=your_sender_email
SENDER_NAME="ShareDocu"
```

### Bước 3: Khởi tạo database

Chạy các file SQL trong `migrations/` trên Supabase SQL Editor **theo đúng thứ tự**:

1. `000_init.sql` — schema đầy đủ (bảng, index, RPC `get_nearby_documents`, bucket Storage)
2. `001_add_user_preferences.sql` — cột `auto_download` / `auto_view`
3. `002_add_token_version.sql` — cột `token_version` (thu hồi JWT)
4. `003_unique_connections.sql` — unique index `(requester_id, receiver_id)` chống chèn connection trùng

### Bước 4: Chạy server

| Lệnh | Mô tả |
|---|---|
| `npm run dev` | Chạy development với nodemon (hot-reload) |
| `npm run build` | Biên dịch TypeScript → `dist/` |
| `npm start` | Chạy production (`node dist/app.js`) |

> **Ghi chú**: script `test` trong `package.json` là placeholder mặc định của npm (`exit 1`) — dự án chưa có bộ unit test.

Server chạy tại: `http://localhost:5000`

## 7. Cấu trúc thư mục

```
BeShare/
├── src/
│   ├── app.ts                # Khởi tạo Express app (helmet, CORS, error handler)
│   ├── config/
│   │   └── db.ts             # Client Supabase
│   ├── controllers/          # Xử lý logic nghiệp vụ
│   │   ├── authController.ts       # Đăng ký, đăng nhập, quên/đặt lại mật khẩu
│   │   ├── documentController.ts   # Chia sẻ, quét, xác thực & tải tài liệu
│   │   ├── syncController.ts       # Kết nối tài khoản, cài đặt
│   │   ├── historyController.ts    # Lịch sử giao dịch
│   │   ├── myShareController.ts    # Quản lý tài liệu đã chia sẻ
│   │   ├── profileController.ts    # Cập nhật hồ sơ
│   │   └── uploadController.ts     # Upload avatar
│   ├── middleware/
│   │   ├── authMiddleware.ts       # Bảo vệ route bằng JWT + token_version
│   │   ├── rateLimiter.ts          # Giới hạn login/OTP/share-public
│   │   ├── uploadValidation.ts     # Allowlist file upload
│   │   ├── uploadConcurrency.ts    # Giới hạn upload đồng thời (chống OOM)
│   │   └── validate.ts             # Validate input bằng zod
│   ├── routes/                # Định nghĩa endpoint
│   ├── services/
│   │   └── emailService.ts    # Gửi email qua Brevo
│   └── validation/
│       └── schemas.ts         # Zod schemas tập trung
├── migrations/                # SQL migration (000 → 001 → 002 → 003)
├── .env                       # Biến môi trường (không commit)
├── .env.example               # Mẫu biến môi trường
└── package.json
```

## 8. API Endpoints

### Authentication (`/api/auth`)

| Method | Endpoint | Mô tả | Bảo vệ |
|---|---|---|---|
| POST | `/register` | Đăng ký tài khoản | - |
| POST | `/login` | Đăng nhập, trả về JWT token | - |
| POST | `/change-password` | Đổi mật khẩu (thu hồi token cũ) | ✅ |
| POST | `/forgot-password` | Gửi mã OTP qua email | - |
| POST | `/reset-password` | Đặt lại mật khẩu bằng OTP | - |
| PUT | `/profile` | Cập nhật hồ sơ | ✅ |
| POST | `/upload-avatar` | Upload ảnh đại diện (tối đa 5MB) | ✅ |

### Documents (`/api/documents`)

| Method | Endpoint | Mô tả | Bảo vệ |
|---|---|---|---|
| POST | `/share` | Chia sẻ tài liệu (upload file/link/text) | ✅ |
| POST | `/share-public` | Chia sẻ tài liệu công khai (không cần đăng nhập) | rate limit |
| GET | `/scan?latitude=&longitude=&radius=` | Quét tài liệu gần vị trí | ✅ |
| GET | `/scan-public` | Quét tài liệu gần (không cần đăng nhập) | - |
| GET | `/my-documents` | Danh sách tài liệu đã chia sẻ | ✅ |
| DELETE | `/my-documents/:id` | Xoá tài liệu | ✅ |
| PUT | `/my-documents/:id/password` | Cập nhật bảo vệ mật khẩu | ✅ |
| POST | `/verify-password` | Xác thực mật khẩu, lấy link tải | ✅ |
| POST | `/verify-password-public` | Xác thực mật khẩu (công khai) | - |
| GET | `/download/:id` | Lấy signed URL tải tài liệu | ✅ |
| GET | `/download-public/:id` | Tải tài liệu (công khai) | - |
| GET | `/history/all` | Lịch sử giao dịch của user | ✅ |

### Sync (`/api/sync`)

| Method | Endpoint | Mô tả | Bảo vệ |
|---|---|---|---|
| POST | `/link` | Gửi lời mời kết nối theo email | ✅ |
| GET | `/requests` | Lời mời đến & đã gửi (pending) | ✅ |
| POST | `/respond` | Chấp nhận / từ chối lời mời | ✅ |
| GET | `/status` | Trạng thái kết nối + cài đặt cá nhân | ✅ |
| POST | `/unlink` | Huỷ kết nối | ✅ |
| PUT | `/settings` | Cập nhật auto-download / auto-view | ✅ |
| POST | `/cancel` | Rút lại lời mời đã gửi | ✅ |
| GET | `/documents` | Tài liệu mới nhất của partner (max 10) | ✅ |

## 9. Cấu trúc database

### Bảng `users`

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | UUID | Primary key |
| `full_name` | String | Tên người dùng |
| `email` | String | Email, unique |
| `password_hash` | String | Mật khẩu mã hoá (bcrypt) |
| `avatar_url` | String | Ảnh đại diện (public URL bucket `avatars`) |
| `reset_code` | String | Mã OTP (fallback plaintext nếu migration chưa chạy) |
| `reset_code_hash` | String | Mã OTP mã hoá bcrypt (ưu tiên dùng) |
| `reset_code_expires` | Timestamp | Hạn OTP (10 phút) |
| `token_version` | Int | Tăng khi đổi/đặt lại mật khẩu → thu hồi JWT cũ |
| `auto_download` | Boolean | Cài đặt cá nhân - tự tải về |
| `auto_view` | Boolean | Cài đặt cá nhân - tự xem |
| `created_at` | Timestamp | Thời gian tạo (mặc định `now()`) |
| `updated_at` | Timestamp | Thời gian cập nhật (mặc định `now()`) |

### Bảng `documents`

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | UUID | Primary key |
| `owner_id` | UUID | FK → users (`null` nếu chia sẻ công khai) |
| `name` | String | Tên tài liệu |
| `file_url` | String | Đường dẫn trong Supabase Storage (hoặc URL link) |
| `file_type` | String | Photos, Videos, Files, Links, Text |
| `file_size` | BigInt | Dung lượng |
| `is_protected` | Boolean | Có mật khẩu |
| `password_hash` | String | Mật khẩu mã hoá |
| `is_anonymous` | Boolean | Chia sẻ ẩn danh (che `owner_name` khi quét) |
| `expires_at` | Timestamp | Thời gian hết hạn |
| `status` | String | `active` / `expired` (CHECK constraint) |
| `location` | GEOGRAPHY(POINT,4326) | Toạ độ — index GIST cho truy vấn PostGIS |
| `text_content` | Text | Nội dung tài liệu Text (ưu tiên đọc cột, fallback Storage) |
| `created_at` | Timestamp | Thời gian tạo |

### Bảng `connections`

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | UUID | Primary key |
| `requester_id` | UUID | FK → users (người gửi lời mời) |
| `receiver_id` | UUID | FK → users (người nhận lời mời) |
| `status` | String | `pending` hoặc `connected` (CHECK constraint) |
| `created_at` | Timestamp | Thời gian tạo lời mời |

> Unique index `(requester_id, receiver_id)` — chống chèn trùng do race condition (migration `003`).

### Bảng `transfer_history`

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | UUID | Primary key |
| `document_id` | UUID | FK → documents |
| `sender_id` | UUID | FK → users (`null` nếu không rõ chủ — doc public) |
| `receiver_id` | UUID | FK → users |
| `action_type` | String | `share`, `download`, `private_share` (CHECK constraint) |
| `created_at` | Timestamp | Thời gian ghi log |

### Function PostGIS (Supabase)

- **`get_nearby_documents(lat, long, radius_meters)`**: RPC trả tài liệu còn hiệu lực trong bán kính cho trước.
  - Trả về: cột `documents` + `distance` (mét) + `owner_name` (`null` khi `is_anonymous`)
  - Lọc sẵn trong SQL: `status = 'active'`, chưa hết hạn, có vị trí

## 10. Ghi chú kỹ thuật

1. **Chế độ REST-only**: pull mechanism — không dùng Socket.IO/real-time push (package `socket.io` đã gỡ khỏi dependencies).
2. **Xác thực custom**: JWT tự ký (`JWT_SECRET`) với bảng `users` — **không dùng** Supabase Auth.
3. **Cài đặt cá nhân**: `auto_download` / `auto_view` nằm ở bảng `users` (mỗi người một cài đặt riêng).
4. **Chia sẻ riêng tư**: bật "Chỉ chia sẻ cho partner" → ghi `transfer_history` với `action_type = private_share`; các tài liệu này **không hiện** trong `scan`, chỉ hiện trong `sync/documents`.
5. **Signed URL**: thời hạn 300 giây (5 phút) — tự hết hạn, bảo mật.
6. **CORS**: `cors()` với origin mặc định `'*'` — **không bật credentials** (app xác thực bằng Bearer token, không dùng cookie).
7. **Giới hạn upload**: file tối đa 100MB; avatar tối đa 5MB; tối đa 5 upload đồng thời trong RAM — vượt ngưỡng trả **503 Service Unavailable** (chống OOM).
8. **Chưa có test**: `npm test` là placeholder; kiểm thử hiện tập trung vào `npm run build` (tsc) — FE có bộ Jest test (4 suites / 17 tests).

## 11. License

ISC License — xem file [LICENSE](LICENSE).
