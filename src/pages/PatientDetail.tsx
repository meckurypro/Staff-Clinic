import { FormEvent, useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth } from '../auth'
import { supabase } from '../lib/supabase'
const blank = { bp: '', pulse: '', temp: '', weight: '', rbs: '', complaint: '', nursing: '', doctor: '', drug: '', dose: '', freq: '', dur: '' }
export default function PatientDetail() {
  const { id } = useParams(); const { profile } = useAuth()
  const [p, setP] = useState<any>(null); const [visits, setVisits] = useState<any[]>([])
  const [freeBeds, setFreeBeds] = useState<any[]>([]); const [f, setF] = useState<any>(blank)
  const [open, setOpen] = useState(false); const [err, setErr] = useState('')
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
    e.preventDefault(); setErr('')
    const nurse = profile?.role === 'nurse'
    let attr: any = { entry_type: 'original' }
    if (nurse && (f.doctor || f.drug)) {
      const d = await supabase.from('profiles').select('id').eq('role', 'doctor').eq('is_active', true).limit(1)
      if (!d.data?.[0]) { setErr('No doctor account exists yet, so doctor entries cannot be saved.'); return }
      attr = { entry_type: 'on_behalf_pending', author_id: d.data[0].id }
    }
    const v = await supabase.from('visits').insert({ patient_id: id, created_by: profile?.id }).select('id').single()
    if (v.error) { setErr(v.error.message); return }
    const vid = v.data.id; const [sys, dia] = f.bp.split('/')
    const n = (x: string) => (x ? +x : null)
    const jobs: any[] = []
    if (f.bp || f.pulse || f.temp || f.weight || f.rbs) jobs.push(supabase.from('vitals').insert({ visit_id: vid, bp_systolic: n(sys), bp_diastolic: n(dia), pulse: n(f.pulse), temp_c: n(f.temp), weight_kg: n(f.weight), rbs_mgdl: n(f.rbs), recorded_by: profile?.id }))
    if (f.complaint) jobs.push(supabase.from('visit_notes').insert({ visit_id: vid, kind: 'complaint', body: f.complaint, entry_type: 'original' }))
    if (f.nursing) jobs.push(supabase.from('visit_notes').insert({ visit_id: vid, kind: 'nursing', body: f.nursing, entry_type: 'original' }))
    if (f.doctor) jobs.push(supabase.from('visit_notes').insert({ visit_id: vid, kind: 'medical', body: f.doctor, ...attr }))
    if (f.drug) jobs.push(supabase.from('prescriptions').insert({ visit_id: vid, drug: f.drug, dose: f.dose, frequency: f.freq, duration: f.dur, ...attr }))
    const res = await Promise.all(jobs); const bad = res.find(r => r.error)
    if (bad) { setErr(bad.error.message); return }
    setF(blank); setOpen(false); load()
  }
  async function admit(visitId: string, bedId: string) {
    if (!bedId) return
    const r = await supabase.from('bed_stays').insert({ visit_id: visitId, bed_id: +bedId, admitted_by: profile?.id })
    if (r.error) setErr(r.error.message); else load()
  }
  async function confirm(table: string, rowId: string) { await supabase.from(table).update({ entry_type: 'confirmed' }).eq('id', rowId); load() }
  const who = (r: any) => r.entry_type === 'on_behalf_pending' ? `Entered by ${r.entered?.full_name} for ${r.author?.full_name}, awaiting review`
    : r.entry_type === 'confirmed' ? `${r.author?.full_name}, confirmed` : r.author?.full_name
  if (!p) return <p className="muted">Loading…</p>
  return (
    <>
      <h1>{p.full_name}</h1>
      <p className="muted">{[p.sex, p.approx_age && p.approx_age + ' yrs', p.departments?.name, p.staff_id, p.phone].filter(Boolean).join(' · ')}</p>
      {!open ? <button className="primary block" onClick={() => setOpen(true)}>New visit</button> :
        <form className="card" onSubmit={saveVisit}>
          <h2>New visit</h2>
          <div className="row"><label>BP<input placeholder="120/80" value={f.bp} onChange={set('bp')} /></label><label>Pulse<input type="number" value={f.pulse} onChange={set('pulse')} /></label></div>
          <div className="row"><label>Temp °C<input type="number" step="0.1" value={f.temp} onChange={set('temp')} /></label><label>Weight kg<input type="number" step="0.1" value={f.weight} onChange={set('weight')} /></label><label>RBS<input type="number" step="0.1" value={f.rbs} onChange={set('rbs')} /></label></div>
          <label>Complaint<textarea value={f.complaint} onChange={set('complaint')} required /></label>
          <label>Nursing note<textarea value={f.nursing} onChange={set('nursing')} /></label>
          <label>Doctor's note{profile?.role === 'nurse' && <small> (saved as entered by you for the doctor)</small>}<textarea value={f.doctor} onChange={set('doctor')} /></label>
          <label>Prescription — drug<input value={f.drug} onChange={set('drug')} /></label>
          <div className="row"><label>Dose<input value={f.dose} onChange={set('dose')} /></label><label>Frequency<input value={f.freq} onChange={set('freq')} /></label><label>Duration<input value={f.dur} onChange={set('dur')} /></label></div>
          {err && <p className="err">{err}</p>}
          <button className="primary">Save visit</button>
        </form>}
      {err && !open && <p className="err">{err}</p>}
      {visits.map(v => {
        const stay = v.bed_stays?.find((s: any) => !s.discharged_at)
        return (
          <article key={v.id} className="card">
            <h3>{new Date(v.visit_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</h3>
            {v.vitals?.map((x: any) => <p key={x.id} className="vit">{[x.bp_systolic && `BP ${x.bp_systolic}/${x.bp_diastolic}`, x.pulse && `PR ${x.pulse}`, x.temp_c && `${x.temp_c}°C`, x.weight_kg && `${x.weight_kg}kg`, x.rbs_mgdl && `RBS ${x.rbs_mgdl}`].filter(Boolean).join(' · ')}</p>)}
            {v.visit_notes?.map((n: any) => <div key={n.id} className="note"><b>{n.kind}</b> {n.body}<small>{who(n)}</small>{n.entry_type === 'on_behalf_pending' && n.author_id === profile?.id && <button onClick={() => confirm('visit_notes', n.id)}>Confirm</button>}</div>)}
            {v.prescriptions?.map((r: any) => <div key={r.id} className="note"><b>Rx</b> {[r.drug, r.dose, r.frequency, r.duration].filter(Boolean).join(' ')}<small>{who(r)}</small>{r.entry_type === 'on_behalf_pending' && r.author_id === profile?.id && <button onClick={() => confirm('prescriptions', r.id)}>Confirm</button>}</div>)}
            {stay ? <p className="muted">Resting since {new Date(stay.admitted_at).toLocaleTimeString([], { timeStyle: 'short' })}</p> :
              freeBeds.length > 0 && <select defaultValue="" onChange={e => admit(v.id, e.target.value)}><option value="">Admit to bed…</option>{freeBeds.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select>}
          </article>
        )
      })}
    </>
  )
}
