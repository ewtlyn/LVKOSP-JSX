import { createClient } from '@supabase/supabase-js'

const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

// В dev режиме запросы идут через Vite proxy (localhost → Supabase)
// Это обходит VPN/расширения которые блокируют браузерные запросы к supabase.co
const SUPABASE_URL = import.meta.env.DEV
  ? `${window.location.origin}/supabase`
  : import.meta.env.VITE_SUPABASE_URL

if (!SUPABASE_ANON_KEY) {
  console.error('❌ Missing VITE_SUPABASE_ANON_KEY in .env')
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  realtime: { params: { eventsPerSecond: 10 } },
})
