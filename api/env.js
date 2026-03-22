// api/env.js — Vercel Serverless Function
// Serve environment variables ke browser secara aman
// URL: /api/env → return JavaScript yang bisa di-load sebagai script

export default function handler(req, res) {
  // Set cache headers — jangan cache terlalu lama
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'public, max-age=3600');

  const config = {
    SUPABASE_URL:        process.env.SUPABASE_URL        || '',
    SUPABASE_ANON_KEY:   process.env.SUPABASE_ANON_KEY   || '',
    ANTHROPIC_KEY:       process.env.ANTHROPIC_KEY        || '',
    MIDTRANS_CLIENT_KEY: process.env.MIDTRANS_CLIENT_KEY  || '',
    OWNER_WA:            process.env.OWNER_WA             || '6281234567890',
    OWNER_BANK:          process.env.OWNER_BANK           || 'BCA 1234567890',
  };

  res.status(200).send(`
window.ENV_SUPABASE_URL          = "REPLACE_SUPABASE_URL";
window.ENV_SUPABASE_KEY          = "REPLACE_SUPABASE_ANON_KEY";
window.ENV_ANTHROPIC_KEY         = "REPLACE_ANTHROPIC_KEY";
window.ENV_DUITKU_MERCHANT_KEY   = "REPLACE_DUITKU_MERCHANT_KEY";
window.ENV_DUITKU_MERCHANT_CODE  = "REPLACE_DUITKU_MERCHANT_CODE";
window.ENV_OWNER_WA              = "REPLACE_OWNER_WA";
window.ENV_OWNER_BANK            = "REPLACE_OWNER_BANK";

window.ENV_OWNER_WA            = ${JSON.stringify(config.OWNER_WA)};
window.ENV_OWNER_BANK          = ${JSON.stringify(config.OWNER_BANK)};
  `.trim());
}
