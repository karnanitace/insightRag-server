import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';

let embeddingsClient = null;

/**
 * Lazily initialise the embeddings client so the API key is read
 * after dotenv has loaded.
 */
function getClient() {
    if (!embeddingsClient) {
        embeddingsClient = new GoogleGenerativeAIEmbeddings({
            apiKey: process.env.GOOGLE_GENAI_API_KEY,
            model: process.env.EMBEDDING_MODEL || 'gemini-embedding-001',
        });
    }
    return embeddingsClient;
}

/**
 * Generate an embedding vector for a single piece of text.
 * @param {string} text
 * @returns {Promise<number[]>} embedding vector
 */
export async function embedText(text) {
    const client = getClient();
    return client.embedQuery(text);
}

/**
 * Generate embeddings for an array of texts in a single batch call.
 * @param {string[]} texts
 * @returns {Promise<number[][]>} array of embedding vectors
 */
export async function embedTexts(texts) {
    const client = getClient();
    return client.embedDocuments(texts);
}
