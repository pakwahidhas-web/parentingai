// api/chat.js — Vercel Serverless Function
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
    // 1. Verifikasi user & cek premium
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (!supaUrl || !supaKey || !token) return res.status(401).json({ error: 'Unauthorized' });

    const { createClient } = await import('@supabase/supabase-js');
    const supa = createClient(supaUrl, supaKey, {
      global: { headers: { Authorization: `Bearer ${token}` } }
    });

    const { data: { user }, error: authErr } = await supa.auth.getUser();
    if (authErr || !user) return res.status(401).json({ error: 'Session tidak valid' });

    // Cek premium
    const [{ data: sub }, { data: prof }] = await Promise.all([
      supa.from('subscriptions').select('status').eq('user_id', user.id)
        .order('created_at', { ascending: false }).limit(1).maybeSingle(),
      supa.from('profiles').select('subscription_status').eq('id', user.id).maybeSingle(),
    ]);
    const isPremium = sub?.status === 'active' || prof?.subscription_status === 'active';
    if (!isPremium) return res.status(403).json({ error: 'Fitur ini hanya untuk pengguna Premium 🌱' });

    // 2. Cek batas harian — pakai activity_log dengan kolom yang benar
    // activity_log punya: child_id, parent_id, text, dot, icon, note, created_at
    const today = new Date().toISOString().slice(0, 10);
    let usageCount = 0;
    try {
      const { count } = await supa.from('activity_log')
        .select('*', { count: 'exact', head: true })
        .eq('parent_id', user.id)
        .eq('dot', 'ai_chat')
        .gte('created_at', today + 'T00:00:00Z');
      usageCount = count || 0;
    } catch(e) {
      console.warn('Quota check failed (non-fatal):', e.message);
    }

    if (usageCount >= DAILY_LIMIT) {
      return res.status(429).json({
        error: `Batas ${DAILY_LIMIT} pesan/hari tercapai. Coba lagi besok! 🌱`
      });
    }

    // 3. Ambil data & potong history
    const { messages = [], child } = req.body;
    const trimmed = messages.slice(-MAX_HISTORY).map(m => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
    }));
    if (trimmed.length === 0) return res.status(400).json({ error: 'Pesan kosong' });

    // 4. System prompt ringkas
    const gradeNum = child?.grade ?? 0;
    const jenjang  = gradeNum >= 9 ? 'SMP' : gradeNum >= 3 ? `SD kelas ${gradeNum - 2}` : 'TK/Prasekolah';
    const system   = child
      ? `Kamu adalah konsultan parenting ParentingAI Indonesia.
Anak: ${child.name}, ${jenjang}, usia ${child.age || (gradeNum + 4)} tahun.
Jawab Bahasa Indonesia, hangat & praktis, maks 3 paragraf singkat.
Akhiri dengan 1 saran aktivitas konkret.`
      : 'Kamu konsultan parenting ParentingAI Indonesia. Jawab singkat, hangat, praktis, Bahasa Indonesia.';

    // 5. Panggil Anthropic
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, system, messages: trimmed }),
    });

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      const text = await response.text();
      console.error('Non-JSON from Anthropic:', text.slice(0, 200));
      return res.status(500).json({ error: 'Gagal menghubungi AI. Coba lagi.' });
    }

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.error?.message || 'Error dari AI' });

    // 6. Log ke activity_log — pakai kolom yang tersedia
    try {
      await supa.from('activity_log').insert({
        parent_id: user.id,
        child_id:  child?.id || null,
        dot:       'ai_chat',
        icon:      '✨',
        text:      'AI Chat',
        note:      `${data.usage?.input_tokens || 0}in+${data.usage?.output_tokens || 0}out`,
      });
    } catch(e) {
      console.warn('Log insert failed (non-fatal):', e.message);
    }

    const content   = data.content?.[0]?.text || 'Maaf, terjadi kesalahan.';
    const remaining = Math.max(0, DAILY_LIMIT - usageCount - 1);
    return res.status(200).json({ content, remaining });

  } catch (error) {
    console.error('Chat error:', error.message);
    return res.status(500).json({ error: 'Terjadi kesalahan server. Coba lagi.' });
  }
}
