#!/bin/bash
# Script ini dijalankan oleh Vercel saat build
# Mengisi env.js dengan nilai dari Environment Variables

echo "🔧 Injecting environment variables..."

sed -i "s|REPLACE_SUPABASE_URL|${SUPABASE_URL}|g" public/env.js
sed -i "s|REPLACE_SUPABASE_ANON_KEY|${SUPABASE_ANON_KEY}|g" public/env.js

echo "✅ Build complete!"
