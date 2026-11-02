/**
 * Shared demo account: lets visitors try InsightRAG without registering.
 * Disable with DEMO_ENABLED=false; change the account with DEMO_EMAIL / DEMO_NAME.
 */
export const demoEnabled = () => process.env.DEMO_ENABLED !== 'false';

export const demoEmail = () => (process.env.DEMO_EMAIL || 'demo@insightrag.app').toLowerCase().trim();

export const demoName = () => process.env.DEMO_NAME || 'Demo User';

export const isDemoUser = (user) => Boolean(user?.email) && user.email.toLowerCase() === demoEmail();
