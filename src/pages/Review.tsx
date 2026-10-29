import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth'
import { supabase } from '../lib/supabase'
import { Avatar, Empty, Icon, Loading, Notice, PageHeader } from '../ui'
const V = 'visits(visit_at, patient_id, patients(full_name)), entered:profiles!entered_by(full_name)'
const KIND: Record<string, string> = { complaint: 'Complaint', nursing: 'Nursing note', diagnosis: 'Diagnosis', medical: "Doctor's note", advice: 'Advice' }
export default function Review() {
  const { profile } = useAuth(); const [items, setItems] = useState<any[] | null>(null); const [err, setErr] = useState('')
  const load = useCallback(async () => {
    const q = (t: string, cols: string) => supabase.from(t).select(`id, created_at, ${cols}, ${V}`).eq('entry_type', 'on_behalf_pending').eq('author_id', profile!.id)
    const [n, r, f] = await Promise.all([q('visit_notes', 'kind, body'), q('prescriptions', 'drug, dose, frequency, duration'), q('referrals', 'destination, reason')])
    const all = [
      ...(n.data ?? []).map((x: any) => ({ ...x, table: 'visit_notes', label: KIND[x.kind] ?? x.kind, text: x.body })),
      ...(r.data ?? []).map((x: any) => ({ ...x, table: 'prescriptions', label: 'Prescription', text: [x.drug, x.dose, x.frequency, x.duration].filter(Boolean).join(' · ') })),
      ...(f.data ?? []).map((x: any) => ({ ...x, table: 'referrals', label: 'Referral', text: [x.destination, x.reason].filter(Boolean).join(' · ') })),
    ].sort((a, b) => a.created_at.localeCompare(b.created_at))
    setItems(all)
  }, [profile])
  useEffect(() => { load() }, [load])
  const done = () => { window.dispatchEvent(new Event('pending-changed')); load() }
  async function confirm(x: any) { const { error } = await supabase.from(x.table).update({ entry_type: 'confirmed' }).eq('id', x.id); if (error) setErr(error.message); else done() }
  async function confirmAll() {
    if (!items || !window.confirm(`Confirm all ${items.length} entries as your own clinical decisions?`)) return
    const res = await Promise.all(items.map(x => supabase.from(x.table).update({ entry_type: 'confirmed' }).eq('id', x.id)))
    const bad = res.find(r => r.error); if (bad) setErr(bad.error!.message); done()
  }
  if (!items) return <Loading />
  return (
    <>
      <PageHeader title="Review" sub="Entries recorded for you by a colleague. Confirm them once you agree they are right." actions={items.length > 1 && <button className="btn btn-primary" onClick={confirmAll}><Icon name="check" size={18} />Confirm all ({items.length})</button>} />
      {err && <Notice tone="error">{err}</Notice>}
      <section className="panel">
        {items.length === 0 ? <Empty icon="check" title="Nothing waiting">Entries recorded on your behalf will appear here.</Empty> :
          <ul className="rows">{items.map(x => (
            <li key={x.table + x.id} className="staff-row">
              <Avatar name={x.visits?.patients?.full_name ?? '?'} />
              <div className="grow"><b><Link to={`/patients/${x.visits?.patient_id}`}>{x.visits?.patients?.full_name}</Link> <small>{new Date(x.visits?.visit_at).toLocaleDateString([], { day: 'numeric', month: 'short' })}</small></b>
                <span><b>{x.label}:</b> {x.text}</span><small>Entered by {x.entered?.full_name} on {new Date(x.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</small></div>
              <button className="btn btn-secondary btn-sm" onClick={() => confirm(x)}><Icon name="check" size={16} />Confirm</button>
            </li>))}</ul>}
      </section>
    </>
  )
}
