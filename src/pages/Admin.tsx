import { FormEvent, useCallback, useEffect, useState } from 'react'
import { useAuth } from '../auth'
import { supabase } from '../lib/supabase'
import { Avatar, Icon, Notice, PageHeader } from '../ui'
import { Link } from 'react-router-dom'
const ROLES: [string, string][] = [['nurse', 'Nurse'], ['doctor', 'Doctor'], ['safety_manager', 'Safety manager']]
const PROVIDERS: [string, string][] = [['anthropic', 'Anthropic (Claude)'], ['openai', 'OpenAI'], ['gemini', 'Google (Gemini)']]
export default function Admin() {
  const { profile } = useAuth()
  const [staff, setStaff] = useState<any[]>([]); const [invites, setInvites] = useState<any[]>([])
  const [models, setModels] = useState<any[]>([]); const [ai, setAi] = useState<any>(null)
  const [keys, setKeys] = useState<Record<string, boolean>>({})
  const [inv, setInv] = useState({ email: '', full_name: '', role: 'doctor', is_admin: false })
  const [apiKey, setApiKey] = useState(''); const [pw, setPw] = useState(''); const [msg, setMsg] = useState('')
  const load = useCallback(async () => {
    const [p, i, m, a, k] = await Promise.all([
      supabase.from('profiles').select('*').order('created_at'),
      supabase.from('staff_invites').select('*').is('claimed_at', null).order('created_at'),
      supabase.from('ai_models').select('*').eq('active', true).order('provider').order('sort'),
      supabase.from('ai_settings').select('*').single(),
      supabase.rpc('admin_ai_key_status'),
    ])
    setStaff(p.data ?? []); setInvites(i.data ?? []); setModels(m.data ?? []); setAi(a.data)
    setKeys(Object.fromEntries((k.data ?? []).map((r: any) => [r.provider, r.has_key])))
  }, [])
  useEffect(() => { load() }, [load])
  const done = (error: any, ok = 'Saved.') => { setMsg(error ? error.message : ok); if (!error) load() }
  async function invite(e: FormEvent) {
    e.preventDefault()
    const r = await supabase.from('staff_invites').insert({ ...inv, email: inv.email.trim().toLowerCase(), full_name: inv.full_name.trim(), created_by: profile?.id })
    done(r.error?.code === '23505' ? { message: 'That email is already invited.' } : r.error, 'Added. They can now set a password on the sign-in page.')
    if (!r.error) setInv({ email: '', full_name: '', role: 'doctor', is_admin: false })
  }
  const rename = async (p: any) => { const n = window.prompt('Full name', p.full_name); if (n?.trim()) done((await supabase.from('profiles').update({ full_name: n.trim() }).eq('id', p.id)).error) }
  const setRole = async (p: any, role: string) => done((await supabase.from('profiles').update({ role }).eq('id', p.id)).error)
  const toggle = async (p: any) => done((await supabase.from('profiles').update({ is_active: !p.is_active }).eq('id', p.id)).error)
  const dropInvite = async (id: string) => done((await supabase.from('staff_invites').delete().eq('id', id)).error, 'Invite removed.')
  const models_ = models.filter(m => m.provider === ai?.provider)
  const pickProvider = (provider: string) => setAi({ ...ai, provider, model_id: models.find(m => m.provider === provider)?.model_id })
  async function saveAi() {
    if (apiKey) { const k = await supabase.rpc('admin_set_ai_key', { p_provider: ai.provider, p_key: apiKey }); if (k.error) return done(k.error); setApiKey('') }
    done((await supabase.from('ai_settings').update({ provider: ai.provider, model_id: ai.model_id, updated_by: profile?.id, updated_at: new Date().toISOString() }).eq('id', true)).error, 'AI settings saved.')
  }
  async function testAi() {
    setMsg('Testing…'); const { data, error } = await supabase.functions.invoke('ai-test')
    let text = data?.error ?? error?.message
    if (error && (error as any).context?.json) text = (await (error as any).context.json().catch(() => null))?.error ?? text
    setMsg(text ? `Test failed: ${text}` : `Working: ${data.model} replied "${data.reply}" in ${data.ms} ms.`)
  }
  async function clearDemo() {
    if (!window.confirm('Delete every demo patient and their visits? Real records are not touched.')) return
    done((await supabase.rpc('clear_demo_data')).error, 'Demo data cleared.')
  }
  async function changePw(e: FormEvent) {
    e.preventDefault(); if (pw.length < 8) return setMsg('Use at least 8 characters.')
    const r = await supabase.auth.updateUser({ password: pw }); if (!r.error) setPw(''); done(r.error, 'Password updated.')
  }
  const sel = models.find(m => m.model_id === ai?.model_id)
  return (
    <>
      <PageHeader title="Admin" sub="Manage who can sign in, how reports are written and your records." back={{ to: '/', label: 'Back to clinic' }} />
      {msg && <Notice tone={/fail|error|already|least|invalid|denied/i.test(msg) ? 'error' : 'ok'}>{msg}</Notice>}
      <div className="stack">
        <section className="panel"><div className="panel-head"><h2>Staff</h2></div>
          {staff.map(p => (
            <div key={p.id} className="staff-row"><Avatar name={p.full_name} /><div className="grow"><b>{p.full_name}</b><small>{p.email}{p.is_active ? '' : ' · inactive'}</small></div>
              <div className="acts"><select className="inline-select" value={p.role} onChange={e => setRole(p, e.target.value)} aria-label={`Role for ${p.full_name}`}>{ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                <button className="btn btn-secondary btn-sm" onClick={() => rename(p)}>Rename</button><button className={'btn btn-sm ' + (p.is_active ? 'btn-danger' : 'btn-secondary')} onClick={() => toggle(p)}>{p.is_active ? 'Deactivate' : 'Activate'}</button></div></div>))}
          {invites.map(i => <div key={i.id} className="staff-row"><Avatar name={i.full_name} /><div className="grow"><b>{i.full_name}</b><small>{i.email} · waiting for first sign-in</small></div><button className="btn btn-secondary btn-sm" onClick={() => dropInvite(i.id)}>Remove</button></div>)}
          <form onSubmit={invite} className="form-group" style={{ marginTop: '.75rem' }}><h3>Add a person</h3>
            <div className="fields fields-wide"><label>Email<input type="email" value={inv.email} onChange={e => setInv({ ...inv, email: e.target.value })} required /></label>
              <label>Full name<input value={inv.full_name} onChange={e => setInv({ ...inv, full_name: e.target.value })} required /></label></div>
            <div className="fields fields-wide"><label>Role<select value={inv.role} onChange={e => setInv({ ...inv, role: e.target.value })}>{ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
              <label>Admin access<select value={String(inv.is_admin)} onChange={e => setInv({ ...inv, is_admin: e.target.value === 'true' })}><option value="false">No</option><option value="true">Yes</option></select></label></div>
            <button className="btn btn-primary"><Icon name="plus" size={18} />Add person</button></form>
        </section>
        {ai && <section className="panel"><h2 style={{ marginBottom: '1rem' }}>AI for reports</h2>
          <div className="fields fields-wide"><label>Provider<select value={ai.provider} onChange={e => pickProvider(e.target.value)}>{PROVIDERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
            <label>Model<select value={ai.model_id} onChange={e => setAi({ ...ai, model_id: e.target.value })}>{models_.map(m => <option key={m.model_id} value={m.model_id}>{m.label} ({m.tier})</option>)}</select></label></div>
          {sel && <p className="muted" style={{ margin: '-.4rem 0 1rem' }}>{sel.note}. Checked {sel.verified_on}.</p>}
          <label>API key {keys[ai.provider] ? <b className="ok">saved</b> : <b className="err">not saved</b>}<input type="password" placeholder={keys[ai.provider] ? 'Leave empty to keep the saved key' : 'Paste key'} value={apiKey} onChange={e => setApiKey(e.target.value)} autoComplete="off" /></label>
          <div className="form-actions"><button className="btn btn-primary" onClick={saveAi}>Save AI settings</button><button className="btn btn-secondary" onClick={testAi}>Test connection</button></div></section>}
        <section className="panel"><h2 style={{ marginBottom: '.4rem' }}>Import old records</h2><p className="muted" style={{ marginBottom: '1rem' }}>Bring in the clinic's Excel consultation sheet, with a review step first.</p><Link className="btn btn-secondary" to="/admin/import">Import from Excel</Link></section>
        <form className="panel" onSubmit={changePw}><h2 style={{ marginBottom: '1rem' }}>My password</h2><label>New password<input type="password" value={pw} onChange={e => setPw(e.target.value)} autoComplete="new-password" /></label><button className="btn btn-secondary">Update password</button></form>
        <section className="panel danger"><h2 style={{ marginBottom: '.4rem' }}>Demo data</h2><p className="muted" style={{ marginBottom: '1rem' }}>Removes only the fictional patients and everything attached to them.</p><button className="btn btn-danger" onClick={clearDemo}>Clear demo data</button></section>
      </div>
    </>
  )
}
