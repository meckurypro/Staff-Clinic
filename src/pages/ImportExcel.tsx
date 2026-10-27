import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import readXlsxFile from 'read-excel-file'
import { supabase } from '../lib/supabase'
import { parseSheet, suggestDept, Parsed } from '../lib/importExcel'
const titleCase = (s: string) => (s === s.toUpperCase() || s === s.toLowerCase() ? s.toLowerCase().replace(/(^|[\s/&-])([a-z])/g, (_, a, b) => a + b.toUpperCase()) : s)
export default function ImportExcel() {
  const [ok, setOk] = useState(false); const [rows, setRows] = useState<any[][] | null>(null)
  const [merge, setMerge] = useState(false); const [existing, setExisting] = useState<string[]>([])
  const [map, setMap] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(''); const [msg, setMsg] = useState(''); const [done, setDone] = useState<any>(null)
  useEffect(() => { supabase.from('departments').select('name').order('name').then(r => setExisting((r.data ?? []).map((d: any) => d.name))) }, [])
  const parsed: Parsed | null = useMemo(() => { try { return rows ? parseSheet(rows, merge) : null } catch (e: any) { setMsg(e.message); return null } }, [rows, merge])
  const sources = useMemo(() => {
    const m = new Map<string, { label: string; n: number }>()
    parsed?.patients.forEach(p => { if (!p.department) return; const k = p.department.toLowerCase(); m.set(k, { label: m.get(k)?.label ?? p.department, n: (m.get(k)?.n ?? 0) + 1 }) })
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n)
  }, [parsed])
  useEffect(() => { setMap(Object.fromEntries(sources.map(([k, v]) => [k, suggestDept(v.label, existing)]))) }, [sources, existing])
  async function pick(f?: File) {
    if (!f) return; setMsg(''); setDone(null)
    try { setRows(await readXlsxFile(f)) } catch { setMsg('That file could not be read. Use an .xlsx file.') }
  }
  async function run() {
    if (!parsed) return; setBusy('Importing…'); setMsg('')
    const final = parsed.patients.map(p => ({ ...p, department: p.department ? (map[p.department.toLowerCase()] || titleCase(p.department)) : '' }))
    const total = { patients: 0, visits: 0, skipped: 0 }
    for (let i = 0; i < final.length; i += 20) {
      setBusy(`Importing… ${Math.min(i + 20, final.length)} of ${final.length} patients`)
      const { data, error } = await supabase.rpc('import_clinic_data', { payload: { patients: final.slice(i, i + 20) } })
      if (error) { setBusy(''); return setMsg(`Stopped after ${total.patients} new patients: ${error.message}. Running it again is safe; nothing is duplicated.`) }
      total.patients += data.patients; total.visits += data.visits; total.skipped += data.skipped
    }
    setBusy(''); setDone(total)
  }
  const visits = parsed?.patients.reduce((n, p) => n + p.visits.length, 0) ?? 0
  return (
    <>
      <Link to="/admin" className="back">← Admin</Link>
      <h1>Import from Excel</h1>
      <section className="card warn"><p>These are real staff health records. Only import them into a system BOI has approved for this purpose.</p>
        <label className="check"><input type="checkbox" checked={ok} onChange={e => setOk(e.target.checked)} /> I have approval to store these records here</label></section>
      <label>Consultation sheet (.xlsx)<input type="file" accept=".xlsx" disabled={!ok} onChange={e => pick(e.target.files?.[0])} /></label>
      {msg && <p className="err">{msg}</p>}
      {parsed && !done && <>
        <section className="card"><h2>Review</h2>
          <p>{parsed.rowsRead} rows read: <b>{visits} visits</b> for <b>{parsed.patients.length} patients</b>, {parsed.from} to {parsed.to}.</p>
          {parsed.rowsSkipped > 0 && <p className="muted">{parsed.rowsSkipped} rows skipped (no name or an unreadable date).</p>}
          {parsed.valuesDropped > 0 && <p className="muted">{parsed.valuesDropped} vitals outside a possible range were left out.</p>}
          {parsed.datesFixed > 0 && <p className="muted">{parsed.datesFixed} dates were in the future with day and month swapped; they were corrected.</p>}
          {parsed.stillFuture > 0 && <p className="err">{parsed.stillFuture} visits are still dated in the future. Check the sheet.</p>}
          {parsed.sameNameDifferentDept > 0 && <label className="check"><input type="checkbox" checked={merge} onChange={e => setMerge(e.target.checked)} /> Treat the same name in different departments as one person ({parsed.sameNameDifferentDept} cases)</label>}
        </section>
        <section className="card"><h2>Departments</h2><p className="muted">Match each spelling in the sheet to an existing department, or keep it as a new one.</p>
          <div className="scroll">{sources.map(([k, v]) => <div key={k} className="rowline"><span>{v.label} <small className="muted">({v.n})</small></span>
            <select value={map[k] ?? ''} onChange={e => setMap({ ...map, [k]: e.target.value })}><option value="">New: {titleCase(v.label)}</option>{existing.map(d => <option key={d} value={d}>{d}</option>)}</select></div>)}</div></section>
        <button className="primary block" onClick={run} disabled={!!busy}>{busy || `Import ${visits} visits`}</button>
        <p className="muted">Names found in the system already are reused, and a visit at the same date is skipped, so running this twice is safe.</p>
      </>}
      {done && <section className="card"><h2>Done</h2><p>{done.patients} new patients and {done.visits} visits imported{done.skipped ? `; ${done.skipped} already existed` : ''}.</p><Link className="primary block" to="/patients">Open patients</Link></section>}
    </>
  )
}
