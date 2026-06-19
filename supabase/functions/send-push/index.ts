import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// @deno-types="https://esm.sh/web-push@3.6.7/types/index.d.ts"
import webpush from 'https://esm.sh/web-push@3.6.7'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY')!
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY')!
const VAPID_EMAIL = Deno.env.get('VAPID_EMAIL') || 'mailto:admin@lvkosp.app'

webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE)

serve(async (req) => {
  try {
    const { user_id, title, body, url } = await req.json()
    if (!user_id || !title) return new Response('Bad request', { status: 400 })

    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    const { data: subs } = await db.from('push_subscriptions')
      .select('endpoint, p256dh, auth').eq('user_id', user_id)

    if (!subs?.length) return new Response('No subscription', { status: 200 })

    const payload = JSON.stringify({ title, body: body || '', url: url || '/' })
    await Promise.allSettled(subs.map(s =>
      webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload)
    ))

    return new Response('OK', { status: 200 })
  } catch (e) {
    return new Response(String(e), { status: 500 })
  }
})
