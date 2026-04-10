// api/chat.js — Vercel Serverless Function
import { createClient } from '@supabase/supabase-js';

const DAILY_LIMIT = 20;
const MAX_HISTORY = 6;
const MAX_TOKENS  = 600;
const MODEL       = 'claude-haiku-4-5-20251001';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey  = process.env.ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY || '';
  const supaUrl = process.env.SUPABASE_URL || '';
  const supaKey = process.env.SUPABASE_ANON_KEY || '';

  if (!apiKey) return res.status(500).json({ error: 'API key tidak dikonfigurasi' });

  try {
    // 1. Ambil data request dulu
    const { messages = [], child } = req.body || {};
    const trimmed = (messages || []).slice(-MAX_HISTORY).map(m => ({
      role:    m.role === 'user' ? 'user' : 'assistant',
      content: typeof m.content === 'string' ? m.content : String(m.content || '')
    })).filter(m => m.content);

    if (trimmed.length === 0) return res.status(400).json({ error: 'Pesan kosong' });

    // 2. Cek auth & premium jika ada token
    const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
    let userId    = null;
    let usageCount = 0;

    if (token && supaUrl && supaKey) {
      const supa = createClient(supaUrl, supaKey, {
        global: { headers: { Authorization: `Bearer ${token}` } }
      });

      const { data: { user } } = await supa.auth.getUser().catch(() => ({ data: {} }));
      if (!user?.id) return res.status(401).json({ error: 'Session tidak valid' });
      userId = user.id;

      // Cek premium
      const [{ data: sub }, { data: prof }] = await Promise.all([
        supa.from('subscriptions').select('status').eq('user_id', userId)
          .order('created_at', { ascending: false }).limit(1).maybeSingle(),
        supa.from('profiles').select('subscription_status').eq('id', userId).maybeSingle(),
      ]);

      const isPremium = sub?.status === 'active' || prof?.subscription_status === 'active';
      if (!isPremium) return res.status(403).json({ error: 'Fitur ini hanya untuk pengguna Premium 🌱' });

      // Cek kuota harian
      try {
        const today = new Date().toISOString().slice(0, 10);
        const { count } = await supa.from('activity_log')
          .select('*', { count: 'exact', head: true })
          .eq('parent_id', userId)
          .eq('dot', 'ai_chat')
          .gte('created_at', today + 'T00:00:00Z');
        usageCount = count || 0;
        if (usageCount >= DAILY_LIMIT) {
          return res.status(429).json({ error: `Batas ${DAILY_LIMIT} pesan/hari tercapai. Coba lagi besok! 🌱` });
        }
      } catch(e) { /* non-fatal */ }
    }

    // 3. System prompt
    const g      = child?.grade ?? 0;
    const jenjang = g >= 9 ? 'SMP' : g >= 3 ? `SD kelas ${g - 2}` : 'TK/Prasekolah';
    const system  = child
      ? `Kamu konsultan parenting ParentingAI Indonesia. Anak: ${child.name}, ${jenjang}, usia ${child.age || g + 4} tahun. Jawab Bahasa Indonesia, hangat & praktis, maks 3 paragraf. Akhiri dengan 1 saran aktivitas konkret.`
      : `Kamu konsultan parenting ParentingAI Indonesia. Jawab singkat, hangat, praktis, Bahasa Indonesia.`;

    // 4. Panggil Anthropic
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, system, messages: trimmed }),
    });

    const aiText = await aiRes.text();
    let aiData;
    try { aiData = JSON.parse(aiText); }
    catch(e) {
      console.error('Anthropic non-JSON:', aiText.slice(0, 300));
      return res.status(500).json({ error: 'Gagal menghubungi AI. Coba lagi.' });
    }

    if (!aiRes.ok) {
      console.error('Anthropic error:', aiData);
      return res.status(aiRes.status).json({ error: aiData?.error?.message || 'Error dari AI' });
    }

    // 5. Log (non-fatal)
    if (userId && supaUrl && supaKey) {
      try {
        const supaLog = createClient(supaUrl, supaKey, {
          global: { headers: { Authorization: `Bearer ${token}` } }
        });
        await supaLog.from('activity_log').insert({
          parent_id: userId,
          child_id:  child?.id || null,
          dot:       'ai_chat',
          icon:      '✨',
          text:      'AI Chat',
          note:      `${aiData.usage?.input_tokens || 0}in+${aiData.usage?.output_tokens || 0}out`,
        });
      } catch(e) { /* non-fatal */ }
    }

    const content   = aiData.content?.[0]?.text || 'Maaf, ada gangguan.';
    const remaining = Math.max(0, DAILY_LIMIT - usageCount - 1);
    return res.status(200).json({ content, remaining });

  } catch (err) {
    console.error('chat.js fatal:', err.message, err.stack);
    return res.status(500).json({ error: 'Terjadi kesalahan. Coba lagi.' });
  }
}
