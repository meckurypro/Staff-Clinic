import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth'
import { supabase } from '../lib/supabase'
import { buildDocx, periodText } from '../lib/docx'
const SECTIONS: [string, string][] = [['summary', '1.0 Executive Summary'], ['trend', '4.0 Trend and Pattern'], ['recommendations', '5.0 Comments and Recommendations'], ['conclusion', '6.0 Conclusion']]
export default function ReportView() {
  const { id } = useParams(); const nav = useNavigate(); const { profile } = useAuth()
  const note = (useLocation().state as any)?.note as string | undefined
  const [r, setR] = useState<any>(null); const [msg, setMsg] = useState(note ?? '')
  const edit = profile?.role !== 'safety_manager' && r?.status === 'draft'
  useEffect(() => { supabase.from('reports').select('*').eq('id', id).maybeSingle().then(x => x.data ? setR(x.data) : setMsg('Report not found.')) }, [id])
  const set = (k: string) => (e: any) => setR({ ...r, [k]: e.target.value })
  async function save(status?: string) {
    const body: any = { summary: r.summary, trend: r.trend, recommendations: r.recommendations, conclusion: r.conclusion }
    if (status) body.status = status
    const { error } = await supabase.from('reports').update(body).eq('id', id)
    if (error) return setMsg(error.message); setMsg(status ? 'Report finalised.' : 'Saved.')
    if (status) setR({ ...r, status })
  }
  async function finalise() { if (window.confirm('Finalise this report? It becomes visible to the Safety Manager and can no longer be edited.')) save('final') }
  async function remove() { if (window.confirm('Delete this draft?')) { await supabase.from('reports').delete().eq('id', id); nav('/reports') } }
  const file = () => buildDocx(r)
  async function download() { try { const f = await file(); const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name; a.click(); URL.revokeObjectURL(a.href) } catch (e: any) { setMsg(e.message) } }
  async function share() {
    try { const f = await file(); if (navigator.canShare?.({ files: [f] })) await navigator.share({ files: [f], title: f.name }); else await download() }
    catch (e: any) { if (e?.name !== 'AbortError') setMsg(e.message) }
  }
  if (!r) return <><Link to="/reports" className="back">← Reports</Link><p className="muted">{msg || 'Loading…'}</p></>
  return (
    <>
      <Link to="/reports" className="back">← Reports</Link>
      <h1>Sick Bay Report</h1>
      <p className="muted">{periodText(r.period_from, r.period_to)} · {r.status === 'final' ? 'Final' : 'Draft'}{r.ai_model ? ` · narrative by ${r.ai_model}` : ' · plain draft'}</p>
      {msg && <p className="note-msg" role="status">{msg}</p>}
      <section className="statgrid">{[['Consultations', r.stats.consultations], ['Unique staff', r.stats.unique_patients], ['Major concerns', r.stats.major_concerns], ['Referrals', r.stats.referrals]].map(([k, v]) => <div key={k as string}><b>{v}</b><span>{k}</span></div>)}</section>
      {SECTIONS.map(([k, t]) => <label key={k}><b>{t}</b>{edit ? <textarea className="tall" value={r[k]} onChange={set(k)} /> : <span className="prose">{r[k]}</span>}</label>)}
      <section className="card"><h2>3.0 Consultations ({r.rows.length})</h2>
        {r.rows.map((x: any) => <div key={x.sn} className="note"><b>{x.sn}. {r.include_names ? x.name : ''} <span className="muted">{x.date}</span></b>{x.reason}<small>{[x.condition, x.concern, x.remark].filter(Boolean).join(' · ')}</small></div>)}</section>
      <div className="row"><button className="primary" onClick={download}>Download Word</button><button className="sm" onClick={share}>Share</button></div>
      {edit && <div className="row"><button className="sm" onClick={() => save()}>Save changes</button><button className="sm" onClick={finalise}>Finalise</button><button className="sm" onClick={remove}>Delete draft</button></div>}
    </>
  )
}
