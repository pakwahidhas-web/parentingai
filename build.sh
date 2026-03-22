#!/bin/bash
# Script ini dijalankan oleh Vercel saat build
# Mengisi env.js dengan nilai dari Environment Variables

#!/bin/bash
echo "🔧 Injecting environment variables..."
sed -i "s|REPLACE_SUPABASE_URL|${SUPABASE_URL}|g"                     public/env.js
sed -i "s|REPLACE_SUPABASE_ANON_KEY|${SUPABASE_ANON_KEY}|g"           public/env.js
sed -i "s|REPLACE_ANTHROPIC_KEY|${ANTHROPIC_KEY}|g"                   public/env.js
sed -i "s|REPLACE_DUITKU_MERCHANT_KEY|${DUITKU_MERCHANT_KEY:-}|g"     public/env.js
sed -i "s|REPLACE_DUITKU_MERCHANT_CODE|${DUITKU_MERCHANT_CODE:-}|g"   public/env.js
sed -i "s|REPLACE_OWNER_WA|${OWNER_WA:-6281234567890}|g"              public/env.js
sed -i "s|REPLACE_OWNER_BANK|${OWNER_BANK:-BCA 1234567890}|g"         public/env.js

echo "✅ Build complete!"

