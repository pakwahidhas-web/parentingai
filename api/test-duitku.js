import crypto from 'crypto';

export default async function handler(req, res) {
  const merchantCode = process.env.DUITKU_MERCHANT_CODE || '';
  const apiKey       = process.env.DUITKU_MERCHANT_KEY  || '';
  const timestamp    = Date.now().toString();

  // Signature: MD5(merchantCode + timestamp + apiKey)
  const signature = crypto.createHash('md5')
    .update(`${merchantCode}${timestamp}${apiKey}`)
    .digest('hex');

  // Test createInvoice production dengan header auth
  const testPayload = {
    paymentAmount:    10000,
    merchantOrderId:  `TEST-${Date.now()}`,
    productDetails:   'Test ParentingAI',
    customerVaName:   'Test User',
    email:            'test@test.com',
    itemDetails:      [{ name: 'Test', price: 10000, quantity: 1 }],
    customerDetail:   { firstName: 'Test', email: 'test@test.com', phoneNumber: '08000000000' },
    callbackUrl:      'https://parentingai.vercel.app/api/payment?webhook=1',
    returnUrl:        'https://parentingai.vercel.app/',
    expiryPeriod:     10,
  };

  try {
    const r = await fetch('https://api-prod.duitku.com/api/merchant/createInvoice', {
      method: 'POST',
      headers: {
        'Content-Type':          'application/json',
        'x-duitku-merchantcode': merchantCode,
        'x-duitku-signature':    signature,
        'x-duitku-timestamp':    timestamp,
      },
      body: JSON.stringify(testPayload),
    });
    const txt = await r.text();
    let parsed; try { parsed = JSON.parse(txt); } catch(e) { parsed = { raw: txt }; }
    return res.status(200).json({
      config: { merchantCode, apiKeyPrefix: apiKey.substring(0,6)+'...', timestamp },
      duitkuStatus: r.status,
      duitkuResponse: parsed,
    });
  } catch(e) {
    return res.status(200).json({ error: e.message });
  }
}
