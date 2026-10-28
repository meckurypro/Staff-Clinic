import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth'
import { supabase } from '../lib/supabase'
import { buildDocx, periodText } from '../lib/docx'
import { buildPdf } from '../lib/pdf'
import { Badge, Icon, Loading, Notice, PageHeader } from '../ui'
const b64 = async (f: File) => { const b = new Uint8Array(await f.arrayBuffer()); let t = ''; for (let i = 0; i < b.length; i += 0x8000) t += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(t) }
const SECTIONS: [string, string][] = [['summary', '1.0 Executive Summary'], ['trend', '4.0 Trend and Pattern'], ['recommendations', '5.0 Comments and Recommendations'], ['conclusion', '6.0 Conclusion']]
export default function ReportView() {
  const { id } = useParams(); const nav = useNavigate(); const { profile } = useAuth()
  const note = (useLocation().state as any)?.note as string | undefined
  const [r, setR] = useState<any>(null); const [msg, setMsg] = useState(note ?? '')
  const [mail, setMail] = useState<any>({ recipients: [] }); const [sent, setSent] = useState<any[]>([]); const [pick, setPick] = useState<string[]>([]); const [text, setText] = useState(''); const [sending, setSending] = useState(false)
  const edit = profile?.role !== 'safety_manager' && r?.status === 'draft'
  useEffect(() => { supabase.from('reports').select('*').eq('id', id).maybeSingle().then(x => x.data ? setR(x.data) : setMsg('Report not found.')) }, [id])
  const loadSent = () => supabase.from('report_emails').select('*').eq('report_id', id).order('sent_at', { ascending: false }).then(x => setSent(x.data ?? []))
  useEffect(() => {
    if (r?.status !== 'final' || profile?.role === 'safety_manager') return
    supabase.from('app_settings').select('value').eq('key', 'report_email').maybeSingle().then(x => x.data && setMail(x.data.value)); loadSent()
  }, [r?.status, id, profile?.role])
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
  async function downloadPdf() { try { const f = await buildPdf(r); const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name; a.click(); URL.revokeObjectURL(a.href) } catch (e: any) { setMsg(e.message) } }
  async function email() {
    if (!pick.length) return setMsg('Choose at least one recipient (error).'); setSending(true); setMsg('Sending…')
    try {
      const files = await Promise.all([buildDocx(r), buildPdf(r)])
      const { data, error } = await supabase.functions.invoke('send-report', { body: { report_id: id, to: pick, message: text, attachments: await Promise.all(files.map(async f => ({ filename: f.name, content: await b64(f) }))) } })
      let t = data?.error ?? error?.message; if (error && (error as any).context?.json) t = (await (error as any).context.json().catch(() => null))?.error ?? t
      setMsg(t ? `Email failed: ${t}` : 'Report emailed.'); if (!t) { setPick([]); setText(''); loadSent() }
    } catch (e: any) { setMsg(`Email failed: ${e.message}`) }
    setSending(false)
  }
  async function share() {
    try { const fs = [await file(), await buildPdf(r)]; if (navigator.canShare?.({ files: fs })) await navigator.share({ files: fs, title: fs[0].name }); else await download() }
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
      <div className="action-bar"><button className="btn btn-primary" onClick={download}><Icon name="download" size={18} />Download Word</button><button className="btn btn-secondary" onClick={downloadPdf}><Icon name="download" size={18} />Download PDF</button><button className="btn btn-secondary" onClick={share}><Icon name="share" size={18} />Share</button></div>
      {r.status === 'final' && profile?.role !== 'safety_manager' && <section className="panel doc-section"><div className="panel-head"><h2>Email this report</h2></div>
        {mail.recipients?.length ? mail.recipients.map((x: any) => <label key={x.email} className="check" style={{ marginBottom: '.6rem' }}><input type="checkbox" checked={pick.includes(x.email)} onChange={e => setPick(e.target.checked ? [...pick, x.email] : pick.filter(y => y !== x.email))} /><span>{x.name} <small className="muted">{x.email}</small></span></label>) : <p className="muted">No approved recipients yet. An admin adds them under Admin, Email reports.</p>}
        <label style={{ marginTop: '.6rem' }}>Message <small>(optional)</small><textarea value={text} onChange={e => setText(e.target.value)} /></label>
        <button className="btn btn-primary" onClick={email} disabled={sending || !mail.recipients?.length}>{sending ? 'Sending…' : 'Send Word and PDF'}</button>
        {sent.map(x => <p key={x.id} className="muted" style={{ marginTop: '.5rem' }}>{x.status === 'sent' ? 'Sent' : 'Failed'} to {x.to_addrs.join(', ')} on {new Date(x.sent_at).toLocaleString()}</p>)}</section>}
      {edit && <div className="action-bar" style={{ marginTop: '.6rem' }}><button className="btn btn-secondary" onClick={() => save()}>Save changes</button><button className="btn btn-secondary" onClick={finalise}><Icon name="check" size={18} />Finalise</button><button className="btn btn-danger" onClick={remove}>Delete draft</button></div>}
    </div>
  )
}
