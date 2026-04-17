import { Router } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { protect } from '../middleware/authMiddleware';
import { shareDocument, scanNearbyDocuments, verifyDocumentPassword, getDocumentDownload, shareDocumentPublic } from '../controllers/documentController';
import { getMyDocuments, deleteDocument, updatePasswordProtection } from '../controllers/myShareController';
import { getHistory } from '../controllers/historyController';
const router = Router();

// Cấu hình Multer để nhận file
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 1 } // Giới hạn 50MB
});

// Public endpoints (no auth) get tighter rate limits to curb anonymous abuse.
const publicShareLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { message: 'Too many uploads, please try again later.' },
});

// Brute-forcing is cheap since document IDs may be UUIDs but the verify-password
// endpoint accepts guesses for any is_protected document. Cap attempts per IP.
const verifyPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { message: 'Too many attempts, please try again later.' },
});

// Route chia sẻ (Upload)
router.post('/share', protect, upload.single('file'), shareDocument);
router.post('/share-public', publicShareLimiter, upload.single('file'), shareDocumentPublic);
router.get('/scan', protect, scanNearbyDocuments);
router.get('/scan-public', scanNearbyDocuments);

// Route tài liệu
router.get('/my-documents', protect, getMyDocuments);
router.delete('/my-documents/:id', protect, deleteDocument);
router.put('/my-documents/:id/password', protect, updatePasswordProtection);

router.post('/verify-password', protect, verifyPasswordLimiter, verifyDocumentPassword);
router.post('/verify-password-public', verifyPasswordLimiter, verifyDocumentPassword);
router.get('/download/:id', protect, getDocumentDownload);
router.get('/download-public/:id', getDocumentDownload);


router.get('/history/all', protect, getHistory);

export default router;
