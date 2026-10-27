import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { supabase } from '../lib/supabase'
const iso = (d: Date) => d.toLocaleDateString('en-CA')
export default function Reports() {
  const { profile } = useAuth(); const nav = useNavigate()
  const clinician = profile?.role !== 'safety_manager'
  const end = new Date(); const start = new Date(); start.setDate(end.getDate() - 6)
  const [from, setFrom] = useState(iso(start)); const [to, setTo] = useState(iso(end))
  const [names, setNames] = useState(true); const [busy, setBusy] = useState(false)
  const [s, setS] = useState<any>(null); const [err, setErr] = useState(''); const [list, setList] = useState<any[]>([])
  useEffect(() => { supabase.rpc('weekly_stats', { p_from: from, p_to: to }).then(r => { setErr(r.error?.message ?? ''); setS(r.data) }) }, [from, to])
  useEffect(() => { supabase.from('reports').select('id,period_from,period_to,status,created_at').order('period_to', { ascending: false }).limit(30).then(r => setList(r.data ?? [])) }, [])
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
      <h1>Reports</h1>
      <div className="row"><label>From<input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label><label>To<input type="date" value={to} onChange={e => setTo(e.target.value)} /></label></div>
      {err && <p className="err">{err}</p>}
      <section className="statgrid">{items.map(([k, v]) => <div key={k}><b>{v ?? '–'}</b><span>{k}</span></div>)}</section>
      {clinician && <section className="card"><h2>Sick Bay report</h2>
        <p className="muted">Builds the Word report for the dates above. Figures come from the clinic records; the narrative is drafted by your chosen AI model from totals only, with no names sent.</p>
        <label className="check"><input type="checkbox" checked={names} onChange={e => setNames(e.target.checked)} /> Show staff names in the consultation table</label>
        <button className="primary block" onClick={generate} disabled={busy}>{busy ? 'Preparing… this can take a minute' : 'Generate report'}</button></section>}
      <h2>{clinician ? 'Saved reports' : 'Reports'}</h2>
      <ul className="list">{list.map(r => <li key={r.id}><Link to={`/reports/${r.id}`}><b>{r.period_from} to {r.period_to}</b><span className="muted">{r.status === 'final' ? 'Final' : 'Draft'}</span></Link></li>)}
        {list.length === 0 && <li className="muted pad">{clinician ? 'No reports yet.' : 'No final reports have been shared yet.'}</li>}</ul>
    </>
  )
}
