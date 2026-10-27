import { FormEvent, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth'
import { supabase } from '../lib/supabase'
import { Avatar, Empty, Icon, Notice, PageHeader, Spinner } from '../ui'
export default function Patients() {
  const { profile } = useAuth(); const nav = useNavigate(); const [sp] = useSearchParams()
  const start = sp.get('q') ?? ''; const startAdding = sp.get('new') === '1'
  const [q, setQ] = useState(start); const [rows, setRows] = useState<any[]>([])
  const [adding, setAdding] = useState(startAdding); const [depts, setDepts] = useState<any[]>([])
  const [f, setF] = useState<any>({ full_name: startAdding ? start : '', sex: '', approx_age: '', phone: '', staff_id: '', department_id: '', consent: '' })
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  useEffect(() => { supabase.from('departments').select('*').eq('active', true).order('name').then(r => setDepts(r.data ?? [])) }, [])
  useEffect(() => {
    if (q.trim().length < 2) { setRows([]); return }
    const t = setTimeout(async () => { const r = await supabase.rpc('search_patients', { q: q.trim() }); setRows(r.data ?? []) }, 250)
    return () => clearTimeout(t)
  }, [q])
  async function save(e: FormEvent) {
    e.preventDefault(); setErr(''); setBusy(true)
    const row: any = { full_name: f.full_name.trim(), created_by: profile?.id }
    if (f.sex) row.sex = f.sex; if (f.approx_age) row.approx_age = +f.approx_age
    if (f.phone) row.phone = f.phone.trim(); if (f.staff_id) row.staff_id = f.staff_id.trim()
    if (f.department_id) row.department_id = +f.department_id; if (f.consent) row.consent = f.consent
    const { data, error } = await supabase.from('patients').insert(row).select('id').single()
    setBusy(false)
    if (error) setErr(error.message.includes('staff_id') ? 'That staff ID is already registered.' : error.message)
    else nav(`/patients/${data.id}`)
  }
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value })
  const open = () => { setAdding(true); setF({ ...f, full_name: f.full_name || q }) }
  const searched = q.trim().length >= 2
  return (
    <>
      <PageHeader title="Patients" sub="Search before you register, so nobody ends up with two records." actions={!adding && <button className="btn btn-primary" onClick={open}><Icon name="plus" size={18} />Register patient</button>} />
      {!adding && <>
        <div className="finder-field panel" style={{ padding: '.6rem', marginBottom: '1rem' }}>
          <Icon name="search" /><input style={{ margin: 0, border: 0, minHeight: 48, paddingLeft: '2.6rem' }} placeholder="Name, staff ID or phone" aria-label="Search patients" value={q} onChange={e => setQ(e.target.value)} autoFocus />
        </div>
        <section className="panel">
          {!searched ? <Empty icon="search" title="Find a patient">Type at least 2 characters of a name, staff ID or phone number.</Empty> :
            rows.length === 0 ? <Empty icon="users" title="No match found">Check the spelling, or register {q.trim()} as a new patient.<button className="btn btn-primary" onClick={open}><Icon name="plus" size={18} />Register {q.trim()}</button></Empty> :
              <ul className="rows">{rows.map(p => <li key={p.id}><Link className="row-link" to={`/patients/${p.id}`}>
                <Avatar name={p.full_name} /><div className="grow"><b>{p.full_name}</b><span>{p.staff_id ?? 'No staff ID'}{p.phone ? ' · ' + p.phone : ''}</span></div><Icon name="chevron" size={18} />
              </Link></li>)}</ul>}
        </section>
      </>}
      {adding && <form onSubmit={save} className="panel">
        <div className="panel-head"><h2>New patient</h2><button type="button" className="btn btn-ghost btn-sm" onClick={() => setAdding(false)}>Cancel</button></div>
        <label>Full name<input value={f.full_name} onChange={set('full_name')} required autoFocus /></label>
        <div className="fields">
          <label>Sex<select value={f.sex} onChange={set('sex')} required><option value="">Select</option><option value="female">Female</option><option value="male">Male</option></select></label>
          <label>Age<input type="number" inputMode="numeric" min="0" max="120" value={f.approx_age} onChange={set('approx_age')} /></label>
          <label>Department<select value={f.department_id} onChange={set('department_id')}><option value="">Select</option>{depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        </div>
        <div className="fields">
          <label>Phone<input type="tel" value={f.phone} onChange={set('phone')} /></label>
          <label>Staff ID <small>(optional)</small><input value={f.staff_id} onChange={set('staff_id')} /></label>
          <label>Consent form signed<select value={f.consent} onChange={set('consent')}><option value="">Select</option><option value="yes">Yes</option><option value="no">No</option><option value="not_required">Not required</option></select></label>
        </div>
        {err && <Notice tone="error">{err}</Notice>}
        <div className="form-actions"><button className="btn btn-primary" disabled={busy}>{busy && <Spinner />}Save patient</button><button type="button" className="btn btn-secondary" onClick={() => setAdding(false)}>Cancel</button></div>
      </form>}
    </>
  )
}
