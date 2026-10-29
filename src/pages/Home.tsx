import { FormEvent, useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { supabase, initials, minsSince, fmtMins, today } from '../lib/supabase'
import { Avatar, Badge, Empty, Icon, Notice, PageHeader } from '../ui'
import { usePending } from '../lib/pending'
export default function Home() {
  const { profile } = useAuth(); const nav = useNavigate()
  const [beds, setBeds] = useState<any[]>([]); const [stays, setStays] = useState<any[]>([]); const [recent, setRecent] = useState<any[]>([])
  const [dis, setDis] = useState<string | null>(null); const pending = usePending(true, profile?.id)
  const [stats, setStats] = useState<any>(null); const [, tick] = useState(0); const [q, setQ] = useState('')
  const load = useCallback(async () => {
    const [b, s, st, rv] = await Promise.all([
      supabase.from('beds').select('*').eq('active', true).order('id'),
      supabase.from('bed_stays').select('id,bed_id,admitted_at,reason,visits(patient_id,patients(full_name))').is('discharged_at', null),
      supabase.rpc('weekly_stats', { p_from: today(), p_to: today() }),
      supabase.from('visits').select('id,visit_at,patient_id,patients(full_name,staff_id)').order('visit_at', { ascending: false }).limit(5),
    ])
    setBeds(b.data ?? []); setStays(s.data ?? []); setStats(st.data); setRecent(rv.data ?? [])
  }, [])
  useEffect(() => { load(); const t = setInterval(() => tick(n => n + 1), 30000); return () => clearInterval(t) }, [load])
  async function discharge(id: string, outcome: string) {
    await supabase.from('bed_stays').update({ discharged_at: new Date().toISOString(), discharged_by: profile?.id, outcome }).eq('id', id)
    setDis(null); load()
  }
  function find(e: FormEvent) { e.preventDefault(); nav(q.trim() ? `/patients?q=${encodeURIComponent(q.trim())}` : '/patients') }
  const hour = new Date().getHours()
  const date = new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })
  const inUse = beds.filter(b => stays.some(x => x.bed_id === b.id)).length
  const figures: [string, any][] = [['Seen today', stats?.consultations], ['Patients', stats?.unique_patients], ['Repeat visits', stats?.repeat_visits], ['Referred', stats?.referrals]]
  return (
    <>
      <PageHeader title={`${hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'}, ${profile?.full_name.split(' ')[0]}`} sub={date} />
      {pending > 0 && <Notice tone="info"><Link to="/review">{pending} {pending === 1 ? 'entry is' : 'entries are'} waiting for your review</Link></Notice>}
      <form className="finder" onSubmit={find} role="search">
        <div className="finder-field"><Icon name="search" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Name, staff ID or phone" aria-label="Find a patient" /></div>
        <div className="btns"><button className="btn btn-primary">Find patient</button><Link className="btn btn-secondary" to="/patients?new=1"><Icon name="plus" size={18} />Register</Link></div>
      </form>
      <section className="strip strip-4" aria-label="Today at the clinic">
        {figures.map(([k, v]) => <div key={k}><b>{v ?? 0}</b><span>{k}</span></div>)}
      </section>
      <div className="home-grid">
        <section>
          <div className="section-title"><h2>Beds</h2>{beds.length > 0 && <small>{inUse} of {beds.length} in use</small>}</div>
          {beds.length === 0 ? <div className="panel"><Empty icon="bed" title="No beds set up">Beds appear here once they are added to the clinic.</Empty></div> :
            <div className="beds">
              {beds.map(b => {
                const s = stays.find(x => x.bed_id === b.id)
                const p = s?.visits?.patients
                return (
                  <div key={b.id} className={'bed ' + (s ? 'busy' : 'free')}>
                    <div className="bed-top"><span className="bed-name">{b.name}</span>{s ? <Badge tone="amber" dot>Resting</Badge> : <Badge tone="teal" dot>Free</Badge>}</div>
                    {s ? <>
                      <Link to={`/patients/${s.visits.patient_id}`} className="bed-ini" aria-label="Open patient record">{initials(p?.full_name ?? '?')}</Link>
                      <p className="bed-time">{fmtMins(minsSince(s.admitted_at))}<span> resting</span></p>
                      {s.reason && <p className="bed-time" style={{ fontSize: '.8rem' }}><span>{s.reason}</span></p>}
                      {dis === s.id ? <div className="stack">{([['back_to_work', 'Back to work'], ['sent_home', 'Sent home'], ['referred', 'Referred']] as const).map(([o, l]) => <button key={o} className="btn btn-secondary btn-sm" onClick={() => discharge(s.id, o)}>{l}</button>)}<button className="btn btn-ghost btn-sm" onClick={() => setDis(null)}>Cancel</button></div> :
                        <button className="btn btn-secondary btn-sm" onClick={() => setDis(s.id)}>Discharge</button>}
                    </> : <div className="bed-empty"><Icon name="bed" size={28} />Available</div>}
                  </div>
                )
              })}
            </div>}
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Recent visits</h2><Link className="btn btn-ghost btn-sm" to="/patients">All patients</Link></div>
          {recent.length === 0 ? <Empty icon="users" title="No visits yet">Registered patients and their visits will show up here.</Empty> :
            <ul className="rows">{recent.map(v => (
              <li key={v.id}><Link className="row-link" to={`/patients/${v.patient_id}`}>
                <Avatar name={v.patients?.full_name ?? '?'} />
                <div className="grow"><b>{v.patients?.full_name ?? 'Unknown'}</b><span>{v.patients?.staff_id ?? 'No staff ID'} · {new Date(v.visit_at).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span></div>
                <Icon name="chevron" size={18} />
              </Link></li>))}</ul>}
        </section>
      </div>
    </>
  )
}
