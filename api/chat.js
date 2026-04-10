// api/chat.js — Vercel Serverless Function
// Menggunakan OpenAI GPT-4o mini — tanpa dependency eksternal

const DAILY_LIMIT = 20;
const MAX_HISTORY = 6;
const MAX_TOKENS  = 600;
const MODEL       = 'gpt-4o-mini';

async function supaGetUser(supaUrl, supaKey, token) {
  const res = await fetch(`${supaUrl}/auth/v1/user`, {
    headers: { 'apikey': supaKey, 'Authorization': `Bearer ${token}` }
  });
  const data = await res.json();
  return res.ok ? data : null;
}

async function supaGet(supaUrl, supaKey, token, path) {
  const res = await fetch(`${supaUrl}/rest/v1${path}`, {
    headers: { 'apikey': supaKey, 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
  });
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const openaiKey = process.env.OPENAI_API_KEY || '';
  const supaUrl   = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const supaKey   = process.env.SUPABASE_ANON_KEY || '';

  if (!openaiKey) return res.status(500).json({ error: 'OpenAI API key tidak dikonfigurasi' });

  try {
    const { messages = [], child } = req.body || {};
    const trimmed = (messages || []).slice(-MAX_HISTORY)
      .map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: String(m.content || '') }))
      .filter(m => m.content);

    if (!trimmed.length) return res.status(400).json({ error: 'Pesan kosong' });

    // Auth & premium check
    const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
    let userId = null, usageCount = 0;

    if (token && supaUrl && supaKey) {
      const user = await supaGetUser(supaUrl, supaKey, token);
      if (!user?.id) return res.status(401).json({ error: 'Session tidak valid' });
      userId = user.id;

      // Cek premium
      const [subs, prof] = await Promise.all([
        supaGet(supaUrl, supaKey, token, `/subscriptions?user_id=eq.${userId}&status=eq.active&limit=1`),
        supaGet(supaUrl, supaKey, token, `/profiles?id=eq.${userId}&select=subscription_status`),
      ]);
      const isPremium = (Array.isArray(subs) && subs.length > 0) ||
        (Array.isArray(prof) && prof[0]?.subscription_status === 'active');
      if (!isPremium) return res.status(403).json({ error: 'Fitur ini hanya untuk pengguna Premium 🌱' });

      // Cek kuota harian
      try {
        const today = new Date().toISOString().slice(0, 10);
        const countRes = await fetch(
          `${supaUrl}/rest/v1/activity_log?parent_id=eq.${userId}&dot=eq.ai_chat&created_at=gte.${today}T00:00:00Z`,
          { headers: { 'apikey': supaKey, 'Authorization': `Bearer ${token}`, 'Prefer': 'count=exact', 'Range-Unit': 'items', 'Range': '0-0' } }
        );
        const range = countRes.headers.get('content-range') || '0/0';
        usageCount = parseInt(range.split('/')[1] || '0');
        if (usageCount >= DAILY_LIMIT) {
          return res.status(429).json({ error: `Batas ${DAILY_LIMIT} pesan/hari tercapai. Coba lagi besok! 🌱` });
        }
      } catch(e) { /* non-fatal */ }
    }

    // System prompt
    const g = child?.grade ?? 0;
    const jenjang = g >= 9 ? 'SMP' : g >= 3 ? `SD kelas ${g - 2}` : 'TK/Prasekolah';
    const systemPrompt = child
      ? `Kamu adalah konsultan parenting ParentingAI Indonesia. Anak: ${child.name}, ${jenjang}, usia ${child.age || g + 4} tahun. Jawab Bahasa Indonesia, hangat & praktis, maksimal 3 paragraf singkat. Akhiri dengan 1 saran aktivitas konkret.`
      : `Kamu adalah konsultan parenting ParentingAI Indonesia. Jawab singkat, hangat, praktis dalam Bahasa Indonesia.`;

    // Panggil OpenAI
    const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        messages: [{ role: 'system', content: systemPrompt }, ...trimmed],
      }),
    });

    const aiText = await aiRes.text();
    let aiData;
    try { aiData = JSON.parse(aiText); }
    catch(e) { return res.status(500).json({ error: 'Gagal menghubungi AI. Coba lagi.' }); }

    if (!aiRes.ok) {
      console.error('OpenAI error:', aiData);
      return res.status(aiRes.status).json({ error: aiData?.error?.message || 'Error dari AI' });
    }

    // Log (non-fatal)
    if (userId) {
      fetch(`${supaUrl}/rest/v1/activity_log`, {
        method: 'POST',
        headers: { 'apikey': supaKey, 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parent_id: userId, child_id: child?.id || null,
          dot: 'ai_chat', icon: '✨', text: 'AI Chat',
          note: `${aiData.usage?.prompt_tokens || 0}in+${aiData.usage?.completion_tokens || 0}out`,
        }),
      }).catch(() => {});
    }

    const content   = aiData.choices?.[0]?.message?.content || 'Maaf, ada gangguan.';
    const remaining = Math.max(0, DAILY_LIMIT - usageCount - 1);
    return res.status(200).json({ content, remaining });

  } catch (err) {
    console.error('chat.js error:', err.message);
    return res.status(500).json({ error: 'Terjadi kesalahan. Coba lagi.' });
  }
}
