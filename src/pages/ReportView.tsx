import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth'
import { supabase } from '../lib/supabase'
import { buildDocx, periodText } from '../lib/docx'
import { Badge, Icon, Loading, Notice, PageHeader } from '../ui'
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
  const back = { to: '/reports', label: 'Reports' }
  if (!r) return <><PageHeader title="Sick Bay Report" back={back} />{msg ? <Notice tone="error">{msg}</Notice> : <Loading />}</>
  return (
    <div className="doc">
      <PageHeader title="Sick Bay Report" back={back} sub={<>{periodText(r.period_from, r.period_to)}</>} actions={<Badge tone={r.status === 'final' ? 'teal' : 'amber'}>{r.status === 'final' ? 'Final' : 'Draft'}</Badge>} />
      <p className="muted" style={{ margin: '-.6rem 0 1.1rem', fontSize: '.88rem' }}>{r.ai_model ? `Narrative drafted by ${r.ai_model}` : 'Plain draft, no AI narrative'}</p>
      {msg && <Notice tone={/not found|fail|error/i.test(msg) ? 'error' : 'info'}>{msg}</Notice>}
      <section className="strip strip-4">{[['Consultations', r.stats.consultations], ['Unique staff', r.stats.unique_patients], ['Major concerns', r.stats.major_concerns], ['Referrals', r.stats.referrals]].map(([k, v]) => <div key={k as string}><b>{v}</b><span>{k}</span></div>)}</section>
      {SECTIONS.map(([k, t]) => <section key={k} className="doc-section"><h2 id={'h-' + k}>{t}</h2>{edit ? <textarea className="tall" aria-labelledby={'h-' + k} value={r[k]} onChange={set(k)} /> : <p className="prose">{r[k]}</p>}</section>)}
      <section className="panel doc-section"><div className="panel-head"><h2>3.0 Consultations ({r.rows.length})</h2></div>
        {r.rows.map((x: any, i: number) => <div key={x.sn} className="entry" style={i === 0 ? { borderTop: 0, paddingTop: 0 } : undefined}><div className="entry-head"><span className="sn">{x.sn}</span><b>{r.include_names ? x.name : 'Staff member'}</b><small>{x.date}</small></div><p>{x.reason}</p><small>{[x.condition, x.concern, x.remark].filter(Boolean).join(' · ')}</small></div>)}</section>
      <div className="action-bar"><button className="btn btn-primary" onClick={download}><Icon name="download" size={18} />Download Word</button><button className="btn btn-secondary" onClick={share}><Icon name="share" size={18} />Share</button></div>
      {edit && <div className="action-bar" style={{ marginTop: '.6rem' }}><button className="btn btn-secondary" onClick={() => save()}>Save changes</button><button className="btn btn-secondary" onClick={finalise}><Icon name="check" size={18} />Finalise</button><button className="btn btn-danger" onClick={remove}>Delete draft</button></div>}
    </div>
  )
}
