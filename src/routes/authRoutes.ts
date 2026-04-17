import { Router } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { register, login, changePassword, forgotPassword, resetPassword } from '../controllers/authController';
import { protect } from '../middleware/authMiddleware';
import { updateProfile } from '../controllers/profileConreoller';
import { uploadAvatar } from '../controllers/uploadController';

const router = Router();

// File type / size allowlist for avatar uploads. Anything else is rejected.
const ALLOWED_AVATAR_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 }, // 5MB, single file
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_AVATAR_MIME.has(file.mimetype)) {
      cb(new Error('Unsupported file type'));
      return;
    }
    cb(null, true);
  },
});

// Rate limiters for credential-abuse-prone endpoints. These sit on top of the
// app-wide limiter in app.ts. Keys default to client IP.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { message: 'Too many attempts, please try again later.' },
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { message: 'Too many accounts from this IP, please try again later.' },
});

const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { message: 'Too many attempts, please try again later.' },
});

router.post('/register', registerLimiter, register);
router.post('/login', loginLimiter, login);

// Route mới
router.post('/change-password', protect, changePassword); // Cần đăng nhập mới đổi được
router.post('/forgot-password', otpLimiter, forgotPassword); // Không cần đăng nhập
router.post('/reset-password', otpLimiter, resetPassword);

router.put('/profile', protect, updateProfile);
// 'avatar' là tên trường (key) mà Frontend phải gửi trong FormData
router.post('/upload-avatar', protect, upload.single('avatar'), uploadAvatar);

export default router;
