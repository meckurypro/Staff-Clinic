import { FormEvent, useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../auth'
import { supabase } from '../lib/supabase'
import { Avatar, Badge, Icon, Loading, Notice, Spinner } from '../ui'
const blank = { when: '', diag: '', concern: '', remark: '', bp: '', pulse: '', temp: '', weight: '', rbs: '', complaint: '', nursing: '', doctor: '', drug: '', dose: '', freq: '', dur: '' }
const KIND: Record<string, string> = { complaint: 'Complaint', nursing: 'Nursing note', diagnosis: 'Diagnosis', medical: "Doctor's note", advice: 'Advice' }
const AUTHOR = ', author:profiles!author_id(full_name), entered:profiles!entered_by(full_name), edited:profiles!edited_by(full_name)'
type Edit = { table: string; id: string; v: Record<string, string> } | { table: 'visits'; id: string; v: Record<string, string> }
export default function PatientDetail() {
  const { id } = useParams(); const { profile } = useAuth()
  const nurse = profile?.role === 'nurse'
  const [p, setP] = useState<any>(null); const [visits, setVisits] = useState<any[]>([]); const [depts, setDepts] = useState<any[]>([])
  const [freeBeds, setFreeBeds] = useState<any[]>([]); const [f, setF] = useState<any>(blank)
  const [open, setOpen] = useState(false); const [err, setErr] = useState(''); const [ok, setOk] = useState(''); const [busy, setBusy] = useState(false)
  const [editP, setEditP] = useState<any>(null); const [edit, setEdit] = useState<Edit | null>(null)
  const [admit, setAdmit] = useState<{ visit: string; bed: string; reason: string } | null>(null)
  const [merge, setMerge] = useState<{ q: string; rows: any[] } | null>(null)
  const load = useCallback(async () => {
    const [a, v, b, s, d] = await Promise.all([
      supabase.from('patients').select('*, departments(name)').eq('id', id).single(),
      supabase.from('visits').select(`*, vitals(*), prescriptions(*${AUTHOR}), visit_notes(*${AUTHOR}), bed_stays(*)`).eq('patient_id', id).order('visit_at', { ascending: false }),
      supabase.from('beds').select('*').eq('active', true).order('id'),
      supabase.from('bed_stays').select('bed_id').is('discharged_at', null),
      supabase.from('departments').select('*').eq('active', true).order('name'),
    ])
    setP(a.data); setVisits(v.data ?? []); setDepts(d.data ?? [])
    const used = new Set((s.data ?? []).map((x: any) => x.bed_id)); setFreeBeds((b.data ?? []).filter((x: any) => !used.has(x.id)))
  }, [id])
  useEffect(() => { load() }, [load])
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value })
  const fail = (m: string) => { setErr(m); setOk('') }

  async function savePatient(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr('')
    const row: any = { full_name: editP.full_name.trim(), sex: editP.sex || null, approx_age: editP.approx_age ? +editP.approx_age : null, phone: editP.phone?.trim() || null,
      staff_id: editP.staff_id?.trim() || null, department_id: editP.department_id ? +editP.department_id : null, consent: editP.consent || null }
    const { error } = await supabase.from('patients').update(row).eq('id', id)
    setBusy(false)
    if (error) return fail(error.message.includes('staff_id') && error.message.includes('unique') ? 'That staff ID belongs to another patient.' : error.message)
    setEditP(null); setOk('Details updated. The previous values are kept in the audit log.'); load()
  }
  async function searchMerge(q: string) {
    setMerge({ q, rows: [] }); if (q.trim().length < 2) return
    const r = await supabase.rpc('search_patients', { q: q.trim() }); setMerge({ q, rows: (r.data ?? []).filter((x: any) => x.id !== id) })
  }
  async function doMerge(other: any) {
    if (!window.confirm(`Merge "${other.full_name}" into "${p.full_name}"?\n\nTheir visits move to this record and the other record is removed. This is logged and cannot be undone from the app.`)) return
    const { error } = await supabase.rpc('merge_patients', { p_keep: id, p_remove: other.id })
    if (error) return fail(error.message); setMerge(null); setOk('Records merged.'); load()
  }

  async function otherClinician(role: 'doctor' | 'nurse') {
    const r = await supabase.from('profiles').select('id').eq('role', role).eq('is_active', true).limit(1); return r.data?.[0]?.id as string | undefined
  }
  async function saveVisit(e: FormEvent) {
    e.preventDefault(); setErr(''); setBusy(true)
    const other = nurse ? 'doctor' : 'nurse'
    const needs = nurse ? !!(f.doctor || f.drug || f.diag) : !!f.nursing
    let behalf: any = { entry_type: 'original' }
    if (needs) {
      const oid = await otherClinician(other)
      if (!oid) { setBusy(false); return fail(`No ${other} account exists yet, so those entries cannot be saved.`) }
      behalf = { entry_type: 'on_behalf_pending', author_id: oid }
    }
    const [sys, dia] = f.bp.split('/'); const n = (x: string) => (x ? +x : null)
    const hasVitals = f.bp || f.pulse || f.temp || f.weight || f.rbs
    const notes: any[] = []
    if (f.complaint) notes.push({ kind: 'complaint', body: f.complaint })
    if (f.nursing) notes.push({ kind: 'nursing', body: f.nursing, ...(nurse ? {} : behalf) })
    if (f.diag) notes.push({ kind: 'diagnosis', body: f.diag, ...(nurse ? behalf : {}) })
    if (f.doctor) notes.push({ kind: 'medical', body: f.doctor, ...(nurse ? behalf : {}) })
    const payload = { patient_id: id, visit_at: f.when ? new Date(f.when).toISOString() : null, major_concern: f.concern, remark: f.remark,
      vitals: hasVitals ? { bp_s: n(sys), bp_d: n(dia), pulse: n(f.pulse), temp: n(f.temp), weight: n(f.weight), rbs: n(f.rbs) } : null,
      notes, prescriptions: f.drug ? [{ drug: f.drug, dose: f.dose, frequency: f.freq, duration: f.dur, ...(nurse ? behalf : {}) }] : [] }
    // One database call: the whole visit is saved, or nothing is, even if the connection drops.
    const { error } = await supabase.rpc('save_visit', { p: payload })
    setBusy(false)
    if (error) return fail(navigator.onLine ? error.message : 'No internet connection. Nothing was saved. Your entries are still here, so try again when you are back online.')
    setF(blank); setOpen(false); setOk('Visit saved.'); load()
  }

  async function admitNow(e: FormEvent) {
    e.preventDefault(); if (!admit?.bed) return
    const r = await supabase.from('bed_stays').insert({ visit_id: admit.visit, bed_id: +admit.bed, reason: admit.reason.trim() || null, admitted_by: profile?.id })
    if (r.error) return fail(r.error.message); setAdmit(null); setOk('Admitted to bed.'); load()
  }
  async function saveEdit(e: FormEvent) {
    e.preventDefault(); if (!edit) return
    const v: any = { ...edit.v }
    if (edit.table === 'visits') { v.major_concern = v.major_concern?.trim() || null; v.remark = v.remark?.trim() || null }
    const { error } = await supabase.from(edit.table).update(v).eq('id', edit.id)
    if (error) return fail(error.message); setEdit(null); setOk('Correction saved. The earlier wording is kept in the audit log.'); load()
  }
  async function confirm(table: string, rowId: string) { await supabase.from(table).update({ entry_type: 'confirmed' }).eq('id', rowId); load() }

  const who = (r: any) => r.entry_type === 'transcribed' && !r.author_id ? 'Imported from the clinic Excel records' : r.entry_type === 'on_behalf_pending' ? `Entered by ${r.entered?.full_name} for ${r.author?.full_name}` : r.author?.full_name
  const status = (r: any) => r.entry_type === 'on_behalf_pending' ? <Badge tone="amber">Awaiting review</Badge> : r.entry_type === 'confirmed' ? <Badge tone="teal">Confirmed</Badge> : null
  const canConfirm = (r: any) => r.entry_type === 'on_behalf_pending' && r.author_id === profile?.id
  const corrected = (r: any) => r.edited_at && <small className="muted"> · Corrected {new Date(r.edited_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}{r.edited?.full_name ? ` by ${r.edited.full_name}` : ''}</small>
  const editing = (table: string, r: any) => edit?.table === table && edit.id === r.id
  const setE = (k: string) => (e: any) => setEdit({ ...edit!, v: { ...edit!.v, [k]: e.target.value } })
  const correct = (table: string, r: any, fields: string[]) => <button className="btn btn-ghost btn-sm" onClick={() => setEdit({ table, id: r.id, v: Object.fromEntries(fields.map(k => [k, r[k] ?? ''])) })}>Correct</button>
  if (!p) return <Loading />
  const chips = [p.sex && p.sex[0].toUpperCase() + p.sex.slice(1), p.approx_age && p.approx_age + ' yrs', p.departments?.name, p.staff_id, p.phone].filter(Boolean)
  const setP2 = (k: string) => (e: any) => setEditP({ ...editP, [k]: e.target.value })
  return (
    <>
      <Link to="/patients" className="back"><Icon name="back" size={16} />Patients</Link>
      <section className="panel patient-hero">
        <Avatar name={p.full_name} size={64} />
        <div className="who"><h1>{p.full_name}</h1><div className="chips">{chips.map((c: string) => <span key={c} className="chip">{c}</span>)}</div></div>
        <div className="btns">
          {!editP && <button className="btn btn-secondary" onClick={() => setEditP({ ...p, department_id: p.department_id ?? '' })}>Edit details</button>}
          {!open && <button className="btn btn-primary" onClick={() => setOpen(true)}><Icon name="plus" size={18} />New visit</button>}
        </div>
      </section>
      {ok && <Notice tone="ok">{ok}</Notice>}
      {editP && <form className="panel" onSubmit={savePatient} style={{ marginBottom: '1.1rem' }}>
        <div className="panel-head"><h2>Edit details</h2><button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditP(null)}>Cancel</button></div>
        <label>Full name<input value={editP.full_name} onChange={setP2('full_name')} required /></label>
        <div className="fields">
          <label>Sex<select value={editP.sex ?? ''} onChange={setP2('sex')}><option value="">Not recorded</option><option value="female">Female</option><option value="male">Male</option></select></label>
          <label>Age<input type="number" inputMode="numeric" min="0" max="120" value={editP.approx_age ?? ''} onChange={setP2('approx_age')} /></label>
          <label>Department<select value={editP.department_id} onChange={setP2('department_id')}><option value="">Not recorded</option>{depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        </div>
        <div className="fields">
          <label>Phone<input type="tel" value={editP.phone ?? ''} onChange={setP2('phone')} /></label>
          <label>Staff ID<input value={editP.staff_id ?? ''} onChange={setP2('staff_id')} /></label>
          <label>Consent form signed<select value={editP.consent ?? ''} onChange={setP2('consent')}><option value="">Not recorded</option><option value="yes">Yes</option><option value="no">No</option><option value="not_required">Not required</option></select></label>
        </div>
        <div className="form-actions"><button className="btn btn-primary" disabled={busy}>{busy && <Spinner />}Save changes</button></div>
      </form>}
      {profile?.is_admin && !editP && <div style={{ marginBottom: '1rem' }}>{!merge ? <button className="btn btn-ghost btn-sm" onClick={() => setMerge({ q: '', rows: [] })}>Merge a duplicate record into this one</button> :
        <section className="panel"><div className="panel-head"><h2>Merge a duplicate</h2><button className="btn btn-ghost btn-sm" onClick={() => setMerge(null)}>Cancel</button></div>
          <label>Find the duplicate<input value={merge.q} onChange={e => searchMerge(e.target.value)} placeholder="Name, staff ID or phone" autoFocus /></label>
          <ul className="rows">{merge.rows.map(r => <li key={r.id} className="staff-row"><div className="grow"><b>{r.full_name}</b><small>{r.staff_id ?? 'No staff ID'}{r.phone ? ' · ' + r.phone : ''}</small></div><button className="btn btn-secondary btn-sm" onClick={() => doMerge(r)}>Merge into this record</button></li>)}</ul></section>}</div>}
      {open && <form className="panel" onSubmit={saveVisit} style={{ marginBottom: '1.1rem' }}>
        <div className="panel-head"><h2>New visit</h2><button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Cancel</button></div>
        <div className="form-group"><h3>When</h3>
          <label>Visit date and time <small>(leave empty for now)</small><input type="datetime-local" value={f.when} onChange={set('when')} /></label></div>
        <div className="form-group"><h3>Vitals</h3>
          <div className="fields">
            <label>BP<input placeholder="120/80" value={f.bp} onChange={set('bp')} /></label>
            <label>Pulse<input type="number" inputMode="numeric" value={f.pulse} onChange={set('pulse')} /></label>
            <label>Temp °C<input type="number" inputMode="decimal" step="0.1" value={f.temp} onChange={set('temp')} /></label>
            <label>Weight kg<input type="number" inputMode="decimal" step="0.1" value={f.weight} onChange={set('weight')} /></label>
            <label>RBS<input type="number" inputMode="decimal" step="0.1" value={f.rbs} onChange={set('rbs')} /></label>
          </div></div>
        <div className="form-group"><h3>Notes</h3>
          <label>Complaint<textarea value={f.complaint} onChange={set('complaint')} required /></label>
          <label>Nursing note{!nurse && <small> (saved as entered by you for the nurse)</small>}<textarea value={f.nursing} onChange={set('nursing')} /></label>
          <label>Doctor's note{nurse && <small> (saved as entered by you for the doctor)</small>}<textarea value={f.doctor} onChange={set('doctor')} /></label>
          <label>Diagnosis / medical condition{nurse && <small> (saved as entered by you for the doctor)</small>}<input value={f.diag} onChange={set('diag')} /></label>
          <div className="fields fields-wide">
            <label>Major concern <small>(only if there is one)</small><input value={f.concern} onChange={set('concern')} /></label>
            <label>Remark <small>(leave empty to fill from prescriptions, referrals and bed rest)</small><input value={f.remark} onChange={set('remark')} /></label>
          </div></div>
        <div className="form-group"><h3>Prescription</h3>
          <label>Drug<input value={f.drug} onChange={set('drug')} /></label>
          <div className="fields"><label>Dose<input value={f.dose} onChange={set('dose')} /></label><label>Frequency<input value={f.freq} onChange={set('freq')} /></label><label>Duration<input value={f.dur} onChange={set('dur')} /></label></div></div>
        {err && <Notice tone="error">{err}</Notice>}
        <div className="form-actions"><button className="btn btn-primary" disabled={busy}>{busy && <Spinner />}Save visit</button><button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>Cancel</button></div>
      </form>}
      {err && !open && <Notice tone="error">{err}</Notice>}
      <div className="visit-list">
        {visits.length === 0 && <section className="panel"><div className="empty"><span className="empty-ico"><Icon name="pulse" size={24} /></span><h3>No visits yet</h3><p>Record the first visit to start this patient's history.</p></div></section>}
        {visits.map(v => {
          const stay = v.bed_stays?.find((s: any) => !s.discharged_at)
          return (
            <article key={v.id} className="panel">
              <div className="visit-head"><h3>{new Date(v.visit_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</h3><div className="btns">{stay && <Badge tone="amber" dot>Resting</Badge>}{!editing('visits', v) && <button className="btn btn-ghost btn-sm" onClick={() => setEdit({ table: 'visits', id: v.id, v: { major_concern: v.major_concern ?? '', remark: v.remark ?? '' } })}>Edit</button>}</div></div>
              {editing('visits', v) ? <form onSubmit={saveEdit} className="fields fields-wide"><label>Major concern<input value={edit!.v.major_concern} onChange={setE('major_concern')} /></label><label>Remark<input value={edit!.v.remark} onChange={setE('remark')} /></label>
                <div className="form-actions"><button className="btn btn-primary btn-sm">Save</button><button type="button" className="btn btn-secondary btn-sm" onClick={() => setEdit(null)}>Cancel</button></div></form> : <>
                {v.major_concern && <div className="concern"><Icon name="alert" size={18} /><span>Major concern: {v.major_concern}</span></div>}
                {v.remark && <p className="remark">{v.remark}</p>}</>}
              {v.vitals?.map((x: any) => <div key={x.id} className="vitals">{[x.bp_systolic && ['BP', `${x.bp_systolic}/${x.bp_diastolic}`], x.pulse && ['PR', x.pulse], x.temp_c && ['Temp', `${x.temp_c}°C`], x.weight_kg && ['Wt', `${x.weight_kg}kg`], x.rbs_mgdl && ['RBS', x.rbs_mgdl]].filter(Boolean).map((c: any) => <span key={c[0]} className="chip"><span className="chip-label">{c[0]}</span><b>{c[1]}</b></span>)}</div>)}
              {v.visit_notes?.map((n: any) => <div key={n.id} className="entry"><div className="entry-head"><span className="entry-kind">{KIND[n.kind] ?? n.kind}</span>{status(n)}</div>
                {editing('visit_notes', n) ? <form onSubmit={saveEdit}><textarea value={edit!.v.body} onChange={setE('body')} required /><div className="form-actions"><button className="btn btn-primary btn-sm">Save correction</button><button type="button" className="btn btn-secondary btn-sm" onClick={() => setEdit(null)}>Cancel</button></div></form> : <>
                  <p>{n.body}</p><small>{who(n)}{corrected(n)}</small>
                  <div className="btns">{canConfirm(n) && <button className="btn btn-secondary btn-sm" onClick={() => confirm('visit_notes', n.id)}><Icon name="check" size={16} />Confirm</button>}{correct('visit_notes', n, ['body'])}</div></>}</div>)}
              {v.prescriptions?.map((r: any) => <div key={r.id} className="entry"><div className="entry-head"><span className="entry-kind">Prescription</span>{status(r)}</div>
                {editing('prescriptions', r) ? <form onSubmit={saveEdit}><label>Drug<input value={edit!.v.drug} onChange={setE('drug')} required /></label><div className="fields"><label>Dose<input value={edit!.v.dose} onChange={setE('dose')} /></label><label>Frequency<input value={edit!.v.frequency} onChange={setE('frequency')} /></label><label>Duration<input value={edit!.v.duration} onChange={setE('duration')} /></label></div>
                  <div className="form-actions"><button className="btn btn-primary btn-sm">Save correction</button><button type="button" className="btn btn-secondary btn-sm" onClick={() => setEdit(null)}>Cancel</button></div></form> : <>
                  <p>{[r.drug, r.dose, r.frequency, r.duration].filter(Boolean).join(' · ')}</p><small>{who(r)}{corrected(r)}</small>
                  <div className="btns">{canConfirm(r) && <button className="btn btn-secondary btn-sm" onClick={() => confirm('prescriptions', r.id)}><Icon name="check" size={16} />Confirm</button>}{correct('prescriptions', r, ['drug', 'dose', 'frequency', 'duration'])}</div></>}</div>)}
              {stay ? <div className="visit-foot"><Icon name="bed" size={18} />Resting since {new Date(stay.admitted_at).toLocaleTimeString([], { timeStyle: 'short' })}{stay.reason ? ` · ${stay.reason}` : ''}</div> :
                admit && admit.visit === v.id ? <form className="visit-foot" onSubmit={admitNow} style={{ flexWrap: 'wrap' }}><Icon name="bed" size={18} />
                  <select className="inline-select" value={admit.bed} onChange={e => setAdmit({ ...admit, bed: e.target.value })} aria-label="Bed" required><option value="">Choose bed…</option>{freeBeds.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
                  <input value={admit.reason} onChange={e => setAdmit({ ...admit, reason: e.target.value })} placeholder="Reason for rest" aria-label="Reason for bed rest" style={{ flex: 1, minWidth: 160, margin: 0 }} />
                  <button className="btn btn-primary btn-sm">Admit</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => setAdmit(null)}>Cancel</button></form> :
                  freeBeds.length > 0 && <div className="visit-foot"><button className="btn btn-secondary btn-sm" onClick={() => setAdmit({ visit: v.id, bed: '', reason: '' })}><Icon name="bed" size={16} />Admit to bed</button></div>}
            </article>
          )
        })}
      </div>
    </>
  )
}
