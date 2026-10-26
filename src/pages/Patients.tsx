import { FormEvent, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { supabase } from '../lib/supabase'
export default function Patients() {
  const { profile } = useAuth(); const nav = useNavigate()
  const [q, setQ] = useState(''); const [rows, setRows] = useState<any[]>([])
  const [adding, setAdding] = useState(false); const [depts, setDepts] = useState<any[]>([])
  const [f, setF] = useState<any>({ full_name: '', sex: '', approx_age: '', phone: '', staff_id: '', department_id: '', consent: '' })
  const [err, setErr] = useState('')
  useEffect(() => { supabase.from('departments').select('*').eq('active', true).order('name').then(r => setDepts(r.data ?? [])) }, [])
  useEffect(() => {
    if (q.trim().length < 2) { setRows([]); return }
    const t = setTimeout(async () => { const r = await supabase.rpc('search_patients', { q: q.trim() }); setRows(r.data ?? []) }, 250)
    return () => clearTimeout(t)
  }, [q])
  async function save(e: FormEvent) {
    e.preventDefault(); setErr('')
    const row: any = { full_name: f.full_name.trim(), created_by: profile?.id }
    if (f.sex) row.sex = f.sex; if (f.approx_age) row.approx_age = +f.approx_age
    if (f.phone) row.phone = f.phone.trim(); if (f.staff_id) row.staff_id = f.staff_id.trim()
    if (f.department_id) row.department_id = +f.department_id; if (f.consent) row.consent = f.consent
    const { data, error } = await supabase.from('patients').insert(row).select('id').single()
    if (error) setErr(error.message.includes('staff_id') ? 'That staff ID is already registered.' : error.message)
    else nav(`/patients/${data.id}`)
  }
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value })
  return (
    <>
      <h1>Patients</h1>
      <input className="search" placeholder="Name, staff ID or phone" value={q} onChange={e => setQ(e.target.value)} autoFocus />
      <ul className="list">
        {rows.map(p => <li key={p.id}><Link to={`/patients/${p.id}`}><b>{p.full_name}</b><span className="muted">{p.staff_id ?? 'No staff ID'}{p.phone ? ' · ' + p.phone : ''}</span></Link></li>)}
        {q.trim().length >= 2 && rows.length === 0 && <li className="muted pad">No match. Register them below.</li>}
      </ul>
      {!adding ? <button className="primary block" onClick={() => { setAdding(true); setF({ ...f, full_name: q }) }}>Register new patient</button> :
        <form onSubmit={save} className="card">
          <h2>New patient</h2>
          <label>Full name<input value={f.full_name} onChange={set('full_name')} required /></label>
          <div className="row">
            <label>Sex<select value={f.sex} onChange={set('sex')} required><option value="">Select</option><option value="female">Female</option><option value="male">Male</option></select></label>
            <label>Age<input type="number" min="0" max="120" value={f.approx_age} onChange={set('approx_age')} /></label>
          </div>
          <label>Department<select value={f.department_id} onChange={set('department_id')}><option value="">Select</option>{depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
          <label>Phone<input type="tel" value={f.phone} onChange={set('phone')} /></label>
          <label>Staff ID (optional)<input value={f.staff_id} onChange={set('staff_id')} /></label>
          <label>Consent form signed<select value={f.consent} onChange={set('consent')}><option value="">Select</option><option value="yes">Yes</option><option value="no">No</option><option value="not_required">Not required</option></select></label>
          {err && <p className="err">{err}</p>}
          <button className="primary">Save patient</button>
        </form>}
    </>
  )
}
