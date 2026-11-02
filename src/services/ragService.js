import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { searchChunks } from './vectorSearchService.js';
import Document from '../models/Document.js';
import Chunk from '../models/Chunk.js';

// Single-document chats include the whole document when it's at most this many chunks
const FULL_DOCUMENT_MAX_CHUNKS = 15;
// Prior Q/A turns included as conversation memory
const HISTORY_TURNS = 4;
const HISTORY_ANSWER_MAX_CHARS = 1500;

let llm = null;

function getLLM() {
    if (!llm) {
        llm = new ChatGoogleGenerativeAI({
            apiKey: process.env.GOOGLE_GENAI_API_KEY,
            model: process.env.LLM_MODEL || 'gemini-2.0-flash',
            temperature: 0.3,
            streaming: true,
        });
    }
    return llm;
}

/**
 * Describe what the chat is scoped to, for the system prompt.
 */
function describeScope(documents) {
    if (!documents) return "You have access to all of the user's uploaded documents.";
    if (documents.length === 1) return `You are dedicated to a single document: "${documents[0].originalName}".`;
    return `You are dedicated to this group of documents:\n${documents.map((d) => `- ${d.originalName}`).join('\n')}`;
}

/**
 * Build a grounded prompt: system context, recent conversation turns, then the question.
 */
function buildPrompt({ chunks, docMap, documents, fullDocumentText, history, userQuery }) {
    const contextBlock = chunks
        .map((c, i) => `[Source ${i + 1}] (from: ${docMap[c.documentId?.toString()] || 'Unknown'}, score: ${c.score?.toFixed(3) ?? 'N/A'})\n${c.text}`)
        .join('\n\n---\n\n');

    const fullDocumentBlock = fullDocumentText
        ? `\n\n## Full Document Text\nThe complete document is included below for document-wide questions (e.g. summaries). Prefer citing the numbered sources when they contain the answer.\n\n${fullDocumentText}`
        : '';

    const historyMessages = history.flatMap((turn) => [
        { role: 'user', content: turn.userQuery },
        { role: 'assistant', content: turn.response.substring(0, HISTORY_ANSWER_MAX_CHARS) },
    ]);

    return [
        {
            role: 'system',
            content: `You are InsightRAG — an expert AI research assistant. ${describeScope(documents)}

Answer the user's question based ONLY on the provided context. If the context does not contain enough information, say so clearly. Always cite which source(s) you used (e.g. [Source 1]). Use the conversation so far to understand follow-up questions.

## Retrieved Context
${contextBlock}${fullDocumentBlock}`,
        },
        ...historyMessages,
        { role: 'user', content: userQuery },
    ];
}

/**
 * Agentic RAG pipeline.
 *
 * 1. Rewrite follow-up questions into standalone search queries using chat history.
 * 2. Retrieve relevant chunks via vector search, scoped to the chat's documents.
 * 3. If the retrieved context looks weak, refine the query and re-retrieve (one retry).
 * 4. Generate a grounded answer with source citations.
 *
 * @param {string} query – user question
 * @param {object} options
 * @param {string} options.userId – owner of the documents
 * @param {Array|null} options.documents – the chat's documents (null = all of the user's documents)
 * @param {Array} options.history – previous ChatHistory entries, oldest first
 * @param {boolean} options.stream – whether to return a readable stream (default false)
 * @param {AbortSignal} options.signal – aborts LLM generation
 * @returns {Promise<{answer?: string, stream?: AsyncIterable, sources: Array}>}
 */
