import { FormEvent, useState } from 'react'
import { supabase } from '../lib/supabase'
export default function Login() {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('')
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setErr('Email or password is incorrect.'); setBusy(false)
  }
  return (
    <form className="login" onSubmit={submit}>
      <h1>Staff Clinic</h1>
      <p className="muted">Sign in with the account the clinic admin created for you.</p>
      <label>Email<input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" required /></label>
      <label>Password<input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required /></label>
      {err && <p className="err">{err}</p>}
      <button className="primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
    </form>
  )
}
