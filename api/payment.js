import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method === 'POST' && req.query.webhook === '1') {
    return handleWebhook(req, res);
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const merchantCode = process.env.DUITKU_MERCHANT_CODE || '';
  const apiKey       = process.env.DUITKU_MERCHANT_KEY  || '';

  if (!merchantCode || !apiKey) {
    return res.status(500).json({ error: 'DUITKU_MERCHANT_CODE atau DUITKU_MERCHANT_KEY belum diset' });
  }

  const { orderId, amount, productDetails, email, userId } = req.body || {};
  if (!orderId || !amount || !email) {
    return res.status(400).json({ error: 'orderId, amount, email wajib ada' });
  }

  try {
    const timestamp = Date.now().toString();
    const appUrl    = process.env.APP_URL || 'https://app.parenting-ai.my.id';

    // ✅ Signature BENAR: SHA256(merchantCode + timestamp + apiKey)
    const signature = crypto.createHash('sha256')
      .update(`${merchantCode}${timestamp}${apiKey}`)
      .digest('hex');

    const payload = {
      paymentAmount:    Number(amount),
      merchantOrderId:  orderId,
      productDetails:   productDetails || 'ParentingAI Premium 1 Bulan',
      additionalParam:  userId || '',
      merchantUserInfo: email,
      customerVaName:   (email || '').split('@')[0].substring(0, 20),
      email,
      itemDetails: [{
        name:     'ParentingAI Premium 1 Bulan',
        price:    Number(amount),
        quantity: 1,
      }],
      customerDetail: {
        firstName:   (email || '').split('@')[0],
        lastName:    '',
        email,
        phoneNumber: '08000000000',
      },
      callbackUrl:  `${appUrl}/api/payment?webhook=1`,
      returnUrl:    `${appUrl}/?payment=verify&order=${orderId}`,  // verify dulu, bukan langsung success
      expiryPeriod: 1440,
    };

    const response = await fetch('https://api-prod.duitku.com/api/merchant/createInvoice', {
      method: 'POST',
      headers: {
        'Content-Type':          'application/json',
        'x-duitku-merchantcode': merchantCode,
        'x-duitku-signature':    signature,
        'x-duitku-timestamp':    timestamp,
      },
      body: JSON.stringify(payload),
    });

    const rawText = await response.text();
    console.log('Duitku status:', response.status, '| body:', rawText.substring(0, 200));

    let data;
    try { data = JSON.parse(rawText); }
    catch(e) {
      return res.status(500).json({ error: 'Duitku bukan JSON: ' + rawText.substring(0, 100) });
    }

    if (data.paymentUrl) {
      return res.status(200).json({ paymentUrl: data.paymentUrl, reference: data.reference, orderId });
    } else {
      return res.status(400).json({ error: data.statusMessage || data.message || 'Gagal buat invoice', raw: data });
    }

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function handleWebhook(req, res) {
  const merchantCode = process.env.DUITKU_MERCHANT_CODE || '';
  const apiKey       = process.env.DUITKU_MERCHANT_KEY  || '';
  const supabaseUrl  = process.env.SUPABASE_URL         || '';
  const supabaseKey  = process.env.SUPABASE_ANON_KEY    || '';

  const { merchantOrderId, amount, additionalParam: userId, resultCode, reference, signature: sig } = req.body || {};

  // Webhook signature tetap MD5 sesuai docs Duitku callback
  const expected = crypto.createHash('md5')
    .update(`${merchantCode}${amount}${merchantOrderId}${apiKey}`)
    .digest('hex');

  if (sig !== expected) {
    return res.status(400).send('FAIL');
  }

  const status = resultCode === '00' ? 'success' : resultCode === '01' ? 'pending' : 'failed';

  try {
    await fetch(`${supabaseUrl}/rest/v1/payment_log?order_id=eq.${merchantOrderId}`, {
      method: 'PATCH',
      headers: { 'Content-Type':'application/json', 'apikey':supabaseKey, 'Authorization':`Bearer ${supabaseKey}` },
      body: JSON.stringify({ status, transaction_id: reference }),
    });

    if (status === 'success' && userId) {
      // SECURITY: verifikasi amount dari DB, jangan percaya amount dari request webhook
      const logRes = await fetch(
        `${supabaseUrl}/rest/v1/payment_log?order_id=eq.${merchantOrderId}&select=amount,status`,
        { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
      );
      const logs = await logRes.json();

      // Tolak jika: order tidak ada, sudah pernah diproses, atau amount tidak cocok
      if (!logs.length) {
        console.error('SECURITY: order tidak ada di DB:', merchantOrderId);
        return res.status(200).send('SUCCESS'); // tetap 200 agar Duitku tidak retry
      }
      if (logs[0].status === 'success') {
        console.warn('SECURITY: order sudah pernah diproses:', merchantOrderId);
        return res.status(200).send('SUCCESS');
      }
      if (Number(logs[0].amount) !== Number(amount)) {
        console.error('SECURITY: amount tidak cocok! DB:', logs[0].amount, 'webhook:', amount);
        return res.status(200).send('SUCCESS');
      }

      const now    = new Date();
      const expiry = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      await fetch(`${supabaseUrl}/rest/v1/subscriptions?user_id=eq.${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type':'application/json', 'apikey':supabaseKey, 'Authorization':`Bearer ${supabaseKey}` },
        body: JSON.stringify({
          status:'active', plan:'monthly', price_idr:Number(amount),
          current_period_start: now.toISOString(),
          current_period_end:   expiry.toISOString(),
          updated_at:           now.toISOString(),
        }),
      });
      console.log('Subscription activated:', userId, 'order:', merchantOrderId);
    }
    return res.status(200).send('SUCCESS');
  } catch(e) {
    return res.status(500).send('FAIL');
  }
}
