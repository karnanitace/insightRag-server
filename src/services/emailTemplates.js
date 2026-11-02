/**
 * Minimal, email-client-safe HTML templates (table layout + inline styles).
 */

const escapeHtml = (str = '') =>
    String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * Shared layout: centered card with brand header and footer.
 */
const layout = ({ preheader, body }) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>InsightRAG</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f7;padding:40px 16px;">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
        <tr>
          <td align="center" style="padding-bottom:24px;">
            <table role="presentation" cellpadding="0" cellspacing="0">
              <tr>
                <td style="width:36px;height:36px;background-color:#4f46e5;border-radius:10px;text-align:center;vertical-align:middle;color:#ffffff;font-size:18px;font-weight:700;">I</td>
                <td style="padding-left:10px;font-size:18px;font-weight:700;color:#18181b;letter-spacing:-0.2px;">InsightRAG</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="background-color:#ffffff;border-radius:16px;padding:40px 36px;border:1px solid #e4e4e7;">
            ${body}
          </td>
        </tr>
        <tr>
          <td align="center" style="padding-top:24px;font-size:12px;line-height:18px;color:#a1a1aa;">
            &copy; ${new Date().getFullYear()} InsightRAG &middot; You're receiving this because of activity on your account.
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

/**
 * Password reset email.
 */
export const passwordResetEmail = ({ name, resetUrl, expiresInMinutes = 15 }) => {
    const safeName = escapeHtml(name);
    const safeUrl = escapeHtml(resetUrl);

    const html = layout({
        preheader: `Reset your InsightRAG password. This link expires in ${expiresInMinutes} minutes.`,
        body: `
            <h1 style="margin:0 0 12px;font-size:22px;line-height:30px;font-weight:700;color:#18181b;">Reset your password</h1>
            <p style="margin:0 0 24px;font-size:15px;line-height:24px;color:#52525b;">
                Hi ${safeName}, we received a request to reset the password for your account. Click the button below to choose a new one.
            </p>
            <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
              <tr>
                <td style="border-radius:10px;background-color:#4f46e5;">
                  <a href="${safeUrl}" target="_blank" style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">Reset password</a>
                </td>
              </tr>
            </table>
            <p style="margin:0 0 24px;font-size:13px;line-height:20px;color:#71717a;">
                This link expires in <strong style="color:#3f3f46;">${expiresInMinutes} minutes</strong>. If you didn't request a reset, you can safely ignore this email — your password won't change.
            </p>
            <hr style="border:none;border-top:1px solid #e4e4e7;margin:0 0 20px;">
            <p style="margin:0;font-size:12px;line-height:18px;color:#a1a1aa;">
                Button not working? Paste this link into your browser:<br>
                <a href="${safeUrl}" target="_blank" style="color:#4f46e5;word-break:break-all;">${safeUrl}</a>
            </p>`,
    });

    const text = `Hi ${name},

We received a request to reset your InsightRAG password. Open this link to choose a new one (expires in ${expiresInMinutes} minutes):

${resetUrl}

If you didn't request this, you can ignore this email.`;

    return { subject: 'Reset your InsightRAG password', html, text };
};
