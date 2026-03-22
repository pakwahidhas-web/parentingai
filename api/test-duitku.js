import crypto from 'crypto';

export default async function handler(req, res) {
  const merchantCode = process.env.DUITKU_MERCHANT_CODE || '';
  const apiKey       = process.env.DUITKU_MERCHANT_KEY  || '';
  const isProd       = process.env.DUITKU_ENV === 'production';

  // Info environment (JANGAN taruh di production lama-lama)
  const info = {
    merchantCode:      merchantCode || 'KOSONG',
    apiKeyLength:      apiKey.length,
    apiKeyPrefix:      apiKey ? apiKey.substring(0,6)+'...' : 'KOSONG',
    environment:       isProd ? 'PRODUCTION' : 'SANDBOX',
    baseUrl:           isProd
      ? 'https://api-prod.duitku.com/api/merchant'
      : 'https://api-sandbox.duitku.com/api/merchant',
  };

  // Test ping ke Duitku — cek merchant info
  try {
    const timestamp  = Date.now().toString();
    // Duitku get payment method signature: MD5(merchantCode + timestamp + apiKey)
    const signature  = crypto.createHash('md5')
      .update(`${merchantCode}${timestamp}${apiKey}`)
      .digest('hex');

    const testUrl = isProd
      ? 'https://api-prod.duitku.com/api/merchant/paymentmethod/getPaymentMethod'
      : 'https://api-sandbox.duitku.com/api/merchant/paymentmethod/getPaymentMethod';

    const testRes = await fetch(testUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ merchantcode: merchantCode, timestamp, signature }),
    });

    const raw = await testRes.text();
    let parsed;
    try { parsed = JSON.parse(raw); } catch(e) { parsed = { raw }; }

    return res.status(200).json({
      config: info,
      duitkuStatus: testRes.status,
      duitkuResponse: parsed,
    });
  } catch(e) {
    return res.status(200).json({ config: info, error: e.message });
  }
}
