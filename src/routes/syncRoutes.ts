import { Router } from 'express';
import { protect } from '../middleware/authMiddleware';
import { 
  linkAccount, 
  getSyncStatus, 
  unlinkAccount, 
  updateSettings,
  getPendingRequests, // Mới
  respondToRequest,    // Mới
  cancelRequest, // <-- Import thêm hàm này
  getPartnerDocuments // <-- Import API mới cho Instant Preview
} from '../controllers/syncController';

const router = Router();

router.post('/link', protect, linkAccount);
router.get('/status', protect, getSyncStatus);
router.post('/unlink', protect, unlinkAccount);
router.put('/settings', protect, updateSettings);

// API Mới
router.get('/requests', protect, getPendingRequests);
router.post('/respond', protect, respondToRequest);
router.post('/cancel', protect, cancelRequest);
router.get('/documents', protect, getPartnerDocuments); // <-- API mới cho Instant Preview

export default router;