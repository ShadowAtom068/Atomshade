import { createClient } from '@supabase/supabase-js';

// These two values come from your .env.local file (or Vercel's Environment Variables).
// The fallbacks only exist so the project can build before you add your keys.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321';
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'missing-anon-key';

// Inside the installed Android/iPhone app, login returns through a link back into the app,
// which needs the "code" style of login. The website keeps its normal behaviour.
const native = typeof window !== 'undefined' && !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

export const supabase = createClient(url, key, native ? { auth: { flowType: 'pkce', detectSessionInUrl: false } } : undefined);
