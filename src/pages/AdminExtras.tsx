import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Icon, Notice } from '../ui'

const download = (name: string, data: unknown) => {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' })); a.download = name; a.click(); URL.revokeObjectURL(a.href)
}
const ago = (iso?: string) => { if (!iso) return 'never'; const h = (Date.now() - new Date(iso).getTime()) / 3600000; return h < 1 ? 'less than an hour ago' : h < 48 ? `${Math.round(h)} hours ago` : `${Math.round(h / 24)} days ago` }

export function ClinicSetup() {
  const [depts, setDepts] = useState<any[]>([]); const [beds, setBeds] = useState<any[]>([]); const [reqId, setReqId] = useState(false)
  const [nd, setNd] = useState(''); const [nb, setNb] = useState({ name: '', room: '' }); const [msg, setMsg] = useState('')
  const load = useCallback(async () => {
    const [d, b, s] = await Promise.all([supabase.from('departments').select('*').order('name'), supabase.from('beds').select('*').order('id'), supabase.from('app_settings').select('value').eq('key', 'require_staff_id').maybeSingle()])
    setDepts(d.data ?? []); setBeds(b.data ?? []); setReqId(s.data?.value === true)
  }, [])
  useEffect(() => { load() }, [load])
  const run = async (p: PromiseLike<{ error: any }>, ok: string) => { const { error } = await p; setMsg(error ? (error.code === '23505' ? 'That name already exists.' : error.message) : ok); if (!error) load() }
  const rename = (t: string, r: any) => { const n = window.prompt('New name', r.name)?.trim(); if (n && n !== r.name) run(supabase.from(t).update({ name: n }).eq('id', r.id), 'Renamed.') }
  const Row = ({ t, r }: { t: string; r: any }) => <div className="staff-row"><div className="grow"><b style={{ opacity: r.active ? 1 : .5 }}>{r.name}</b><small>{r.room ?? ''}{r.active ? '' : 'Hidden'}</small></div>
    <button className="btn btn-secondary btn-sm" onClick={() => rename(t, r)}>Rename</button><button className="btn btn-secondary btn-sm" onClick={() => run(supabase.from(t).update({ active: !r.active }).eq('id', r.id), r.active ? 'Hidden from new entries.' : 'Shown again.')}>{r.active ? 'Hide' : 'Show'}</button></div>
  return (
    <section className="panel"><h2 style={{ marginBottom: '.4rem' }}>Clinic setup</h2>
      <p className="muted" style={{ marginBottom: '1rem', maxWidth: '62ch' }}>Departments and beds used across the app. Hiding one keeps old records intact and only removes it from new entries.</p>
      {msg && <Notice tone={/exist|violat|denied|error/i.test(msg) ? 'error' : 'ok'}>{msg}</Notice>}
      <label className="check" style={{ marginBottom: '1.2rem' }}><input type="checkbox" checked={reqId} onChange={e => run(supabase.from('app_settings').upsert({ key: 'require_staff_id', value: e.target.checked }), e.target.checked ? 'Staff ID is now required for new patients.' : 'Staff ID is optional again.')} />Require a staff ID for every new patient</label>
      <h3>Departments</h3>{depts.map(d => <Row key={d.id} t="departments" r={d} />)}
      <div className="fields fields-wide" style={{ margin: '.6rem 0 1.2rem' }}><label>New department<input value={nd} onChange={e => setNd(e.target.value)} /></label><div style={{ alignSelf: 'end' }}><button className="btn btn-secondary btn-sm" disabled={!nd.trim()} onClick={() => run(supabase.from('departments').insert({ name: nd.trim() }), 'Department added.').then(() => setNd(''))}><Icon name="plus" size={16} />Add</button></div></div>
      <h3>Beds</h3>{beds.map(b => <Row key={b.id} t="beds" r={b} />)}
      <div className="fields fields-wide" style={{ marginTop: '.6rem' }}><label>Bed name<input value={nb.name} onChange={e => setNb({ ...nb, name: e.target.value })} /></label><label>Room<input value={nb.room} onChange={e => setNb({ ...nb, room: e.target.value })} placeholder="Male observation room" /></label></div>
      <button className="btn btn-secondary btn-sm" disabled={!nb.name.trim() || !nb.room.trim()} onClick={() => run(supabase.from('beds').insert({ name: nb.name.trim(), room: nb.room.trim() }), 'Bed added.').then(() => setNb({ name: '', room: '' }))}><Icon name="plus" size={16} />Add bed</button>
    </section>
  )
}

