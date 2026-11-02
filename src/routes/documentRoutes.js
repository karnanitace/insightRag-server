import { Router } from 'express';
import { uploadDocument, getDocuments, deleteDocument } from '../controllers/documentController.js';
import { protect, blockDemo } from '../middlewares/authMiddleware.js';
import { upload } from '../middlewares/uploadMiddleware.js';

const router = Router();

// All document routes are protected
router.use(protect);

router.post('/upload', upload.single('file'), uploadDocument);
router.get('/', getDocuments);
router.delete('/:id', blockDemo, deleteDocument);

export default router;
