import { Resend } from 'resend';

let resend = null;

/**
 * Lazily create the Resend client. Returns null when RESEND_API_KEY is not set,
 * in which case emails are logged to the console (useful for local development).
 */
const getClient = () => {
    if (!process.env.RESEND_API_KEY) return null;
    if (!resend) resend = new Resend(process.env.RESEND_API_KEY);
    return resend;
};

/**
 * Send an email via Resend (or log it to the console if Resend is not configured).
 */
export const sendEmail = async ({ to, subject, text, html }) => {
    const client = getClient();

    if (!client) {
        console.log(`📧 [dev] Email to ${to}\nSubject: ${subject}\n${text}`);
        return;
    }

    // Resend returns errors instead of throwing
    const { error } = await client.emails.send({
        from: process.env.EMAIL_FROM || 'InsightRAG <onboarding@resend.dev>',
        to,
        subject,
        text,
        html,
    });

    if (error) throw new Error(`Resend: ${error.message}`);
};
