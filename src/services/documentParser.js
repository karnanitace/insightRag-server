import fs from 'fs/promises';
import path from 'path';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';

/**
 * Extract plain text from a document file.
 * Supports: PDF, DOCX, TXT, Markdown.
 */
export async function parseDocument(filePath, mimeType) {
    const ext = path.extname(filePath).toLowerCase();

    switch (mimeType) {
        case 'application/pdf':
            return parsePDF(filePath);
        case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
            return parseDOCX(filePath);
        case 'text/plain':
        case 'text/markdown':
            return parseTextFile(filePath);
        default:
            throw new Error(`Unsupported file type: ${mimeType}`);
    }
}

async function parsePDF(filePath) {
    const buffer = await fs.readFile(filePath);
    const data = await pdfParse(buffer);
    return data.text;
}

async function parseDOCX(filePath) {
    const buffer = await fs.readFile(filePath);
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
}

async function parseTextFile(filePath) {
    return fs.readFile(filePath, 'utf-8');
}
