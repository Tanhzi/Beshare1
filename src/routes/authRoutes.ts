import { Router } from 'express';
import multer from 'multer';
import { register, login, changePassword, forgotPassword, resetPassword } from '../controllers/authController';
import { protect } from '../middleware/authMiddleware';
import { avatarFileFilter } from '../middleware/uploadValidation';
import { loginLimiter, otpLimiter } from '../middleware/rateLimiter';
import { uploadConcurrencyLimiter } from '../middleware/uploadConcurrency';
import { validateBody } from '../middleware/validate';
import {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  updateProfileSchema,
} from '../validation/schemas';
import { updateProfile } from '../controllers/profileController';
import { uploadAvatar } from '../controllers/uploadController';

const router = Router();

// Cấu hình Multer (Lưu file vào RAM tạm thời trước khi đẩy lên Supabase)
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // Giới hạn 5MB
  fileFilter: avatarFileFilter // Chỉ chấp nhận ảnh
});

router.post('/register', validateBody(registerSchema), register);
router.post('/login', loginLimiter, validateBody(loginSchema), login);

// Route mới
router.post('/change-password', protect, validateBody(changePasswordSchema), changePassword); // Cần đăng nhập mới đổi được
router.post('/forgot-password', otpLimiter, validateBody(forgotPasswordSchema), forgotPassword); // Không cần đăng nhập
router.post('/reset-password', otpLimiter, validateBody(resetPasswordSchema), resetPassword);

router.put('/profile', protect, validateBody(updateProfileSchema), updateProfile);
// 'avatar' là tên trường (key) mà Frontend phải gửi trong FormData
router.post('/upload-avatar', protect, uploadConcurrencyLimiter, upload.single('avatar'), uploadAvatar);

export default router;
