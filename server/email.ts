/**
 * Transactional email (PIN recovery). Sends through Resend's HTTPS API when
 * RESEND_API_KEY and EMAIL_FROM are set. Locally and in tests nothing leaves
 * the machine: messages go to an in-memory outbox instead.
 *
 * Never log recipients, links or message bodies: they carry personal data
 * and single-use secrets.
 */
import { isDeployed, SetupError } from './env.js';

export type Email = { to: string; subject: string; html: string; text: string };

/** Local/test outbox. Empty and unused on a real deployment. */
export const outbox: Email[] = [];

export function emailConfigured() {
  return !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export async function sendEmail(msg: Email) {
  if (!emailConfigured()) {
    if (isDeployed()) {
      throw new SetupError('Email is not set up. In Vercel, add RESEND_API_KEY and EMAIL_FROM under Settings → Environment Variables, then redeploy.');
    }
    outbox.push(msg);
    // Opt-in for local testing only (never on a deployment): print the message so its link can be followed.
    if (process.env.DEV_EMAIL_LOG === '1') console.info(`[dev email to ${msg.to}] ${msg.subject}\n${msg.text}`);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text }),
  });
  if (!res.ok) {
    // Status only: the provider's body may echo the recipient.
    throw new Error(`Email provider rejected the message (HTTP ${res.status})`);
  }
}

/**
 * The public address used in emailed links. Taken from configuration, never
 * from the request's Host header, so a forged Host can't redirect a reset link.
 */
export function appUrl(requestOrigin: string) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, '');
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (isDeployed()) throw new SetupError('APP_URL is not set. Add it in Vercel (e.g. https://bloesel2.vercel.app), then redeploy.');
  return requestOrigin;
}

const esc = (v: string) => v.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

export function emailChangedNotice(to: string, firstName: string): Email {
  const name = esc(firstName);
  return {
    to,
    subject: 'The email on your Bloeisel card was changed',
    text: `Hi ${firstName},\n\nThe email address on your Bloeisel loyalty card was just changed, so PIN reset emails will now go to the new address.\n\nIf this wasn't you, ask your barista to help secure your card.\n\nBloeisel Koffie`,
    html: `<!doctype html><html><body style="margin:0;background:#f6f4f3;font-family:Poppins,Segoe UI,Arial,sans-serif;color:#2e1a16">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:20px;padding:32px">
<tr><td style="font-size:26px;font-weight:700;color:#ff66c4;font-style:italic">Bloeisel</td></tr>
<tr><td style="padding-top:20px;font-size:22px;font-weight:700">Your card's email was changed</td></tr>
<tr><td style="padding-top:12px;font-size:15px;line-height:1.6;color:#6e5249">Hi ${name}, the email address on your Bloeisel loyalty card was just changed, so PIN reset emails will now go to the new address.</td></tr>
<tr><td style="padding-top:16px;font-size:15px;line-height:1.6;color:#6e5249">If this wasn't you, ask your barista to help secure your card.</td></tr>
</table></td></tr></table></body></html>`,
  };
}

export function pinResetEmail(to: string, firstName: string, link: string, minutes: number): Email {
  const name = esc(firstName);
  return {
    to,
    subject: 'Reset your Bloeisel card PIN',
    text: `Hi ${firstName},\n\nSomeone asked to reset the PIN for your Bloeisel loyalty card. If it was you, open this link on your phone within ${minutes} minutes to choose a new PIN:\n\n${link}\n\nThe link works once. If you didn't ask for this, ignore this email: your PIN stays the same.\n\nBloeisel Koffie`,
    html: `<!doctype html><html><body style="margin:0;background:#f6f4f3;font-family:Poppins,Segoe UI,Arial,sans-serif;color:#2e1a16">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:20px;padding:32px">
<tr><td style="font-size:26px;font-weight:700;color:#ff66c4;font-style:italic">Bloeisel</td></tr>
<tr><td style="padding-top:20px;font-size:22px;font-weight:700">Reset your PIN</td></tr>
<tr><td style="padding-top:12px;font-size:15px;line-height:1.6;color:#6e5249">Hi ${name}, someone asked to reset the PIN for your Bloeisel loyalty card. If it was you, tap the button within ${minutes} minutes to choose a new PIN.</td></tr>
<tr><td style="padding-top:24px"><a href="${esc(link)}" style="display:inline-block;background:#ff66c4;color:#ffffff;text-decoration:none;font-weight:600;padding:14px 26px;border-radius:999px">Choose a new PIN</a></td></tr>
<tr><td style="padding-top:24px;font-size:13px;line-height:1.6;color:#a58e85">The link works once. If you didn't ask for this, ignore this email: your PIN stays the same.</td></tr>
</table></td></tr></table></body></html>`,
  };
}
