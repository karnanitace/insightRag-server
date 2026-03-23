import mongoose from 'mongoose';

const chunkSchema = new mongoose.Schema(
    {
        documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', required: true, index: true },
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        text: { type: String, required: true },
        embedding: { type: [Number], required: true },
        chunkIndex: { type: Number, required: true },
    },
    { timestamps: true },
);

/**
 * MongoDB Atlas Vector Search index must be created on the `embedding` field.
 * Index name: "vector_index"
 * Dimensions: 768 (gemini text-embedding-004)
 * Similarity: cosine
 *
 * Atlas JSON definition:
 * {
 *   "fields": [
 *     { "type": "vector", "path": "embedding", "numDimensions": 768, "similarity": "cosine" },
 *     { "type": "filter",  "path": "userId" }
 *   ]
 * }
 */

export default mongoose.model('Chunk', chunkSchema);
