import { Router } from 'express';
import multer from 'multer';
import { protect } from '../middleware/authMiddleware';
import { shareDocument, scanNearbyDocuments, verifyDocumentPassword, getDocumentDownload } from '../controllers/documentController';

const router = Router();

// Cấu hình Multer để nhận file
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // Giới hạn 50MB
});

// Route chia sẻ (Upload)
router.post('/share', protect, upload.single('file'), shareDocument);
router.get('/scan', protect, scanNearbyDocuments);
router.post('/verify-password', protect, verifyDocumentPassword);
router.get('/download/:id', protect, getDocumentDownload);

export default router;