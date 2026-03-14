import Document from '../models/Document.js';
import Chunk from '../models/Chunk.js';
import { parseDocument } from '../services/documentParser.js';
import { chunkText } from '../services/chunkService.js';
import { embedTexts } from '../services/embeddingService.js';
import fs from 'fs/promises';

/**
 * POST /api/documents/upload
 * Upload a document, parse it, chunk it, embed chunks, and store everything.
 */
export const uploadDocument = async (req, res, next) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }

        const { file } = req;
        const userId = req.user._id;

        // 1. Create document record
        const doc = await Document.create({
            userId,
            filename: file.filename,
            originalName: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
            status: 'processing',
        });

        // 2. Parse the document to extract text
        const rawText = await parseDocument(file.path, file.mimetype);

        if (!rawText || rawText.trim().length === 0) {
            doc.status = 'failed';
            await doc.save();
            return res.status(400).json({ success: false, message: 'Could not extract text from the document' });
        }

        // 3. Chunk the text
        const chunks = await chunkText(rawText);

        // 4. Generate embeddings for all chunks (batched)
        const embeddings = await embedTexts(chunks);

        // 5. Store chunks with embeddings
        const chunkDocs = chunks.map((text, i) => ({
            documentId: doc._id,
            userId,
            text,
            embedding: embeddings[i],
            chunkIndex: i,
        }));
        await Chunk.insertMany(chunkDocs);

        // 6. Update document status
        doc.status = 'indexed';
        doc.chunkCount = chunks.length;
        await doc.save();

        res.status(201).json({
            success: true,
            document: {
                id: doc._id,
                originalName: doc.originalName,
                size: doc.size,
                chunkCount: doc.chunkCount,
                status: doc.status,
                uploadDate: doc.uploadDate,
            },
        });
    } catch (error) {
        next(error);
    }
};

/**
 * GET /api/documents
 * List all documents for the authenticated user.
 */
export const getDocuments = async (req, res, next) => {
    try {
        const documents = await Document.find({ userId: req.user._id })
            .sort({ uploadDate: -1 })
            .select('-__v');

        res.json({ success: true, documents });
    } catch (error) {
        next(error);
    }
};

/**
 * DELETE /api/documents/:id
 * Delete a document and its associated chunks.
 */
export const deleteDocument = async (req, res, next) => {
    try {
        const doc = await Document.findOne({ _id: req.params.id, userId: req.user._id });

        if (!doc) {
            return res.status(404).json({ success: false, message: 'Document not found' });
        }

        // Delete the file from disk
        try {
            await fs.unlink(`uploads/${doc.filename}`);
        } catch {
            // File may already be deleted — ignore
        }

        // Delete chunks
        await Chunk.deleteMany({ documentId: doc._id });

        // Delete document record
        await Document.deleteOne({ _id: doc._id });

        res.json({ success: true, message: 'Document deleted' });
    } catch (error) {
        next(error);
    }
};
