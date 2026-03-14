import mongoose from 'mongoose';

const documentSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        filename: { type: String, required: true },
        originalName: { type: String, required: true },
        mimeType: { type: String, required: true },
        size: { type: Number, required: true },
        status: {
            type: String,
            enum: ['uploading', 'processing', 'indexed', 'failed'],
            default: 'uploading',
        },
        chunkCount: { type: Number, default: 0 },
        uploadDate: { type: Date, default: Date.now },
    },
    { timestamps: true },
);

export default mongoose.model('Document', documentSchema);
