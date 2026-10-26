import { FormEvent, useState } from 'react'
import { supabase } from '../lib/supabase'
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
  const title = { in: 'Sign in', new: 'First time? Set your password', forgot: 'Reset your password' }[mode]
  return (
    <form className="login" onSubmit={submit}>
      <h1>Staff Clinic</h1>
      <h2>{title}</h2>
      {mode === 'new' && <p className="muted">Use the email address the clinic admin added for you.</p>}
      <label>Email<input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" required /></label>
      {mode !== 'forgot' && <label>{mode === 'new' ? 'Choose a password' : 'Password'}<input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete={mode === 'new' ? 'new-password' : 'current-password'} required /></label>}
      {err && <p className="err">{err}</p>}{note && <p className="ok">{note}</p>}
      <button className="primary block" disabled={busy}>{busy ? 'Please wait…' : mode === 'in' ? 'Sign in' : mode === 'new' ? 'Create password' : 'Send reset link'}</button>
      <p className="links">
        {mode !== 'in' && <a href="#" onClick={e => { e.preventDefault(); setMode('in'); setErr(''); setNote('') }}>Back to sign in</a>}
        {mode === 'in' && <><a href="#" onClick={e => { e.preventDefault(); setMode('new') }}>First time here?</a><a href="#" onClick={e => { e.preventDefault(); setMode('forgot') }}>Forgot password</a></>}
      </p>
    </form>
  )
}
