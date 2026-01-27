import { Router } from 'express';
import multer from 'multer';
import { register, login, changePassword, forgotPassword, resetPassword } from '../controllers/authController';
import { protect } from '../middleware/authMiddleware';
import { updateProfile } from '../controllers/profileConreoller';
import { uploadAvatar } from '../controllers/uploadController';

const router = Router();

// Cấu hình Multer (Lưu file vào RAM tạm thời trước khi đẩy lên Supabase)
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // Giới hạn 5MB
});

router.post('/register', register);
router.post('/login', login);

// Route mới
router.post('/change-password', protect, changePassword); // Cần đăng nhập mới đổi được
router.post('/forgot-password', forgotPassword); // Không cần đăng nhập
router.post('/reset-password', resetPassword);

router.put('/profile', protect, updateProfile);
// 'avatar' là tên trường (key) mà Frontend phải gửi trong FormData
router.post('/upload-avatar', protect, upload.single('avatar'), uploadAvatar);

export default router;