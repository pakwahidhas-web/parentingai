#!/bin/bash
echo "🔧 Injecting environment variables into index.html..."

# Inject ke index.html langsung — tidak perlu XHR atau env.js terpisah
sed -i "s|%%SUPABASE_URL%%|${SUPABASE_URL}|g"                     public/index.html
sed -i "s|%%SUPABASE_ANON_KEY%%|${SUPABASE_ANON_KEY}|g"           public/index.html
sed -i "s|%%ANTHROPIC_KEY%%|${ANTHROPIC_KEY}|g"                   public/index.html
sed -i "s|%%DUITKU_MERCHANT_KEY%%|${DUITKU_MERCHANT_KEY:-}|g"     public/index.html
sed -i "s|%%DUITKU_MERCHANT_CODE%%|${DUITKU_MERCHANT_CODE:-}|g"   public/index.html
sed -i "s|%%OWNER_WA%%|${OWNER_WA:-6281234567890}|g"              public/index.html
sed -i "s|%%OWNER_BANK%%|${OWNER_BANK:-BCA 1234567890}|g"         public/index.html

echo "✅ Build complete!"
