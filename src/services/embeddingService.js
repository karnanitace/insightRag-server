import { OpenAIEmbeddings } from '@langchain/openai';

let embeddingsClient = null;

/**
 * Lazily initialise the embeddings client so the API key is read
 * after dotenv has loaded.
 */
function getClient() {
    if (!embeddingsClient) {
        embeddingsClient = new OpenAIEmbeddings({
            openAIApiKey: process.env.OPENAI_API_KEY,
            modelName: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
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
