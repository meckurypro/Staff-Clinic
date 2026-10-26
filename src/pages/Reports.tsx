import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
const iso = (d: Date) => d.toISOString().slice(0, 10)
export default function Reports() {
  const end = new Date(); const start = new Date(); start.setDate(end.getDate() - 6)
  const [from, setFrom] = useState(iso(start)); const [to, setTo] = useState(iso(end))
  const [s, setS] = useState<any>(null); const [err, setErr] = useState('')
  useEffect(() => { supabase.rpc('weekly_stats', { p_from: from, p_to: to }).then(r => { setErr(r.error?.message ?? ''); setS(r.data) }) }, [from, to])
  const items: [string, any][] = [['Consultations', s?.consultations], ['Unique patients', s?.unique_patients], ['Repeat visits', s?.repeat_visits], ['Referrals', s?.referrals], ['Bed admissions', s?.bed_admissions], ['Average rest (min)', s?.avg_rest_minutes]]
  return (
    <>
      <h1>Reports</h1>
      <div className="row"><label>From<input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label><label>To<input type="date" value={to} onChange={e => setTo(e.target.value)} /></label></div>
      {err && <p className="err">{err}</p>}
      <section className="statgrid">{items.map(([k, v]) => <div key={k}><b>{v ?? '–'}</b><span>{k}</span></div>)}</section>
      <p className="muted">Word report from the safety manager's template comes in the next stage.</p>
    </>
  )
}
