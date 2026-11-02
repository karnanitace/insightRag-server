import { Router } from 'express';
import {
    listChats,
    createChat,
    getChat,
    updateChat,
    deleteChat,
    getMessages,
    sendMessage,
} from '../controllers/chatController.js';
import { protect, blockDemo } from '../middlewares/authMiddleware.js';

const router = Router();

router.use(protect);

router.get('/', listChats);
router.post('/', createChat);
router.get('/:id', getChat);
router.patch('/:id', updateChat);
router.delete('/:id', blockDemo, deleteChat);
router.get('/:id/messages', getMessages);
router.post('/:id/messages', sendMessage);

export default router;
