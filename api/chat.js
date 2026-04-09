// api/chat.js — Vercel Serverless Function
// Dengan kontrol biaya: model hemat, batasi history, batasi pesan/hari

import { createClient } from '@supabase/supabase-js';

const DAILY_LIMIT = 20;                          // maks pesan per user per hari
const MAX_HISTORY = 6;                           // maks history dikirim ke AI
const MAX_TOKENS  = 600;                         // maks token output
const MODEL       = 'claude-haiku-4-5-20251001'; // ~20x lebih hemat dari Sonnet

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey   = process.env.ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY || '';
  const supaUrl  = process.env.SUPABASE_URL || '';
  const supaKey  = process.env.SUPABASE_ANON_KEY || '';

  if (!apiKey) return res.status(500).json({ error: 'API key tidak dikonfigurasi' });

  try {
    // 1. Verifikasi user login
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (!supaUrl || !supaKey || !token) return res.status(401).json({ error: 'Unauthorized' });

    const supa = createClient(supaUrl, supaKey, {
      global: { headers: { Authorization: `Bearer ${token}` } }
    });

    const { data: { user }, error: authErr } = await supa.auth.getUser();
    if (authErr || !user) return res.status(401).json({ error: 'Session tidak valid' });

    // 2. Cek premium dari subscriptions atau profiles
    const [{ data: sub }, { data: prof }] = await Promise.all([
      supa.from('subscriptions').select('status').eq('user_id', user.id)
        .order('created_at', { ascending: false }).limit(1).single(),
      supa.from('profiles').select('subscription_status').eq('id', user.id).single(),
    ]);

    const isPremium = sub?.status === 'active' || prof?.subscription_status === 'active';
    if (!isPremium) return res.status(403).json({ error: 'Fitur premium' });

    // 3. Cek batas harian
    const today = new Date().toISOString().slice(0, 10);
    const { count } = await supa.from('activity_log')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id).eq('type', 'ai_chat')
      .gte('created_at', today + 'T00:00:00Z');

    if ((count || 0) >= DAILY_LIMIT) {
      return res.status(429).json({
        error: `Batas ${DAILY_LIMIT} pesan/hari tercapai. Coba lagi besok! 🌱`
      });
    }

    // 4. Ambil data & potong history
    const { messages = [], child } = req.body;
    const trimmed = messages.slice(-MAX_HISTORY);

    // 5. System prompt ringkas
    const jenjang = child
      ? (child.grade >= 9 ? 'SMP' : child.grade >= 3 ? 'SD kelas ' + (child.grade - 2) : 'TK/Prasekolah')
      : '';
    const system = child
      ? `Kamu adalah konsultan parenting ParentingAI Indonesia.
Anak: ${child.name}, ${jenjang}, usia ${child.age || (child.grade + 4)} tahun.
Jawab Bahasa Indonesia, hangat & praktis, maks 3 paragraf.
Akhiri dengan 1 saran aktivitas konkret untuk orang tua.`
      : 'Kamu konsultan parenting ParentingAI Indonesia. Jawab singkat, hangat, praktis, Bahasa Indonesia.';

    // 6. Panggil Anthropic
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, system, messages: trimmed }),
    });

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json(data);

    // 7. Log ke activity_log (fire and forget)
    supa.from('activity_log').insert({
      user_id:  user.id,
      child_id: child?.id || null,
      type:     'ai_chat',
      note:     `${data.usage?.input_tokens || 0}in+${data.usage?.output_tokens || 0}out`,
    }).then(() => {});

    const content   = data.content?.[0]?.text || 'Maaf, terjadi kesalahan.';
    const remaining = DAILY_LIMIT - (count || 0) - 1;

    return res.status(200).json({ content, remaining });

  } catch (error) {
    console.error('Chat error:', error.message);
    return res.status(500).json({ error: error.message });
  }
}
