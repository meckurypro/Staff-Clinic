import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth'
import { supabase, initials, minsSince, fmtMins, today } from '../lib/supabase'
export default function Home() {
  const { profile } = useAuth()
  const [beds, setBeds] = useState<any[]>([]); const [stays, setStays] = useState<any[]>([])
  const [stats, setStats] = useState<any>(null); const [, tick] = useState(0)
  const load = useCallback(async () => {
    const [b, s, st] = await Promise.all([
      supabase.from('beds').select('*').eq('active', true).order('id'),
      supabase.from('bed_stays').select('id,bed_id,admitted_at,reason,visits(patient_id,patients(full_name))').is('discharged_at', null),
      supabase.rpc('weekly_stats', { p_from: today(), p_to: today() }),
    ])
    setBeds(b.data ?? []); setStays(s.data ?? []); setStats(st.data)
  }, [])
  useEffect(() => { load(); const t = setInterval(() => tick(n => n + 1), 30000); return () => clearInterval(t) }, [load])
  async function discharge(id: string) {
    await supabase.from('bed_stays').update({ discharged_at: new Date().toISOString(), discharged_by: profile?.id, outcome: 'back_to_work' }).eq('id', id)
    load()
  }
  const hour = new Date().getHours()
  return (
    <>
      <h1>{hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'}, {profile?.full_name.split(' ')[0]}</h1>
      <section className="beds">
        <h2>Beds</h2>
        <div className="bedgrid">
          {beds.map(b => {
            const s = stays.find(x => x.bed_id === b.id)
            const p = s?.visits?.patients
            return (
              <div key={b.id} className={'bed ' + (s ? 'busy' : 'free')}>
                <small>{b.name}</small>
                {s ? <>
                  <Link to={`/patients/${s.visits.patient_id}`} className="ini">{initials(p?.full_name ?? '?')}</Link>
                  <span>{fmtMins(minsSince(s.admitted_at))} resting</span>
                  <button onClick={() => discharge(s.id)}>Discharge</button>
                </> : <span className="muted">Free</span>}
              </div>
            )
          })}
        </div>
      </section>
      <section className="stats">
        <div><b>{stats?.consultations ?? 0}</b><span>seen today</span></div>
        <div><b>{stats?.unique_patients ?? 0}</b><span>patients</span></div>
        <div><b>{stats?.repeat_visits ?? 0}</b><span>repeat</span></div>
        <div><b>{stats?.referrals ?? 0}</b><span>referred</span></div>
      </section>
      <Link className="primary block" to="/patients">Find or register a patient</Link>
    </>
  )
}
