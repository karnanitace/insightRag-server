import mongoose from 'mongoose';

const chatHistorySchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        userQuery: { type: String, required: true },
        response: { type: String, required: true },
        sources: [
            {
                documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Document' },
                filename: String,
                chunkText: String,
                score: Number,
            },
        ],
    },
    { timestamps: true },
);

export default mongoose.model('ChatHistory', chatHistorySchema);
