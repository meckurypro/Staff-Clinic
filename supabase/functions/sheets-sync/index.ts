import { createClient } from 'npm:@supabase/supabase-js@2'
import { HEAD, Sheet, SheetError, VISIT_SELECT, googleToken, rowFor } from './sheets.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// mode "append" (default): add a row for each visit waiting in the queue. mode "full": rebuild the whole tab.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  let claimed: number[] = []
  const url = Deno.env.get('SUPABASE_URL')!
  const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  try {
    const body = await req.json().catch(() => ({}))
    const mode = body?.mode === 'full' ? 'full' : 'append'
    const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
    const { data: role } = await asUser.rpc('auth_role')
    if (!['nurse', 'doctor'].includes(role)) return json({ error: 'Only the nurse or doctor can update the sheet.' }, 403)

    const { data: cfg } = await asUser.from('app_settings').select('value').eq('key', 'sheets').single()
    const sheetId = String(cfg?.value?.spreadsheet_id ?? '').trim()
    if (!/^[\w-]{20,}$/.test(sheetId)) return json({ error: 'Add the Google Sheet ID on the Admin page first.' }, 400)
    const showNames = cfg?.value?.include_names !== false
    const { data: raw } = await service.rpc('get_secret', { p_name: 'google_service_account' })
    if (!raw) return json({ error: 'Add the Google service account key on the Admin page first.' }, 400)

    // Queue first, so concurrent calls never send the same visit twice.
    if (mode === 'append') {
      const { data: c } = await service.rpc('claim_sheet_outbox', { p_limit: 50 })
      claimed = (c ?? []).map((x: any) => x.id)
      if (!claimed.length) return json({ ok: true, appended: 0 })
    }
    const sheet = new Sheet(sheetId, await googleToken(JSON.parse(raw)))
    const hasHeader = await sheet.prepare()

    // Real records only; demo patients are never copied to Google.
    const loadAll = async () => {
      const out: any[] = []
      for (let from = 0; ; from += 1000) {
        const { data, error } = await service.from('visits').select(VISIT_SELECT).eq('is_demo', false).order('visit_at', { ascending: true }).range(from, from + 999)
        if (error) throw new Error(error.message)
        out.push(...(data ?? [])); if ((data ?? []).length < 1000) return out
      }
    }
    let rows: number, how: 'full' | 'append'
    if (mode === 'full' || !hasHeader) {          // a brand-new or emptied tab always gets the complete history
      const all = await loadAll(); await sheet.writeAll(all.map(v => rowFor(v, showNames))); rows = all.length; how = 'full'
      await service.rpc('clear_sheet_outbox')
    } else {
      const ids = (await service.from('sheet_outbox').select('visit_id').in('id', claimed)).data?.map((x: any) => x.visit_id) ?? []
      const { data: vs, error } = await service.from('visits').select(VISIT_SELECT).in('id', ids).eq('is_demo', false).order('visit_at', { ascending: true })
      if (error) throw new Error(error.message)
      if ((vs ?? []).length) await sheet.append((vs ?? []).map((v: any) => rowFor(v, showNames)))
      await service.rpc('finish_sheet_outbox', { p_ids: claimed }); rows = (vs ?? []).length; how = 'append'
    }
    const at = new Date().toISOString()
    await service.from('app_settings').upsert({ key: 'sheets_status', value: { at, rows, mode: how, columns: HEAD.length } })
    return json({ ok: true, rows, mode: how, at })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unexpected error'
    if (claimed.length) await service.rpc('finish_sheet_outbox', { p_ids: claimed, p_error: msg })   // stays queued for the next try
    return json({ error: msg }, e instanceof SheetError ? 400 : 500)
  }
})
