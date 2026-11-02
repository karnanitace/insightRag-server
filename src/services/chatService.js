import mongoose from 'mongoose';
import Chat from '../models/Chat.js';
import ChatHistory from '../models/ChatHistory.js';
import Document from '../models/Document.js';

export const MAX_DOCUMENTS_PER_CHAT = 20;
export const ALL_DOCUMENTS_KEY = 'all';

const DUPLICATE_KEY = 11000;

/**
 * Error with an HTTP status, picked up by the global error handler.
 */
export class HttpError extends Error {
    constructor(statusCode, message) {
        super(message);
        this.statusCode = statusCode;
    }
}

/**
 * Canonical key for a set of document IDs (order-independent).
 */
export const buildDocKey = (documentIds) => documentIds.map(String).sort().join(',');

/**
 * Validate a client-supplied list of document IDs: dedupes, checks bounds, and verifies
 * every document belongs to the user and is indexed. Returns the documents.
 */
export async function resolveChatDocuments(userId, documentIds) {
    if (!Array.isArray(documentIds) || documentIds.length === 0) {
        throw new HttpError(400, 'Select at least one document');
    }

    const uniqueIds = [...new Set(documentIds.map(String))];
    if (uniqueIds.length > MAX_DOCUMENTS_PER_CHAT) {
        throw new HttpError(400, `A chat can include at most ${MAX_DOCUMENTS_PER_CHAT} documents`);
    }
    if (!uniqueIds.every((id) => mongoose.isValidObjectId(id))) {
        throw new HttpError(400, 'Invalid document ID');
    }

    const documents = await Document.find({ _id: { $in: uniqueIds }, userId }).lean();
    if (documents.length !== uniqueIds.length) {
        throw new HttpError(404, 'One or more documents were not found');
    }

    const notReady = documents.filter((d) => d.status !== 'indexed');
    if (notReady.length > 0) {
        throw new HttpError(400, `These documents aren't ready yet: ${notReady.map((d) => d.originalName).join(', ')}`);
    }

    return documents;
}

/**
 * Get or create the user's "All documents" chat. Also moves legacy chat history
 * (from before chats existed) into it.
 */
export async function ensureAllDocumentsChat(userId) {
    let chat;
    try {
        chat = await Chat.findOneAndUpdate(
            { userId, docKey: ALL_DOCUMENTS_KEY },
            { $setOnInsert: { scope: 'all', documentIds: [] } },
            { upsert: true, new: true },
        );
    } catch (error) {
        // Concurrent upsert lost the race — the chat exists now
        if (error.code !== DUPLICATE_KEY) throw error;
        chat = await Chat.findOne({ userId, docKey: ALL_DOCUMENTS_KEY });
    }

    const { modifiedCount } = await ChatHistory.updateMany({ userId, chatId: null }, { $set: { chatId: chat._id } });
    if (modifiedCount > 0 && !chat.lastMessageAt) {
        const latest = await ChatHistory.findOne({ chatId: chat._id }).sort({ createdAt: -1 });
        chat.lastMessageAt = latest?.createdAt;
        await chat.save();
    }

    return chat;
}

/**
 * Get the chat for exactly this set of documents, creating it if needed.
 */
export async function findOrCreateDocumentChat(userId, documents) {
    const docKey = buildDocKey(documents.map((d) => d._id));

    const existing = await Chat.findOne({ userId, docKey });
    if (existing) return { chat: existing, created: false };

    try {
        const chat = await Chat.create({
            userId,
            scope: 'documents',
            documentIds: documents.map((d) => d._id),
            docKey,
        });
        return { chat, created: true };
    } catch (error) {
        if (error.code !== DUPLICATE_KEY) throw error;
        return { chat: await Chat.findOne({ userId, docKey }), created: false };
    }
}

/**
 * Remove a deleted document from every chat that includes it. Chats left with no
 * documents, or whose remaining set duplicates another chat, are archived (read-only).
 */
export async function detachDocumentFromChats(userId, documentId) {
    const chats = await Chat.find({ userId, scope: 'documents', documentIds: documentId });

    for (const chat of chats) {
        chat.documentIds = chat.documentIds.filter((id) => !id.equals(documentId));

        if (chat.documentIds.length === 0) {
            archive(chat, 'All documents in this chat were deleted');
        } else if (!chat.archived) {
            const docKey = buildDocKey(chat.documentIds);
            const duplicate = await Chat.exists({ userId, docKey, _id: { $ne: chat._id } });
            if (duplicate) {
                archive(chat, 'Another chat already covers the remaining documents');
            } else {
                chat.docKey = docKey;
            }
        }

        await chat.save();
    }
}

function archive(chat, reason) {
    chat.archived = true;
    chat.archivedReason = reason;
    chat.docKey = undefined;
}

/**
 * Default title when the user hasn't set one.
 */
function autoTitle(chat, documents) {
    if (chat.scope === 'all') return 'All documents';
    if (documents.length === 0) return 'Untitled chat';
    if (documents.length === 1) return documents[0].originalName;
    if (documents.length === 2) return `${documents[0].originalName} & ${documents[1].originalName}`;
    return `${documents[0].originalName} + ${documents.length - 1} more`;
}

/**
 * Shape chats for API responses, resolving their documents in a single query.
 */
export async function serializeChats(chats) {
    const allIds = [...new Set(chats.flatMap((c) => c.documentIds.map(String)))];
    const docs = await Document.find({ _id: { $in: allIds } }).select('originalName status chunkCount').lean();
    const docMap = Object.fromEntries(docs.map((d) => [d._id.toString(), d]));

    return chats.map((chat) => {
        const documents = chat.documentIds.map((id) => docMap[id.toString()]).filter(Boolean);
        return {
            _id: chat._id,
            title: chat.title || autoTitle(chat, documents),
            customTitle: Boolean(chat.title),
            scope: chat.scope,
            documents,
            archived: chat.archived,
            archivedReason: chat.archivedReason,
            lastMessageAt: chat.lastMessageAt,
            createdAt: chat.createdAt,
        };
    });
}

export async function serializeChat(chat) {
    const [serialized] = await serializeChats([chat]);
    return serialized;
}
