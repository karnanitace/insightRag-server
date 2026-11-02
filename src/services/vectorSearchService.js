import mongoose from 'mongoose';
import Chunk from '../models/Chunk.js';
import { embedText } from './embeddingService.js';

const PER_DOCUMENT_K = 3;
const MAX_GROUP_RESULTS = 10;

let warnedFallback = false;

/**
 * Atlas Vector Search over chunks matching `filter`.
 * Requires a vector search index named "vector_index" with `userId` and `documentId` filter fields.
 */
async function atlasSearch(queryEmbedding, filter, limit) {
    return Chunk.aggregate([
        {
            $vectorSearch: {
                index: 'vector_index',
                path: 'embedding',
                queryVector: queryEmbedding,
                numCandidates: limit * 10,
                limit,
                filter,
            },
        },
        {
            $project: {
                _id: 1,
                text: 1,
                documentId: 1,
                chunkIndex: 1,
                score: { $meta: 'vectorSearchScore' },
            },
        },
    ]);
}

/**
 * Fallback in-memory cosine-similarity search when Atlas Vector Search is unavailable.
 * Loads matching chunks into memory — only suitable for small datasets.
 */
async function memorySearch(queryEmbedding, filter, limit) {
    const chunks = await Chunk.find(filter).lean();
    if (chunks.length === 0) return [];

    const normB = Math.sqrt(queryEmbedding.reduce((sum, val) => sum + val * val, 0));
    const scored = chunks.map((chunk) => {
        const dot = chunk.embedding.reduce((sum, val, i) => sum + val * queryEmbedding[i], 0);
        const normA = Math.sqrt(chunk.embedding.reduce((sum, val) => sum + val * val, 0));
        const score = (normA === 0 || normB === 0) ? 0 : dot / (normA * normB);
        return { ...chunk, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map(({ text, score, documentId, chunkIndex }) => ({
        text,
        score,
        documentId,
        chunkIndex,
    }));
}

async function runSearch(queryEmbedding, filter, limit) {
    try {
        return await atlasSearch(queryEmbedding, filter, limit);
    } catch (error) {
        if (!warnedFallback) {
            console.warn(`⚠️  Atlas Vector Search failed (${error.message}). Using slow in-memory fallback — check the "vector_index" definition.`);
            warnedFallback = true;
        }
        return memorySearch(queryEmbedding, filter, limit);
    }
}

/**
 * Merge per-document results: every document's best chunk first (so no document is
 * crowded out), then fill the remaining slots by score.
 */
function balanceResults(resultsPerDocument, maxResults) {
    const best = resultsPerDocument.filter((r) => r.length > 0).map((r) => r[0]);
    const rest = resultsPerDocument.flatMap((r) => r.slice(1));

    best.sort((a, b) => b.score - a.score);
    rest.sort((a, b) => b.score - a.score);

    return [...best, ...rest].slice(0, Math.max(maxResults, best.length)).sort((a, b) => b.score - a.score);
}

/**
 * Vector similarity search over the user's document chunks.
 *
 * @param {string} query – natural-language query
 * @param {string} userId – restrict results to this user
 * @param {object} options
 * @param {Array<string>|null} options.documentIds – restrict to these documents (null = all of the user's documents)
 * @param {number} options.topK – results for an unscoped / single-document search (default 5)
 * @returns {Promise<Array<{text: string, score: number, documentId: string, chunkIndex: number}>>}
 */
export async function searchChunks(query, userId, { documentIds = null, topK = 5 } = {}) {
    const queryEmbedding = await embedText(query);
    const baseFilter = { userId: new mongoose.Types.ObjectId(userId) };

    if (!documentIds) {
        return runSearch(queryEmbedding, baseFilter, topK);
    }
    if (documentIds.length === 0) return [];

    const ids = documentIds.map((id) => new mongoose.Types.ObjectId(id));
    if (ids.length === 1) {
        return runSearch(queryEmbedding, { ...baseFilter, documentId: ids[0] }, topK);
    }

    // Document groups: search each document separately so one large document can't take every slot
    const resultsPerDocument = await Promise.all(
        ids.map((id) => runSearch(queryEmbedding, { ...baseFilter, documentId: id }, PER_DOCUMENT_K)),
    );
    return balanceResults(resultsPerDocument, MAX_GROUP_RESULTS);
}
