import mongoose from 'mongoose';

const chatHistorySchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        // Not required so legacy entries (pre-chats) can be migrated lazily into the "All documents" chat
        chatId: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat' },
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

chatHistorySchema.index({ chatId: 1, createdAt: -1 });

export default mongoose.model('ChatHistory', chatHistorySchema);