export function Duplicates() {
  const [pairs, setPairs] = useState<any[] | null>(null); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false)
  async function scan() { setBusy(true); const r = await supabase.rpc('find_duplicate_patients'); setBusy(false); if (r.error) setMsg(r.error.message); else { setMsg(''); setPairs(r.data ?? []) } }
  async function merge(keep: string, remove: string, label: string) {
    if (!window.confirm(`Keep ${label} and merge the other record into it?\n\nVisits move across and the other record is removed. This is logged.`)) return
    const r = await supabase.rpc('merge_patients', { p_keep: keep, p_remove: remove }); if (r.error) setMsg(r.error.message); else { setMsg('Merged.'); scan() }
  }
  const side = (id: string, name: string, dept: string, v: number, other: string) => <div className="grow"><b><Link to={`/patients/${id}`}>{name}</Link></b><small>{dept ?? 'No department'} · {v} visit{v === 1 ? '' : 's'}</small><button className="btn btn-secondary btn-sm" style={{ marginTop: '.4rem' }} onClick={() => merge(id, other, name)}>Keep this one</button></div>
  return (
    <section className="panel"><h2 style={{ marginBottom: '.4rem' }}>Possible duplicate patients</h2>
      <p className="muted" style={{ marginBottom: '1rem', maxWidth: '62ch' }}>Finds records with very similar names, such as after the Excel import. Check each pair before merging.</p>
      <button className="btn btn-secondary" onClick={scan} disabled={busy}>{busy ? 'Looking…' : 'Look for duplicates'}</button>
      {msg && <Notice tone={msg === 'Merged.' ? 'ok' : 'error'}>{msg}</Notice>}
      {pairs && (pairs.length === 0 ? <p className="muted" style={{ marginTop: '.8rem' }}>No likely duplicates found.</p> : pairs.map(p => <div key={p.id_a + p.id_b} className="staff-row" style={{ alignItems: 'flex-start' }}>
        {side(p.id_a, p.name_a, p.dept_a, Number(p.visits_a), p.id_b)}{side(p.id_b, p.name_b, p.dept_b, Number(p.visits_b), p.id_a)}<small className="muted">{Math.round(p.score * 100)}% alike</small></div>))}
    </section>
  )
}

export function Backups() {
  const [snaps, setSnaps] = useState<any[]>([]); const [last, setLast] = useState<string>(); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    const [s, l] = await Promise.all([supabase.rpc('list_snapshots'), supabase.from('app_settings').select('value').eq('key', 'last_backup_download').maybeSingle()])
    setSnaps(s.data ?? []); setLast(l.data?.value?.at)
  }, [])
  useEffect(() => { load() }, [load])
  async function now() {
    setBusy(true); const r = await supabase.rpc('export_backup'); setBusy(false)
    if (r.error) return setMsg(r.error.message)
    download(`staff-clinic-backup-${new Date().toLocaleDateString('en-CA')}.json`, r.data)
    await supabase.from('app_settings').upsert({ key: 'last_backup_download', value: { at: new Date().toISOString() } }); setMsg('Backup downloaded. Keep the file somewhere safe and private.'); load()
  }
  async function snap(s: any) { const r = await supabase.rpc('get_snapshot', { p_id: s.id }); if (r.error) setMsg(r.error.message); else download(`staff-clinic-snapshot-${s.taken_at.slice(0, 10)}.json`, r.data) }
  const stale = !last || Date.now() - new Date(last).getTime() > 7 * 86400000
  return (
    <section className="panel"><h2 style={{ marginBottom: '.4rem' }}>Backups</h2>
      <p className="muted" style={{ marginBottom: '1rem', maxWidth: '62ch' }}>A snapshot of all records is saved inside the database every night (the last 14 days are kept), which protects against accidental deletion. It does not protect against losing the project itself, so also download a copy to a safe place each week.</p>
      {msg && <Notice tone={/denied|error|admin/i.test(msg) ? 'error' : 'ok'}>{msg}</Notice>}
      {stale && <Notice tone="info">{last ? `Your last downloaded backup was ${ago(last)}.` : 'You have not downloaded a backup yet.'}</Notice>}
      <button className="btn btn-primary" onClick={now} disabled={busy}><Icon name="download" size={18} />{busy ? 'Preparing…' : 'Download full backup now'}</button>
      <p className="muted" style={{ margin: '.6rem 0 1rem' }}>The file contains every staff health record. Do not email it; store it on an encrypted or access-controlled drive.</p>
      <h3>Nightly snapshots</h3>
      {snaps.length === 0 ? <p className="muted">No snapshot yet. The first one is taken tonight.</p> : snaps.map(s => <div key={s.id} className="staff-row"><div className="grow"><b>{new Date(s.taken_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</b><small>{s.counts.patients} patients · {s.counts.visits} visits · {s.size_kb} KB</small></div><button className="btn btn-secondary btn-sm" onClick={() => snap(s)}><Icon name="download" size={16} />Download</button></div>)}
    </section>
  )
}
