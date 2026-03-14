import mongoose from 'mongoose';
import Chunk from '../models/Chunk.js';
import { embedText } from './embeddingService.js';

/**
 * Perform vector similarity search over the user's document chunks.
 *
 * Uses MongoDB Atlas $vectorSearch aggregation stage.
 * Requires a vector search index named "vector_index" on the chunks collection.
 *
 * @param {string} query – natural-language query
 * @param {string} userId – restrict results to this user
 * @param {object} options
 * @param {number} options.topK – number of results to return (default 5)
 * @returns {Promise<Array<{text: string, score: number, documentId: string, chunkIndex: number}>>}
 */
export async function vectorSearch(query, userId, { topK = 5 } = {}) {
    // 1. Embed the query
    const queryEmbedding = await embedText(query);

    // 2. Run Atlas Vector Search
    const results = await Chunk.aggregate([
        {
            $vectorSearch: {
                index: 'vector_index',
                path: 'embedding',
                queryVector: queryEmbedding,
                numCandidates: topK * 10,
                limit: topK,
                filter: { userId: new mongoose.Types.ObjectId(userId) },
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

    return results;
}

/**
 * Fallback cosine-similarity search when Atlas Vector Search is unavailable.
 * Loads chunks into memory — only suitable for small datasets.
 */
export async function fallbackVectorSearch(query, userId, { topK = 5 } = {}) {
    const queryEmbedding = await embedText(query);
    const userChunks = await Chunk.find({ userId }).lean();

    if (userChunks.length === 0) return [];

    // Compute cosine similarity
    const scored = userChunks.map((chunk) => {
        const dot = chunk.embedding.reduce((sum, val, i) => sum + val * queryEmbedding[i], 0);
        const normA = Math.sqrt(chunk.embedding.reduce((sum, val) => sum + val * val, 0));
        const normB = Math.sqrt(queryEmbedding.reduce((sum, val) => sum + val * val, 0));
        const score = dot / (normA * normB);
        return { ...chunk, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).map(({ text, score, documentId, chunkIndex }) => ({
        text,
        score,
        documentId,
        chunkIndex,
    }));
}
