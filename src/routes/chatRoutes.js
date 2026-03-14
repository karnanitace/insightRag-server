import { Router } from 'express';
import { chat, getChatHistory } from '../controllers/chatController.js';
import { protect } from '../middlewares/authMiddleware.js';

const router = Router();

router.use(protect);

router.post('/', chat);
router.get('/history', getChatHistory);

export default router;
