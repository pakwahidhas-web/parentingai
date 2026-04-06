// api/env.js — Vercel Serverless Function
// Serve environment variables ke browser secara aman
export default function handler(req, res) {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'public, max-age=3600');

  res.status(200).send(`
window.ENV_SUPABASE_URL          = ${JSON.stringify(process.env.SUPABASE_URL        || '')};
window.ENV_SUPABASE_KEY          = ${JSON.stringify(process.env.SUPABASE_ANON_KEY   || '')};
window.ENV_ANTHROPIC_KEY         = ${JSON.stringify(process.env.ANTHROPIC_KEY       || '')};
window.ENV_OWNER_WA              = ${JSON.stringify(process.env.OWNER_WA            || '6285789102020')};
window.ENV_OWNER_BANK            = ${JSON.stringify(process.env.OWNER_BANK          || 'MANDIRI 1670005262216')};
  `.trim());
}
