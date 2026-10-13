import express, { ErrorRequestHandler } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// Import Routes
import authRoutes from './routes/authRoutes';
import syncRoutes from './routes/syncRoutes';
import documentRoutes from './routes/documentRoutes';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Cảnh báo JWT_SECRET yếu (Thấp 1)
if ((process.env.JWT_SECRET || '').length < 32) {
  console.warn('⚠️ JWT_SECRET nên có độ dài >= 32 ký tự ngẫu nhiên.');
}

// Đứng sau reverse proxy (Supabase/Cloudflare/Nginx) để đọc IP thật cho rate limit
app.set('trust proxy', 1);

// --- 1. MIDDLEWARE ---
app.use(helmet());
// App xác thực bằng Bearer token (không dùng cookie/credentials) → chỉ cần origin '*' (B7)
app.use(cors());
// Log request (Thấp 2)
app.use((req, res, next) => {
  res.on('finish', () => {
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode}`);
  });
  next();
});
// Payload JSON chỉ là field nhỏ (file đi qua multipart/multer riêng) — hạ limit chống DoS (B8)
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// --- 2. ROUTES API ---
app.use('/api/auth', authRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/documents', documentRoutes);

const uploadErrorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (err?.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({
      message: 'File is too large. Maximum upload size is 100MB.',
      code: err.code,
    });
    return;
  }

  if (err?.code === 'INVALID_FILE_TYPE') {
    res.status(400).json({
      message: 'File type not allowed. Please upload an image, video or document file.',
      code: err.code,
    });
    return;
  }

  next(err);
};

app.use(uploadErrorHandler);

// Test Route
app.get('/', (req, res) => {
  res.send('ShareDocu API is running...');
});

// --- 2.1. 404 JSON (thay vì HTML của Express) ---
app.use((req, res) => {
  res.status(404).json({ message: 'Not found' });
});

// --- 2.2. Global error handler: KHÔNG trả stack trace cho client ---
const globalErrorHandler: ErrorRequestHandler = (err, req, res, next) => {
  console.error('Unhandled Error:', err);

  // Ở môi trường development mới trả message chi tiết (không kèm stack)
  const detail = process.env.NODE_ENV === 'development' && err?.message
    ? { error: err.message }
    : {};

  res.status(err?.status || 500).json({
    message: 'Internal server error',
    ...detail,
  });
};

app.use(globalErrorHandler);

// --- 3. KHỞI CHẠY SERVER ---
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`✨ Mode: REST API only (Pull mechanism)`);
});