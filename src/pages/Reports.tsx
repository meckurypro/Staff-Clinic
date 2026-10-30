import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { supabase } from '../lib/supabase'
import { Badge, Empty, Icon, Notice, PageHeader, Spinner } from '../ui'
const iso = (d: Date) => d.toLocaleDateString('en-CA')
const nice = (d: string) => new Date(d + 'T00:00').toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })
export default function Reports() {
  const { profile } = useAuth(); const nav = useNavigate()
  const clinician = profile?.role !== 'safety_manager'
  const end = new Date(); const start = new Date(); start.setDate(end.getDate() - 6)
  const [from, setFrom] = useState(iso(start)); const [to, setTo] = useState(iso(end))
  const [names, setNames] = useState(true); const [busy, setBusy] = useState(false)
  const [s, setS] = useState<any>(null); const [err, setErr] = useState(''); const [list, setList] = useState<any[]>([])
  useEffect(() => { supabase.rpc('weekly_stats', { p_from: from, p_to: to }).then(r => { setErr(r.error?.message ?? ''); setS(r.data) }) }, [from, to])
  useEffect(() => { supabase.from('reports').select('id,period_from,period_to,status,created_at').order('period_to', { ascending: false }).limit(30).then(r => setList(r.data ?? [])) }, [])
  const [sheetOn, setSheetOn] = useState(false); const [sheetMsg, setSheetMsg] = useState('')
  useEffect(() => { if (clinician) supabase.from('app_settings').select('value').eq('key', 'sheets').maybeSingle().then(x => setSheetOn(!!x.data?.value?.spreadsheet_id)) }, [clinician])
  async function refreshSheet() {
    setSheetMsg('Refreshing…'); const { data, error } = await supabase.functions.invoke('sheets-sync', { body: { mode: 'full' } })
    let t = data?.error ?? error?.message; if (error && (error as any).context?.json) t = (await (error as any).context.json().catch(() => null))?.error ?? t
    setSheetMsg(t ? `Failed: ${t}` : `Sheet updated with ${data.rows} visits.`)
  }
  async function generate() {
    setBusy(true); setErr('')
    const { data, error } = await supabase.functions.invoke('generate-report', { body: { from, to, include_names: names } })
    let text = data?.error ?? error?.message
    if (error && (error as any).context?.json) text = (await (error as any).context.json().catch(() => null))?.error ?? text
    setBusy(false)
    if (text) setErr(text); else nav(`/reports/${data.id}`, { state: { note: data.note } })
  }
  const items: [string, any][] = [['Consultations', s?.consultations], ['Unique patients', s?.unique_patients], ['Repeat visits', s?.repeat_visits], ['Referrals', s?.referrals], ['Bed admissions', s?.bed_admissions], ['Average rest (min)', s?.avg_rest_minutes]]
  return (
    <>
      <PageHeader title="Reports" sub="Pick a period to see the figures, then build the weekly report." />
      <section className="panel" style={{ marginBottom: '1.1rem', paddingBottom: '.25rem' }}>
        <div className="fields fields-wide"><label>From<input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label><label>To<input type="date" value={to} onChange={e => setTo(e.target.value)} /></label></div>
      </section>
      {err && <Notice tone="error">{err}</Notice>}
      <section className="strip strip-3" aria-label="Figures for the selected period">{items.map(([k, v]) => <div key={k}><b>{v ?? '–'}</b><span>{k}</span></div>)}</section>
      <div className="stack">
        {clinician && <section className="panel"><h2 style={{ marginBottom: '.5rem' }}>Sick Bay report</h2>
          <p className="muted" style={{ marginBottom: '1rem', maxWidth: '62ch' }}>Builds the Word report for the dates above. Figures come from the clinic records; the narrative is drafted by your chosen AI model from totals only, with no names sent.</p>
          <label className="check" style={{ marginBottom: '1.1rem' }}><input type="checkbox" checked={names} onChange={e => setNames(e.target.checked)} />Show staff names in the consultation table</label>
          <button className="btn btn-primary" onClick={generate} disabled={busy}>{busy ? <><Spinner />Preparing… this can take a minute</> : <><Icon name="file" size={18} />Generate report</>}</button></section>}
        {sheetOn && <section className="panel"><h2 style={{ marginBottom: '.5rem' }}>Doctor's Google Sheet</h2><p className="muted" style={{ marginBottom: '1rem' }}>New visits are added to the sheet automatically. Rebuild it from scratch after corrections.</p><button className="btn btn-secondary" onClick={refreshSheet}>Rebuild sheet now</button>{sheetMsg && <p className="muted" style={{ marginTop: '.6rem' }}>{sheetMsg}</p>}</section>}
        <section className="panel"><div className="panel-head"><h2>{clinician ? 'Saved reports' : 'Reports'}</h2></div>
          {list.length === 0 ? <Empty icon="file" title="No reports yet">{clinician ? 'Generate your first report above.' : 'No final reports have been shared yet.'}</Empty> :
            <ul className="rows">{list.map(r => <li key={r.id}><Link className="row-link" to={`/reports/${r.id}`}>
              <span className="file-ico"><Icon name="file" size={20} /></span>
              <div className="grow"><b>{nice(r.period_from)} to {nice(r.period_to)}</b><span>Sick Bay report</span></div>
              <Badge tone={r.status === 'final' ? 'teal' : 'amber'}>{r.status === 'final' ? 'Final' : 'Draft'}</Badge><Icon name="chevron" size={18} />
            </Link></li>)}</ul>}</section>
      </div>
    </>
  )
}
