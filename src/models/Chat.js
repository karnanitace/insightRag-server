import mongoose from 'mongoose';

/**
 * A chat is an "agent" scoped to a set of documents.
 *
 * - scope 'all'       → searches every document the user owns (one per user)
 * - scope 'documents' → searches only `documentIds` (one chat per unique document set)
 *
 * `docKey` enforces the one-chat-per-set rule: 'all' or the sorted document IDs joined by ','.
 * Archived chats (all documents deleted, or set now duplicates another chat) have no docKey
 * and are read-only until their documents are edited.
 */
const chatSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        title: { type: String, trim: true, maxlength: 120 },
        scope: { type: String, enum: ['all', 'documents'], required: true },
        documentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Document' }],
        docKey: { type: String },
        archived: { type: Boolean, default: false },
        archivedReason: { type: String },
        lastMessageAt: { type: Date },
    },
    { timestamps: true },
);

chatSchema.index(
    { userId: 1, docKey: 1 },
    { unique: true, partialFilterExpression: { docKey: { $type: 'string' } } },
);
chatSchema.index({ userId: 1, documentIds: 1 });

export default mongoose.model('Chat', chatSchema);
