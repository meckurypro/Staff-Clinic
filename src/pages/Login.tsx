import { FormEvent, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Logo, Notice, Spinner } from '../ui'
type Mode = 'in' | 'new' | 'forgot'
export default function Login() {
  const [mode, setMode] = useState<Mode>('in')
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('')
  const [err, setErr] = useState(''); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr(''); setNote('')
    const addr = email.trim().toLowerCase()
    if (mode === 'in') {
      const { error } = await supabase.auth.signInWithPassword({ email: addr, password })
      if (error) setErr(error.message.toLowerCase().includes('confirm') ? 'Confirm your email first: open the link we sent you.' : 'Email or password is incorrect.')
    } else if (mode === 'new') {
      if (password.length < 8) setErr('Use at least 8 characters.')
      else {
        const { error } = await supabase.auth.signUp({ email: addr, password, options: { emailRedirectTo: window.location.origin } })
        if (error) setErr(error.message)
        else setNote('Check your email and open the confirmation link. Then come back here and sign in.')
      }
    } else {
      await supabase.auth.resetPasswordForEmail(addr, { redirectTo: window.location.origin })
      setNote('If that email has an account, a reset link is on its way.')
    }
    setBusy(false)
  }
  const go = (m: Mode) => (e: React.MouseEvent) => { e.preventDefault(); setMode(m); setErr(''); setNote('') }
  const title = { in: 'Sign in', new: 'Set your password', forgot: 'Reset your password' }[mode]
  const lead = { in: 'Welcome back. Sign in to open the clinic.', new: 'Use the email address the clinic admin added for you.', forgot: 'Enter your email and we will send you a reset link.' }[mode]
  const cta = busy ? 'Please wait…' : mode === 'in' ? 'Sign in' : mode === 'new' ? 'Create password' : 'Send reset link'
  return (
    <div className="auth">
      <div className="auth-brand">
        <div className="brand"><Logo size={40} /><span><b>Staff Clinic</b></span></div>
        <div>
          <h2>Healthy staff. Productive workplace.</h2>
          <p>Visit records, bed rest tracking and weekly sick bay reports, all in one place.</p>
          <svg className="ecg" viewBox="0 0 600 80" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M0 44h170l24-32 34 64 30-48 20 16h322" /></svg>
        </div>
        <span />
      </div>
      <div className="auth-main">
        <form className="auth-card" onSubmit={submit}>
          <h1>{title}</h1>
          <p className="lead">{lead}</p>
          <label>Email<input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" placeholder="you@company.com" required /></label>
          {mode !== 'forgot' && <label>{mode === 'new' ? 'Choose a password' : 'Password'}<input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete={mode === 'new' ? 'new-password' : 'current-password'} placeholder={mode === 'new' ? 'At least 8 characters' : ''} required /></label>}
          {err && <Notice tone="error">{err}</Notice>}{note && <Notice tone="ok">{note}</Notice>}
          <button className="btn btn-primary btn-block" disabled={busy}>{busy && <Spinner />}{cta}</button>
          <p className="auth-links">
            {mode !== 'in' && <a href="#" onClick={go('in')}>Back to sign in</a>}
            {mode === 'in' && <><a href="#" onClick={go('new')}>First time here?</a><a href="#" onClick={go('forgot')}>Forgot password</a></>}
          </p>
        </form>
      </div>
    </div>
  )
}
