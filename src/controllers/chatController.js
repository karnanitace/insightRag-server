import mongoose from 'mongoose';
import { runRAG } from '../services/ragService.js';
import Chat from '../models/Chat.js';
import ChatHistory from '../models/ChatHistory.js';
import Document from '../models/Document.js';
import {
    HttpError,
    buildDocKey,
    resolveChatDocuments,
    ensureAllDocumentsChat,
    findOrCreateDocumentChat,
    serializeChat,
    serializeChats,
} from '../services/chatService.js';

const MAX_MESSAGE_LENGTH = 4000;
const HISTORY_TURNS = 4;

/**
 * Load a chat owned by the authenticated user, or throw 404.
 */
async function findOwnedChat(req) {
    if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'Chat not found');
    const chat = await Chat.findOne({ _id: req.params.id, userId: req.user._id });
    if (!chat) throw new HttpError(404, 'Chat not found');
    return chat;
}

/**
 * GET /api/chats
 * List the user's chats. The "All documents" chat is always first.
 */
export const listChats = async (req, res, next) => {
    try {
        await ensureAllDocumentsChat(req.user._id);

        const chats = await Chat.find({ userId: req.user._id }).sort({ lastMessageAt: -1, createdAt: -1 });
        chats.sort((a, b) => (b.scope === 'all') - (a.scope === 'all'));

        res.json({ success: true, chats: await serializeChats(chats) });
    } catch (error) {
        next(error);
    }
};

/**
 * POST /api/chats
 * Get or create the chat for a document or document group. Body: { documentIds }
 */
export const createChat = async (req, res, next) => {
    try {
        const documents = await resolveChatDocuments(req.user._id, req.body.documentIds);
        const { chat, created } = await findOrCreateDocumentChat(req.user._id, documents);

        res.status(created ? 201 : 200).json({ success: true, created, chat: await serializeChat(chat) });
    } catch (error) {
        next(error);
    }
};

/**
 * GET /api/chats/:id
 */
export const getChat = async (req, res, next) => {
    try {
        const chat = await findOwnedChat(req);
        res.json({ success: true, chat: await serializeChat(chat) });
    } catch (error) {
        next(error);
    }
};

/**
 * PATCH /api/chats/:id
 * Rename a chat and/or change its documents. Body: { title?, documentIds? }
 */
export const updateChat = async (req, res, next) => {
    try {
        const chat = await findOwnedChat(req);
        const { title, documentIds } = req.body;

        if (title !== undefined) {
            chat.title = typeof title === 'string' && title.trim() ? title.trim() : undefined;
        }

        if (documentIds !== undefined) {
            if (chat.scope === 'all') {
                throw new HttpError(400, 'The "All documents" chat always includes every document');
            }

            const documents = await resolveChatDocuments(req.user._id, documentIds);
            const docKey = buildDocKey(documents.map((d) => d._id));

            if (docKey !== chat.docKey) {
                const existing = await Chat.findOne({ userId: req.user._id, docKey, _id: { $ne: chat._id } });
                if (existing) {
                    return res.status(409).json({
                        success: false,
                        message: 'A chat for these documents already exists',
                        existingChatId: existing._id,
                    });
                }

                chat.documentIds = documents.map((d) => d._id);
                chat.docKey = docKey;
                chat.archived = false;
                chat.archivedReason = undefined;
            }
        }

        await chat.save();
        res.json({ success: true, chat: await serializeChat(chat) });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({ success: false, message: 'A chat for these documents already exists' });
        }
        next(error);
    }
};

/**
 * DELETE /api/chats/:id
 * Delete a chat and its messages. Deleting "All documents" clears it (it's recreated on next list).
 */
export const deleteChat = async (req, res, next) => {
    try {
        const chat = await findOwnedChat(req);

        await ChatHistory.deleteMany({ chatId: chat._id });
        await Chat.deleteOne({ _id: chat._id });

        res.json({ success: true, message: 'Chat deleted' });
    } catch (error) {
        next(error);
    }
};

/**
 * GET /api/chats/:id/messages?before=<ISO date>&limit=<n>
 * Paginated message history, returned oldest first.
 */
