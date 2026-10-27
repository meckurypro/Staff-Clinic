import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth'
import { configured, supabase } from './lib/supabase'
import Login from './pages/Login'
import Home from './pages/Home'
import Patients from './pages/Patients'
import PatientDetail from './pages/PatientDetail'
import Reports from './pages/Reports'
import { FormEvent, Suspense, lazy, useState } from 'react'
const Admin = lazy(() => import('./pages/Admin'))
const ImportExcel = lazy(() => import('./pages/ImportExcel'))
const ReportView = lazy(() => import('./pages/ReportView'))

function SetPassword({ done }: { done: () => void }) {
  const [pw, setPw] = useState(''); const [err, setErr] = useState('')
  async function save(e: FormEvent) {
    e.preventDefault()
    if (pw.length < 8) return setErr('Use at least 8 characters.')
    const { error } = await supabase.auth.updateUser({ password: pw })
    if (error) setErr(error.message); else done()
  }
  return <form className="login" onSubmit={save}><h1>Set a new password</h1>
    <label>New password<input type="password" value={pw} onChange={e => setPw(e.target.value)} autoComplete="new-password" required /></label>
    {err && <p className="err">{err}</p>}<button className="primary block">Save password</button></form>
}

function Shell() {
  const { session, profile, loading, recovery, clearRecovery } = useAuth()
  if (!configured) return <div className="center"><h1>Setup needed</h1><p>Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (see .env.example), then reload.</p></div>
  if (loading) return <div className="center">Loading…</div>
  if (recovery && session) return <SetPassword done={clearRecovery} />
  if (!session) return <Login />
  if (!profile) return <div className="center"><h1>No clinic profile</h1><p>Your login works, but no profile is linked to it yet. Ask the admin to add one.</p><button onClick={() => supabase.auth.signOut()}>Sign out</button></div>
  const viewer = profile.role === 'safety_manager'
  return (
    <div className="shell">
      <header><strong>Staff Clinic</strong><span>{profile.full_name} · {profile.role.replace('_', ' ')}</span></header>
      <main>
        <Suspense fallback={<p className="muted">Loading…</p>}><Routes>
          {viewer ? <><Route path="/reports/:id" element={<ReportView />} /><Route path="*" element={<Reports />} /></> : <>
            <Route path="/" element={<Home />} />
            <Route path="/patients" element={<Patients />} />
            <Route path="/patients/:id" element={<PatientDetail />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/reports/:id" element={<ReportView />} />
            <Route path="/admin" element={profile.is_admin ? <Admin /> : <Navigate to="/" />} />
            <Route path="/admin/import" element={profile.is_admin ? <ImportExcel /> : <Navigate to="/" />} />
            <Route path="*" element={<Navigate to="/" />} />
          </>}
        </Routes></Suspense>
      </main>
      <nav>
        {!viewer && <NavLink to="/" end>Home</NavLink>}
        {!viewer && <NavLink to="/patients">Patients</NavLink>}
        <NavLink to={viewer ? '/' : '/reports'}>Reports</NavLink>
        {profile.is_admin && <NavLink to="/admin">Admin</NavLink>}
        <button onClick={() => supabase.auth.signOut()}>Sign out</button>
      </nav>
    </div>
  )
}
export default function App() { return <BrowserRouter><AuthProvider><Shell /></AuthProvider></BrowserRouter> }
