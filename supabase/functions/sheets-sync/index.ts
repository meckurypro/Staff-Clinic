import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const TAB = 'Clinic records'
const HEAD = ['Date', 'Name', 'Staff ID', 'Sex', 'Age', 'Department', 'Phone', 'BP', 'Pulse', 'Temp C', 'Weight kg', 'RBS', 'Complaint',
  'Diagnosis', "Doctor's note", 'Nursing note', 'Prescription', 'Referral', 'Major concern', 'Remark', 'Bed rest', 'Plan accepted']

const b64u = (b: ArrayBuffer | string) =>
  btoa(typeof b === 'string' ? b : String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

async function googleToken(sa: { client_email: string; private_key: string }): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claim = b64u(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }))
  const der = Uint8Array.from(atob(sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')), c => c.charCodeAt(0))
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${claim}`))
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claim}.${b64u(sig)}` }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`Google sign-in failed: ${data.error_description ?? data.error}`)
  return data.access_token
}

const lagos = (iso: string) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Africa/Lagos', dateStyle: 'medium', timeStyle: 'short' })
const join = (a: (string | null | undefined)[]) => a.filter(Boolean).join('; ')

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
    const { data: role } = await asUser.rpc('auth_role')
    if (!['nurse', 'doctor'].includes(role)) return json({ error: 'Only the nurse or doctor can refresh the sheet.' }, 403)

    const { data: cfg } = await asUser.from('app_settings').select('value').eq('key', 'sheets').single()
    const sheetId = String(cfg?.value?.spreadsheet_id ?? '').trim()
    if (!/^[\w-]{20,}$/.test(sheetId)) return json({ error: 'Add the Google Sheet ID on the Admin page first.' }, 400)
    const showNames = cfg?.value?.include_names !== false

    const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: raw } = await service.rpc('get_secret', { p_name: 'google_service_account' })
    if (!raw) return json({ error: 'Add the Google service account key on the Admin page first.' }, 400)

    // Real records only; demo patients are never copied to Google.
    const { data: visits, error } = await asUser.from('visits').select(
      'visit_at, major_concern, remark, plan_accepted, patients(full_name, staff_id, sex, approx_age, phone, departments(name)), vitals(bp_systolic, bp_diastolic, pulse, temp_c, weight_kg, rbs_mgdl), visit_notes(kind, body), prescriptions(drug, dose, frequency, duration), referrals(destination), bed_stays(admitted_at, discharged_at)',
    ).eq('is_demo', false).order('visit_at', { ascending: false }).limit(3000)
    if (error) return json({ error: error.message }, 400)

    const rows = (visits ?? []).map((v: any) => {
      const p = v.patients ?? {}; const vt = v.vitals?.[0] ?? {}; const notes = (k: string) => join((v.visit_notes ?? []).filter((n: any) => n.kind === k).map((n: any) => n.body))
      return [lagos(v.visit_at), showNames ? p.full_name : '\u2014', p.staff_id ?? '', p.sex ?? '', p.approx_age ?? '', p.departments?.name ?? '', p.phone ?? '',
        vt.bp_systolic ? `${vt.bp_systolic}/${vt.bp_diastolic}` : '', vt.pulse ?? '', vt.temp_c ?? '', vt.weight_kg ?? '', vt.rbs_mgdl ?? '',
        notes('complaint'), notes('diagnosis'), notes('medical'), notes('nursing'),
        join((v.prescriptions ?? []).map((r: any) => [r.drug, r.dose, r.frequency, r.duration].filter(Boolean).join(' '))),
        join((v.referrals ?? []).map((r: any) => r.destination)), v.major_concern ?? '', v.remark ?? '',
        (v.bed_stays ?? []).map((b: any) => `${lagos(b.admitted_at)}${b.discharged_at ? ' to ' + lagos(b.discharged_at) : ' (in bed)'}`).join('; '),
        v.plan_accepted == null ? '' : v.plan_accepted ? 'Yes' : 'No']
    })

    const token = await googleToken(JSON.parse(raw))
    const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
    const base = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`
    const meta = await fetch(`${base}?fields=sheets.properties.title`, { headers: auth })
    const metaJson = await meta.json()
    if (!meta.ok) return json({ error: `Google refused access to the sheet (${metaJson?.error?.message ?? meta.status}). Share it with the service account email as Editor.` }, 400)
    if (!(metaJson.sheets ?? []).some((s: any) => s.properties.title === TAB))
      await fetch(`${base}:batchUpdate`, { method: 'POST', headers: auth, body: JSON.stringify({ requests: [{ addSheet: { properties: { title: TAB } } }] }) })
    await fetch(`${base}/values/${encodeURIComponent(TAB)}:clear`, { method: 'POST', headers: auth, body: '{}' })
    const put = await fetch(`${base}/values/${encodeURIComponent(TAB + '!A1')}?valueInputOption=RAW`, {
      method: 'PUT', headers: auth, body: JSON.stringify({ values: [HEAD, ...rows] }),
    })
    if (!put.ok) return json({ error: `Writing to the sheet failed: ${(await put.json())?.error?.message ?? put.status}` }, 502)

    const at = new Date().toISOString()
    await service.from('app_settings').upsert({ key: 'sheets_status', value: { at, rows: rows.length } })
    return json({ ok: true, rows: rows.length, at })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Unexpected error' }, 500)
  }
})
