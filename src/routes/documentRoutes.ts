import { Router } from 'express';
import multer from 'multer';
import { protect } from '../middleware/authMiddleware';
import { documentFileFilter } from '../middleware/uploadValidation';
import { publicShareLimiter } from '../middleware/rateLimiter';
import { uploadConcurrencyLimiter } from '../middleware/uploadConcurrency';
import { validateBody, validateQuery } from '../middleware/validate';
import {
  shareSchema,
  sharePublicSchema,
  scanQuerySchema,
  verifyPasswordSchema,
  updatePasswordProtectionSchema,
} from '../validation/schemas';
import { shareDocument, scanNearbyDocuments, verifyDocumentPassword, getDocumentDownload, shareDocumentPublic } from '../controllers/documentController';
import { getMyDocuments, deleteDocument, updatePasswordProtection } from '../controllers/myShareController';
import { getHistory } from '../controllers/historyController';
const router = Router();

// Cấu hình Multer để nhận file
const MAX_DOCUMENT_UPLOAD_SIZE_MB = 100;
const MAX_DOCUMENT_UPLOAD_SIZE_BYTES = MAX_DOCUMENT_UPLOAD_SIZE_MB * 1024 * 1024;

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DOCUMENT_UPLOAD_SIZE_BYTES },
  fileFilter: documentFileFilter
});

// Route chia sẻ (Upload) — validate body SAU khi multer parse multipart
router.post('/share', protect, uploadConcurrencyLimiter, upload.single('file'), validateBody(shareSchema), shareDocument);
router.post('/share-public', publicShareLimiter, uploadConcurrencyLimiter, upload.single('file'), validateBody(sharePublicSchema), shareDocumentPublic);
router.get('/scan', protect, validateQuery(scanQuerySchema), scanNearbyDocuments);
router.get('/scan-public', validateQuery(scanQuerySchema), scanNearbyDocuments);

// Route tài liệu
router.get('/my-documents', protect, getMyDocuments);
router.delete('/my-documents/:id', protect, deleteDocument);
router.put('/my-documents/:id/password', protect, validateBody(updatePasswordProtectionSchema), updatePasswordProtection);

router.post('/verify-password', protect, validateBody(verifyPasswordSchema), verifyDocumentPassword);
router.post('/verify-password-public', validateBody(verifyPasswordSchema), verifyDocumentPassword);
router.get('/download/:id', protect, getDocumentDownload);
router.get('/download-public/:id', getDocumentDownload);


router.get('/history/all', protect, getHistory);

export default router;
