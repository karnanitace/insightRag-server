import { runRAG } from '../services/ragService.js';
import ChatHistory from '../models/ChatHistory.js';

/**
 * POST /api/chat
 * Send a message to the RAG chatbot. Supports streaming via SSE.
 */
export const chat = async (req, res, next) => {
    try {
        const { message } = req.body;
        const userId = req.user._id;

        if (!message || !message.trim()) {
            return res.status(400).json({ success: false, message: 'Message is required' });
        }

        // Check for streaming request via Accept header or query param
        const wantsStream = req.headers.accept === 'text/event-stream' || req.query.stream === 'true';

        if (wantsStream) {
            // ── Streaming response via SSE ──────────────────────────
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');

            const { stream, sources } = await runRAG(message, userId, { stream: true });

            // Send sources first
            res.write(`data: ${JSON.stringify({ type: 'sources', sources })}\n\n`);

            let fullAnswer = '';
            for await (const chunk of stream) {
                const content = chunk.content || '';
                fullAnswer += content;
                res.write(`data: ${JSON.stringify({ type: 'token', content })}\n\n`);
            }

            // Save to history
            await ChatHistory.create({
                userId,
                userQuery: message,
                response: fullAnswer,
                sources,
            });

            res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
            res.end();
        } else {
            // ── Non-streaming response ──────────────────────────────
            const { answer, sources } = await runRAG(message, userId);

            // Save to history
            const chatEntry = await ChatHistory.create({
                userId,
                userQuery: message,
                response: answer,
                sources,
            });

            res.json({
                success: true,
                data: {
                    id: chatEntry._id,
                    answer,
                    sources,
                    createdAt: chatEntry.createdAt,
                },
            });
        }
    } catch (error) {
        next(error);
    }
};

/**
 * GET /api/chat/history
 * Retrieve chat history for the authenticated user.
 */
export const getChatHistory = async (req, res, next) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const history = await ChatHistory.find({ userId: req.user._id })
            .sort({ createdAt: -1 })
            .limit(limit)
            .select('-__v');

        res.json({ success: true, history });
    } catch (error) {
        next(error);
    }
};
