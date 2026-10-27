import { FormEvent, useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth } from '../auth'
import { supabase } from '../lib/supabase'
import { Avatar, Badge, Icon, Loading, Notice, Spinner } from '../ui'
import { Link } from 'react-router-dom'
const blank = { when: '', diag: '', concern: '', remark: '', bp: '', pulse: '', temp: '', weight: '', rbs: '', complaint: '', nursing: '', doctor: '', drug: '', dose: '', freq: '', dur: '' }
const KIND: Record<string, string> = { complaint: 'Complaint', nursing: 'Nursing note', diagnosis: 'Diagnosis', medical: "Doctor's note" }
export default function PatientDetail() {
  const { id } = useParams(); const { profile } = useAuth()
  const [p, setP] = useState<any>(null); const [visits, setVisits] = useState<any[]>([])
  const [freeBeds, setFreeBeds] = useState<any[]>([]); const [f, setF] = useState<any>(blank)
  const [open, setOpen] = useState(false); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    const [a, v, b, s] = await Promise.all([
      supabase.from('patients').select('*, departments(name)').eq('id', id).single(),
      supabase.from('visits').select('*, vitals(*), prescriptions(*, entered:profiles!entered_by(full_name), author:profiles!author_id(full_name)), visit_notes(*, entered:profiles!entered_by(full_name), author:profiles!author_id(full_name)), bed_stays(*)').eq('patient_id', id).order('visit_at', { ascending: false }),
      supabase.from('beds').select('*').eq('active', true).order('id'),
      supabase.from('bed_stays').select('bed_id').is('discharged_at', null),
    ])
    setP(a.data); setVisits(v.data ?? [])
    const used = new Set((s.data ?? []).map((x: any) => x.bed_id)); setFreeBeds((b.data ?? []).filter((x: any) => !used.has(x.id)))
  }, [id])
  useEffect(() => { load() }, [load])
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value })
  async function saveVisit(e: FormEvent) {
    e.preventDefault(); setErr(''); setBusy(true)
    const nurse = profile?.role === 'nurse'
    let attr: any = { entry_type: 'original' }
    if (nurse && (f.doctor || f.drug || f.diag)) {
      const d = await supabase.from('profiles').select('id').eq('role', 'doctor').eq('is_active', true).limit(1)
      if (!d.data?.[0]) { setBusy(false); setErr('No doctor account exists yet, so doctor entries cannot be saved.'); return }
      attr = { entry_type: 'on_behalf_pending', author_id: d.data[0].id }
    }
    const v = await supabase.from('visits').insert({ patient_id: id, created_by: profile?.id, visit_at: f.when ? new Date(f.when).toISOString() : undefined, major_concern: f.concern || null, remark: f.remark || null }).select('id').single()
    if (v.error) { setBusy(false); setErr(v.error.message); return }
    const vid = v.data.id; const [sys, dia] = f.bp.split('/')
    const n = (x: string) => (x ? +x : null)
    const jobs: any[] = []
    if (f.bp || f.pulse || f.temp || f.weight || f.rbs) jobs.push(supabase.from('vitals').insert({ visit_id: vid, bp_systolic: n(sys), bp_diastolic: n(dia), pulse: n(f.pulse), temp_c: n(f.temp), weight_kg: n(f.weight), rbs_mgdl: n(f.rbs), recorded_by: profile?.id }))
    if (f.complaint) jobs.push(supabase.from('visit_notes').insert({ visit_id: vid, kind: 'complaint', body: f.complaint, entry_type: 'original' }))
    if (f.nursing) jobs.push(supabase.from('visit_notes').insert({ visit_id: vid, kind: 'nursing', body: f.nursing, entry_type: 'original' }))
    if (f.diag) jobs.push(supabase.from('visit_notes').insert({ visit_id: vid, kind: 'diagnosis', body: f.diag, ...attr }))
    if (f.doctor) jobs.push(supabase.from('visit_notes').insert({ visit_id: vid, kind: 'medical', body: f.doctor, ...attr }))
    if (f.drug) jobs.push(supabase.from('prescriptions').insert({ visit_id: vid, drug: f.drug, dose: f.dose, frequency: f.freq, duration: f.dur, ...attr }))
    const res = await Promise.all(jobs); const bad = res.find(r => r.error)
    setBusy(false)
    if (bad) { setErr(bad.error.message); return }
    setF(blank); setOpen(false); load()
  }
  async function admit(visitId: string, bedId: string) {
    if (!bedId) return
    const r = await supabase.from('bed_stays').insert({ visit_id: visitId, bed_id: +bedId, admitted_by: profile?.id })
    if (r.error) setErr(r.error.message); else load()
  }
  async function confirm(table: string, rowId: string) { await supabase.from(table).update({ entry_type: 'confirmed' }).eq('id', rowId); load() }
  const who = (r: any) => r.entry_type === 'transcribed' && !r.author_id ? 'Imported from the clinic Excel records' : r.entry_type === 'on_behalf_pending' ? `Entered by ${r.entered?.full_name} for ${r.author?.full_name}`
    : r.entry_type === 'confirmed' ? r.author?.full_name : r.author?.full_name
  const status = (r: any) => r.entry_type === 'on_behalf_pending' ? <Badge tone="amber">Awaiting review</Badge> : r.entry_type === 'confirmed' ? <Badge tone="teal">Confirmed</Badge> : null
  const canConfirm = (r: any) => r.entry_type === 'on_behalf_pending' && r.author_id === profile?.id
  if (!p) return <Loading />
  const chips = [p.sex && p.sex[0].toUpperCase() + p.sex.slice(1), p.approx_age && p.approx_age + ' yrs', p.departments?.name, p.staff_id, p.phone].filter(Boolean)
  return (
    <>
      <Link to="/patients" className="back"><Icon name="back" size={16} />Patients</Link>
      <section className="panel patient-hero">
        <Avatar name={p.full_name} size={64} />
        <div className="who"><h1>{p.full_name}</h1><div className="chips">{chips.map((c: string) => <span key={c} className="chip">{c}</span>)}</div></div>
        {!open && <button className="btn btn-primary" onClick={() => setOpen(true)}><Icon name="plus" size={18} />New visit</button>}
      </section>
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
          <label>Nursing note<textarea value={f.nursing} onChange={set('nursing')} /></label>
          <label>Doctor's note{profile?.role === 'nurse' && <small> (saved as entered by you for the doctor)</small>}<textarea value={f.doctor} onChange={set('doctor')} /></label>
          <label>Diagnosis / medical condition{profile?.role === 'nurse' && <small> (saved as entered by you for the doctor)</small>}<input value={f.diag} onChange={set('diag')} /></label>
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
              <div className="visit-head"><h3>{new Date(v.visit_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</h3>{stay && <Badge tone="amber" dot>Resting</Badge>}</div>
              {v.major_concern && <div className="concern"><Icon name="alert" size={18} /><span>Major concern: {v.major_concern}</span></div>}
              {v.remark && <p className="remark">{v.remark}</p>}
              {v.vitals?.map((x: any) => <div key={x.id} className="vitals">{[x.bp_systolic && ['BP', `${x.bp_systolic}/${x.bp_diastolic}`], x.pulse && ['PR', x.pulse], x.temp_c && ['Temp', `${x.temp_c}°C`], x.weight_kg && ['Wt', `${x.weight_kg}kg`], x.rbs_mgdl && ['RBS', x.rbs_mgdl]].filter(Boolean).map((c: any) => <span key={c[0]} className="chip"><span className="chip-label">{c[0]}</span><b>{c[1]}</b></span>)}</div>)}
              {v.visit_notes?.map((n: any) => <div key={n.id} className="entry"><div className="entry-head"><span className="entry-kind">{KIND[n.kind] ?? n.kind}</span>{status(n)}</div><p>{n.body}</p><small>{who(n)}</small>{canConfirm(n) && <button className="btn btn-secondary btn-sm" onClick={() => confirm('visit_notes', n.id)}><Icon name="check" size={16} />Confirm</button>}</div>)}
              {v.prescriptions?.map((r: any) => <div key={r.id} className="entry"><div className="entry-head"><span className="entry-kind">Prescription</span>{status(r)}</div><p>{[r.drug, r.dose, r.frequency, r.duration].filter(Boolean).join(' · ')}</p><small>{who(r)}</small>{canConfirm(r) && <button className="btn btn-secondary btn-sm" onClick={() => confirm('prescriptions', r.id)}><Icon name="check" size={16} />Confirm</button>}</div>)}
              {stay ? <div className="visit-foot"><Icon name="bed" size={18} />Resting since {new Date(stay.admitted_at).toLocaleTimeString([], { timeStyle: 'short' })}</div> :
                freeBeds.length > 0 && <div className="visit-foot"><Icon name="bed" size={18} /><select className="inline-select" defaultValue="" aria-label="Admit to bed" onChange={e => admit(v.id, e.target.value)}><option value="">Admit to bed…</option>{freeBeds.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>}
            </article>
          )
        })}
      </div>
    </>
  )
}
