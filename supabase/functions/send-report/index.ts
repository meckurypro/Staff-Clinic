import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { report_id, to, message, attachments } = await req.json()
    const url = Deno.env.get('SUPABASE_URL')!
    const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
    const { data: me } = await asUser.auth.getUser()
    const { data: role } = await asUser.rpc('auth_role')
    if (!me?.user || !['nurse', 'doctor'].includes(role)) return json({ error: 'Only the nurse or doctor can email reports.' }, 403)

    const { data: report } = await asUser.from('reports').select('id, status, period_from, period_to').eq('id', report_id).maybeSingle()
    if (!report) return json({ error: 'Report not found.' }, 404)
    if (report.status !== 'final') return json({ error: 'Finalise the report before emailing it.' }, 400)

    // Recipients must come from the list the admin approved.
    const { data: cfg } = await asUser.from('app_settings').select('value').eq('key', 'report_email').single()
    const allowed = new Set(((cfg?.value?.recipients ?? []) as { email: string }[]).map(r => r.email.toLowerCase()))
    const list = (Array.isArray(to) ? to : []).map((e: string) => String(e).trim().toLowerCase())
    if (!list.length) return json({ error: 'Choose at least one recipient.' }, 400)
    if (list.some(e => !allowed.has(e))) return json({ error: 'One of those addresses is not on the approved recipient list.' }, 400)
    const from = cfg?.value?.from
    if (!from) return json({ error: 'Set the sender address on the Admin page first.' }, 400)

    const files = (Array.isArray(attachments) ? attachments : []).slice(0, 2)
    for (const f of files)
      if (!/^[\w. -]+\.(pdf|docx)$/i.test(f.filename ?? '') || typeof f.content !== 'string' || f.content.length > 5_000_000) return json({ error: 'Invalid attachment.' }, 400)

    const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: key } = await service.rpc('get_secret', { p_name: 'resend_api_key' })
    if (!key) return json({ error: 'Add your Resend API key on the Admin page first.' }, 400)

    const subject = `Sick Bay Report: ${report.period_from} to ${report.period_to}`
    const note = typeof message === 'string' ? message.slice(0, 2000) : ''
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from, to: list, subject,
        html: `<p>Please find attached the Sick Bay report for ${report.period_from} to ${report.period_to}.</p>${note ? `<p>${esc(note).replace(/\n/g, '<br>')}</p>` : ''}<p>Staff Clinic</p>`,
        attachments: files.map((f: any) => ({ filename: f.filename, content: f.content })),
      }),
    })
    const out = await res.json().catch(() => ({}))
    await service.from('report_emails').insert({
      report_id, sent_by: me.user.id, to_addrs: list, subject, status: res.ok ? 'sent' : 'failed', detail: res.ok ? out.id ?? null : String(out?.message ?? res.status).slice(0, 300),
    })
    if (!res.ok) return json({ error: `The email service refused it: ${String(out?.message ?? res.status).slice(0, 200)}` }, 502)
    return json({ ok: true })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Unexpected error' }, 500)
  }
})
