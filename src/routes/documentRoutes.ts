import { Router } from 'express';
import multer from 'multer';
import { protect } from '../middleware/authMiddleware';
import { shareDocument, scanNearbyDocuments, verifyDocumentPassword, getDocumentDownload, shareDocumentPublic } from '../controllers/documentController';
import { getMyDocuments, deleteDocument, updatePasswordProtection } from '../controllers/myShareController';
import { getHistory } from '../controllers/historyController';
const router = Router();

// Cấu hình Multer để nhận file
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // Giới hạn 50MB
});

// Route chia sẻ (Upload)
router.post('/share', protect, upload.single('file'), shareDocument);
router.post('/share-public', upload.single('file'), shareDocumentPublic);
router.get('/scan', protect, scanNearbyDocuments);
router.get('/scan-public', scanNearbyDocuments);

// Route tài liệu
router.get('/my-documents', protect, getMyDocuments);
router.delete('/my-documents/:id', protect, deleteDocument);
router.put('/my-documents/:id/password', protect, updatePasswordProtection);

router.post('/verify-password', protect, verifyDocumentPassword);
router.post('/verify-password-public', verifyDocumentPassword);
router.get('/download/:id', protect, getDocumentDownload);
router.get('/download-public/:id', getDocumentDownload);


router.get('/history/all', protect, getHistory);

export default router;