export async function runRAG(query, { userId, documents = null, history = [], stream = false, signal } = {}) {
    const model = getLLM();
    const recentHistory = history.slice(-HISTORY_TURNS);
    const documentIds = documents ? documents.map((d) => d._id) : null;
    const search = (q) => searchChunks(q, userId, { documentIds, topK: 5 });

    // ── Step 1: Make follow-ups searchable ────────────────────
    const searchQuery = recentHistory.length > 0 ? await condenseQuestion(model, query, recentHistory) : query;

    // ── Step 2: Retrieve ──────────────────────────────────────
    let chunks = await search(searchQuery);

    if (chunks.length === 0) {
        return {
            answer: documents
                ? "I couldn't find any relevant information in this chat's documents."
                : "I couldn't find any relevant information in your documents. Please make sure you've uploaded documents related to your question.",
            sources: [],
        };
    }

    // ── Step 3: Evaluate sufficiency — refine if weak (agentic behaviour) ──
    const topScore = chunks[0]?.score ?? 0;
    if (topScore < 0.5) {
        const refinedQuery = await refineQuery(model, searchQuery, chunks);
        if (refinedQuery && refinedQuery !== searchQuery) {
            const refinedChunks = await search(refinedQuery);
            if (refinedChunks.length > 0) chunks = refinedChunks;
        }
    }

    // ── Step 4: Generate answer ───────────────────────────────
    const docIds = [...new Set(chunks.map((c) => c.documentId?.toString()))];
    const docs = documents ?? await Document.find({ _id: { $in: docIds } }).lean();
    const docMap = Object.fromEntries(docs.map((d) => [d._id.toString(), d.originalName]));

    let fullDocumentText = null;
    if (documents?.length === 1 && documents[0].chunkCount <= FULL_DOCUMENT_MAX_CHUNKS) {
        const allChunks = await Chunk.find({ documentId: documents[0]._id, userId })
            .sort({ chunkIndex: 1 })
            .select('text')
            .lean();
        fullDocumentText = allChunks.map((c) => c.text).join('\n\n');
    }

    const messages = buildPrompt({ chunks, docMap, documents, fullDocumentText, history: recentHistory, userQuery: query });

    const sources = chunks.map((c) => {
        const score = typeof c.score === 'number' && Number.isFinite(c.score) ? c.score : 0;
        return {
            documentId: c.documentId,
            filename: docMap[c.documentId?.toString()] || 'Unknown',
            chunkText: (c.text || '').substring(0, 200),
            score,
        };
    });

    if (stream) {
        // Return a LangChain stream — caller handles SSE
        const responseStream = await model.stream(messages, { signal });
        return { stream: responseStream, sources };
    }

    const response = await model.invoke(messages, { signal });
    return { answer: response.content, sources };
}

/**
 * Rewrite a follow-up question (e.g. "what about the second one?") into a standalone
 * search query using recent conversation turns.
 */
async function condenseQuestion(model, query, history) {
    try {
        const transcript = history
            .map((t) => `User: ${t.userQuery}\nAssistant: ${t.response.substring(0, 500)}`)
            .join('\n\n');
        const response = await model.invoke([
            {
                role: 'system',
                content: `Given the conversation below and a follow-up question, rewrite the follow-up as a standalone search query that includes any context it refers to. If it is already standalone, return it unchanged. Return ONLY the query, nothing else.\n\nConversation:\n${transcript}`,
            },
            { role: 'user', content: query },
        ]);
        return response.content.trim() || query;
    } catch {
        return query;
    }
}

/**
 * Agentic query refinement.
 * Asks the LLM to rephrase the user's question so it's more likely to match
 * relevant document chunks.
 */
async function refineQuery(model, originalQuery, existingChunks) {
    try {
        const existingContext = existingChunks.map((c) => c.text.substring(0, 150)).join('\n');
        const response = await model.invoke([
            {
                role: 'system',
                content: `You are a search query optimizer. The user asked a question and the retrieved context below was not highly relevant. Rephrase the user's question to better match document content. Return ONLY the rephrased query, nothing else.\n\nExisting context preview:\n${existingContext}`,
            },
            { role: 'user', content: originalQuery },
        ]);
        return response.content.trim();
    } catch {
        return originalQuery;
    }
}
