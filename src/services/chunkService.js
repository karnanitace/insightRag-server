import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';

/**
 * Split text into overlapping chunks for embedding.
 *
 * @param {string} text – raw text extracted from a document
 * @param {object} options
 * @param {number} options.chunkSize – target characters per chunk (default 1000)
 * @param {number} options.chunkOverlap – overlap between chunks (default 200)
 * @returns {Promise<string[]>} array of text chunks
 */
export async function chunkText(text, { chunkSize = 1000, chunkOverlap = 200 } = {}) {
    const splitter = new RecursiveCharacterTextSplitter({
        chunkSize,
        chunkOverlap,
        separators: ['\n\n', '\n', '. ', ' ', ''],
    });

    const docs = await splitter.createDocuments([text]);
    return docs.map((doc) => doc.pageContent);
}
