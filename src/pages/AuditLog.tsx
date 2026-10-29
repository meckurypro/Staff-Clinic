import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Empty, Loading, PageHeader } from '../ui'
const TABLES = ['patients', 'visits', 'vitals', 'visit_notes', 'prescriptions', 'referrals', 'bed_stays', 'reports', 'profiles', 'staff_invites', 'ai_settings', 'backup', 'import', 'secrets', 'ai_keys']
const HIDE = new Set(['edited_at', 'edited_by', 'created_at', 'entered_by', 'is_demo'])
const short = (v: any) => { const s = v == null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v); return s.length > 90 ? s.slice(0, 90) + '…' : s }
function summary(r: any): string {
  const o = r.old_data, n = r.new_data
  if (r.action === 'UPDATE' && o && n) {
    const ch = Object.keys(n).filter(k => !HIDE.has(k) && JSON.stringify(o[k]) !== JSON.stringify(n[k]))
    return ch.length ? ch.map(k => `${k}: ${short(o[k])} → ${short(n[k])}`).join('\n') : 'No visible change'
  }
  const d = n ?? o ?? {}; const main = d.full_name ?? d.body ?? d.drug ?? d.destination ?? d.email ?? d.name ?? d.period_from
  if (r.action === 'MERGE') return `Record of ${o?.full_name ?? 'a patient'} merged into another; ${n?.visits_moved ?? 0} visits moved`
  return main ? short(main) : Object.keys(d).length ? short(d) : ''
}
export default function AuditLog() {
  const [rows, setRows] = useState<any[] | null>(null); const [names, setNames] = useState<Record<string, string>>({})
  const [table, setTable] = useState(''); const [action, setAction] = useState(''); const [limit, setLimit] = useState(100)
  useEffect(() => { supabase.from('profiles').select('id, full_name').then(r => setNames(Object.fromEntries((r.data ?? []).map((p: any) => [p.id, p.full_name])))) }, [])
  useEffect(() => {
    let q = supabase.from('audit_log').select('*').order('at', { ascending: false }).limit(limit)
    if (table) q = q.eq('table_name', table); if (action) q = q.eq('action', action)
    q.then(r => setRows(r.data ?? []))
  }, [table, action, limit])
  const list = useMemo(() => rows ?? [], [rows])
  return (
    <>
      <PageHeader title="Audit trail" sub="Every change to a record, who made it and what it was before." back={{ to: '/admin', label: 'Admin' }} />
      <div className="fields" style={{ marginBottom: '1rem' }}>
        <label>Area<select value={table} onChange={e => { setRows(null); setTable(e.target.value) }}><option value="">Everything</option>{TABLES.map(t => <option key={t}>{t}</option>)}</select></label>
        <label>Action<select value={action} onChange={e => { setRows(null); setAction(e.target.value) }}><option value="">All</option>{['INSERT', 'UPDATE', 'DELETE', 'MERGE', 'IMPORT', 'EXPORT_BACKUP'].map(t => <option key={t}>{t}</option>)}</select></label>
      </div>
      {!rows ? <Loading /> : <section className="panel">
        {list.length === 0 ? <Empty icon="shield" title="No entries">Nothing matches those filters.</Empty> :
          <ul className="rows">{list.map(r => <li key={r.id} className="staff-row"><div className="grow">
            <b>{r.action} · {r.table_name}</b>
            <span style={{ whiteSpace: 'pre-line' }}>{summary(r)}</span>
            <small>{new Date(r.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} · {r.user_id ? names[r.user_id] ?? 'Former user' : 'System'}</small></div></li>)}</ul>}
        {list.length >= limit && <button className="btn btn-secondary btn-block" onClick={() => setLimit(limit + 100)}>Show more</button>}
      </section>}
    </>
  )
}
