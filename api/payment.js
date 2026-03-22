import crypto from 'crypto';

export default async function handler(req, res) {

  // Webhook dari Duitku
  if (req.method === 'POST' && req.query.webhook === '1') {
    return handleWebhook(req, res);
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const merchantCode = process.env.DUITKU_MERCHANT_CODE || '';
  const apiKey       = process.env.DUITKU_MERCHANT_KEY  || '';
  const isProd       = process.env.DUITKU_ENV === 'production';

  // URL: sandbox vs production
  const baseUrl = isProd
    ? 'https://api-prod.duitku.com/api/merchant'
    : 'https://api-sandbox.duitku.com/api/merchant';

  if (!merchantCode || !apiKey) {
    return res.status(500).json({ error: 'DUITKU_MERCHANT_CODE atau DUITKU_MERCHANT_KEY belum diset di Vercel' });
  }

  const { orderId, amount, productDetails, email, userId } = req.body || {};

  if (!orderId || !amount || !email) {
    return res.status(400).json({ error: 'Data tidak lengkap: orderId, amount, email wajib ada' });
  }

  try {
    // Signature Duitku: MD5(merchantCode + orderId + amount + apiKey)
    const signature = crypto
      .createHash('md5')
      .update(`${merchantCode}${orderId}${amount}${apiKey}`)
      .digest('hex');

    const appUrl = process.env.APP_URL || 'https://parentingai.vercel.app';

    const payload = {
      merchantCode,
      paymentAmount:    Number(amount),
      merchantOrderId:  orderId,
      productDetails:   productDetails || 'ParentingAI Premium 1 Bulan',
      email,
      additionalParam:  userId || '',
      paymentMethod:    'VC',
      merchantUserInfo: email,
      customerVaName:   (email || '').split('@')[0].substring(0, 20),
      callbackUrl:      `${appUrl}/api/payment?webhook=1`,
      returnUrl:        `${appUrl}/?payment=success&order=${orderId}`,
      expiryPeriod:     1440,
      signature,
    };

    console.log('Duitku request to:', `${baseUrl}/createinvoice`);
    console.log('merchantCode:', merchantCode, '| isProd:', isProd);

    const response = await fetch(`${baseUrl}/createinvoice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    // Baca response sebagai text dulu untuk debug
    const rawText = await response.text();
    console.log('Duitku raw response:', rawText.substring(0, 200));

    let data;
    try {
      data = JSON.parse(rawText);
    } catch(e) {
      return res.status(500).json({ error: 'Duitku response bukan JSON: ' + rawText.substring(0, 100) });
    }

    if (data.statusCode === '00' && data.paymentUrl) {
      return res.status(200).json({
        paymentUrl:      data.paymentUrl,
        reference:       data.reference,
        merchantOrderId: orderId,
      });
    } else {
      return res.status(400).json({
        error: data.statusMessage || 'Gagal membuat invoice',
        statusCode: data.statusCode,
        raw: data
      });
    }

  } catch (error) {
    console.error('Duitku error:', error);
    return res.status(500).json({ error: error.message });
  }
}

async function handleWebhook(req, res) {
  const merchantCode = process.env.DUITKU_MERCHANT_CODE || '';
  const apiKey       = process.env.DUITKU_MERCHANT_KEY  || '';
  const supabaseUrl  = process.env.SUPABASE_URL         || '';
  const supabaseKey  = process.env.SUPABASE_ANON_KEY    || '';

  const { merchantOrderId, amount, additionalParam: userId, resultCode, reference, signature: sig } = req.body || {};

  // Verifikasi signature
  const expected = crypto.createHash('md5')
    .update(`${merchantCode}${amount}${merchantOrderId}${apiKey}`)
    .digest('hex');

  if (sig !== expected) {
    console.error('Webhook invalid signature');
    return res.status(400).send('FAIL');
  }

  const status = resultCode === '00' ? 'success' : resultCode === '01' ? 'pending' : 'failed';

  try {
    // Update payment_log
    await fetch(`${supabaseUrl}/rest/v1/payment_log?order_id=eq.${merchantOrderId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({ status, transaction_id: reference, payload: req.body }),
    });

    // Aktifkan premium jika sukses
    if (status === 'success' && userId) {
      const now    = new Date();
      const expiry = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      await fetch(`${supabaseUrl}/rest/v1/subscriptions?user_id=eq.${userId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({
          status: 'active', plan: 'monthly', price_idr: Number(amount),
          current_period_start: now.toISOString(),
          current_period_end: expiry.toISOString(),
          updated_at: now.toISOString(),
        }),
      });
      console.log('✅ Premium activated for', userId, 'until', expiry);
    }

    return res.status(200).send('SUCCESS');
  } catch (e) {
    console.error('Webhook error:', e);
    return res.status(500).send('FAIL');
  }
}
