import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { vectorSearch, fallbackVectorSearch } from './vectorSearchService.js';
import Document from '../models/Document.js';

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
 * Build a grounded system prompt that includes the retrieved context chunks.
 */
function buildPrompt(chunks, userQuery) {
    const contextBlock = chunks
        .map((c, i) => `[Source ${i + 1}] (score: ${c.score?.toFixed(3) ?? 'N/A'})\n${c.text}`)
        .join('\n\n---\n\n');

    return [
        {
            role: 'system',
            content: `You are InsightRAG — an expert AI research assistant. Answer the user's question based ONLY on the provided context. If the context does not contain enough information, say so clearly. Always cite which source(s) you used (e.g. [Source 1]).

## Retrieved Context
${contextBlock}`,
        },
        { role: 'user', content: userQuery },
    ];
}

/**
 * Agentic RAG pipeline.
 *
 * 1. Retrieve relevant chunks via vector search.
 * 2. Evaluate whether the retrieved context is sufficient.
 * 3. If insufficient, refine the query and re-retrieve (one retry).
 * 4. Generate a grounded answer with source citations.
 *
 * @param {string} query – user question
 * @param {string} userId – restrict retrieval to this user's documents
 * @param {object} options
 * @param {boolean} options.stream – whether to return a readable stream (default false)
 * @returns {Promise<{answer: string, sources: Array}>}
 */
export async function runRAG(query, userId, { stream = false } = {}) {
    const model = getLLM();

    // ── Step 1: Retrieve ──────────────────────────────────────
    let chunks;
    try {
        chunks = await vectorSearch(query, userId, { topK: 5 });
    } catch {
        // Atlas Vector Search may not be configured — fall back
        chunks = await fallbackVectorSearch(query, userId, { topK: 5 });
    }

    // ── Step 2: Evaluate sufficiency ──────────────────────────
    if (chunks.length === 0) {
        return {
            answer:
                "I couldn't find any relevant information in your documents. Please make sure you've uploaded documents related to your question.",
            sources: [],
        };
    }

    // If top score is very low, try refining the query (agentic behaviour)
    const topScore = chunks[0]?.score ?? 0;
    if (topScore < 0.5 && chunks.length > 0) {
        const refinedQuery = await refineQuery(model, query, chunks);
        if (refinedQuery && refinedQuery !== query) {
            try {
                chunks = await vectorSearch(refinedQuery, userId, { topK: 5 });
            } catch {
                chunks = await fallbackVectorSearch(refinedQuery, userId, { topK: 5 });
            }
        }
    }

    // ── Step 3: Generate answer ───────────────────────────────
    const messages = buildPrompt(chunks, query);

    // Resolve document filenames for the sources
    const docIds = [...new Set(chunks.map((c) => c.documentId?.toString()))];
    const docs = await Document.find({ _id: { $in: docIds } }).lean();
    const docMap = Object.fromEntries(docs.map((d) => [d._id.toString(), d.originalName]));

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
        const responseStream = await model.stream(messages);
        return { stream: responseStream, sources };
    }

    const response = await model.invoke(messages);
    return { answer: response.content, sources };
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