export const getMessages = async (req, res, next) => {
    try {
        const chat = await findOwnedChat(req);
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 30, 1), 100);

        const query = { chatId: chat._id, userId: req.user._id };
        if (req.query.before) {
            const before = new Date(req.query.before);
            if (Number.isNaN(before.getTime())) throw new HttpError(400, 'Invalid "before" date');
            query.createdAt = { $lt: before };
        }

        const entries = await ChatHistory.find(query).sort({ createdAt: -1 }).limit(limit + 1).select('-__v').lean();
        const hasMore = entries.length > limit;
        const page = entries.slice(0, limit).reverse();

        // Flag sources whose document has since been deleted
        const sourceDocIds = [...new Set(page.flatMap((e) => e.sources.map((s) => s.documentId?.toString())).filter(Boolean))];
        const existingIds = new Set(
            (await Document.find({ _id: { $in: sourceDocIds }, userId: req.user._id }).distinct('_id')).map(String),
        );
        const messages = page.map((entry) => ({
            ...entry,
            sources: entry.sources.map((s) => ({ ...s, deleted: !existingIds.has(s.documentId?.toString()) })),
        }));

        res.json({ success: true, messages, hasMore });
    } catch (error) {
        next(error);
    }
};

/**
 * POST /api/chats/:id/messages
 * Ask the chat's agent a question. Supports streaming via SSE.
 */
export const sendMessage = async (req, res, next) => {
    try {
        const chat = await findOwnedChat(req);
        const userId = req.user._id;
        const message = typeof req.body.message === 'string' ? req.body.message.trim() : '';

        if (!message) throw new HttpError(400, 'Message is required');
        if (message.length > MAX_MESSAGE_LENGTH) {
            throw new HttpError(400, `Message must be at most ${MAX_MESSAGE_LENGTH} characters`);
        }
        if (chat.archived) {
            throw new HttpError(409, `This chat is read-only: ${chat.archivedReason}. Edit its documents to continue.`);
        }

        let documents = null;
        if (chat.scope === 'documents') {
            documents = await Document.find({ _id: { $in: chat.documentIds }, userId, status: 'indexed' }).lean();
            if (documents.length === 0) throw new HttpError(409, "This chat's documents are no longer available");
        }

        const history = (await ChatHistory.find({ chatId: chat._id }).sort({ createdAt: -1 }).limit(HISTORY_TURNS).lean()).reverse();

        const saveEntry = async (response, sources) => {
            const entry = await ChatHistory.create({ userId, chatId: chat._id, userQuery: message, response, sources });
            await Chat.updateOne({ _id: chat._id }, { lastMessageAt: entry.createdAt });
            return entry;
        };

        // Check for streaming request via Accept header or query param
        const wantsStream = req.headers.accept === 'text/event-stream' || req.query.stream === 'true';

        if (!wantsStream) {
            // ── Non-streaming response ──────────────────────────────
            const { answer, sources } = await runRAG(message, { userId, documents, history });
            const entry = await saveEntry(answer, sources);

            return res.json({
                success: true,
                data: { id: entry._id, answer, sources, createdAt: entry.createdAt },
            });
        }

        // ── Streaming response via SSE ──────────────────────────
        // Stop generating if the client disconnects
        const abortController = new AbortController();
        res.on('close', () => {
            if (!res.writableEnded) abortController.abort();
        });

        const { stream, answer, sources } = await runRAG(message, {
            userId,
            documents,
            history,
            stream: true,
            signal: abortController.signal,
        });

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        const send = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

        // Send sources first
        send({ type: 'sources', sources });

        let fullAnswer = '';
        if (stream) {
            try {
                for await (const chunk of stream) {
                    const content = chunk.content || '';
                    fullAnswer += content;
                    send({ type: 'token', content });
                }
            } catch (error) {
                if (abortController.signal.aborted) return;
                console.error('❌ Stream error:', error.message);
                send({ type: 'error', message: 'The answer was interrupted. Please try again.' });
                return res.end();
            }
        } else {
            // No relevant context — runRAG returned a canned answer instead of a stream
            fullAnswer = answer;
            send({ type: 'token', content: answer });
        }

        // Client went away — don't save a partial answer
        if (abortController.signal.aborted) return;

        const entry = await saveEntry(fullAnswer, sources);
        send({ type: 'done', id: entry._id, createdAt: entry.createdAt });
        res.end();
    } catch (error) {
        if (res.headersSent) {
            console.error('❌ Error:', error.stack || error.message);
            res.write(`data: ${JSON.stringify({ type: 'error', message: 'Something went wrong' })}\n\n`);
            return res.end();
        }
        next(error);
    }
};
