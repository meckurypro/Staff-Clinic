import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth'
import { configured, supabase } from './lib/supabase'
import Login from './pages/Login'
import Home from './pages/Home'
import Patients from './pages/Patients'
import PatientDetail from './pages/PatientDetail'
import Reports from './pages/Reports'
import { FormEvent, Suspense, lazy, useState } from 'react'
import { Avatar, Icon, Loading, Logo, Notice, ROLE_LABEL, Spinner } from './ui'
import { useOnline, usePending } from './lib/pending'
import Review from './pages/Review'
type Item = { to: string; label: string; icon: string; end: boolean; badge?: number }
const Admin = lazy(() => import('./pages/Admin'))
const ImportExcel = lazy(() => import('./pages/ImportExcel'))
const ReportView = lazy(() => import('./pages/ReportView'))
const AuditLog = lazy(() => import('./pages/AuditLog'))

function SetPassword({ done }: { done: () => void }) {
  const [pw, setPw] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  async function save(e: FormEvent) {
    e.preventDefault()
    if (pw.length < 8) return setErr('Use at least 8 characters.')
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password: pw })
    setBusy(false)
    if (error) setErr(error.message); else done()
  }
  return <div className="center-card"><form className="panel" onSubmit={save}><h1>Set a new password</h1><p>Choose a password you have not used here before.</p>
    <label>New password<input type="password" value={pw} onChange={e => setPw(e.target.value)} autoComplete="new-password" required /></label>
    {err && <Notice tone="error">{err}</Notice>}
    <button className="btn btn-primary btn-block" disabled={busy}>{busy ? <><Spinner />Saving…</> : 'Save password'}</button></form></div>
}

function Shell() {
  const { session, profile, loading, recovery, clearRecovery } = useAuth()
  const online = useOnline(); const pending = usePending(!!profile && profile.role !== 'safety_manager', profile?.id)
  if (!configured) return <div className="center-card"><div className="panel"><h1>Setup needed</h1><p>Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (see .env.example), then reload.</p></div></div>
  if (loading) return <div className="center-card"><Loading /></div>
  if (recovery && session) return <SetPassword done={clearRecovery} />
  if (!session) return <Login />
  if (!profile) return <div className="center-card"><div className="panel"><h1>No clinic profile</h1><p>Your login works, but no profile is linked to it yet. Ask the admin to add one.</p><button className="btn btn-secondary" onClick={() => supabase.auth.signOut()}>Sign out</button></div></div>
  const viewer = profile.role === 'safety_manager'
  const items: Item[] = viewer ? [{ to: '/', label: 'Reports', icon: 'chart', end: false }] : [
    { to: '/', label: 'Home', icon: 'home', end: true },
    { to: '/patients', label: 'Patients', icon: 'users', end: false },
    { to: '/reports', label: 'Reports', icon: 'chart', end: false },
  ]
  if (!viewer) items.splice(3, 0, { to: '/review', label: 'Review', icon: 'check', end: false, badge: pending })
  if (profile.is_admin) items.push({ to: '/admin', label: 'Admin', icon: 'shield', end: false })
  const signOut = () => supabase.auth.signOut()
  const brand = <><Logo /><span><b>Staff Clinic</b><small>Healthy staff. Productive workplace.</small></span></>
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">{brand}</div>
        <nav className="side-nav" aria-label="Main">
          {items.map(i => <NavLink key={i.label} to={i.to} end={i.end}><Icon name={i.icon} />{i.label}{!!i.badge && <b className="nav-badge">{i.badge}</b>}</NavLink>)}
        </nav>
        <div className="side-user">
          <Avatar name={profile.full_name} size={40} />
          <div><b>{profile.full_name}</b><br /><small>{ROLE_LABEL[profile.role] ?? profile.role}</small></div>
          <button className="btn btn-onnavy btn-sm" onClick={signOut}><Icon name="logout" size={16} />Sign out</button>
        </div>
      </aside>
      <div className="topbar">
        <div className="brand">{brand}</div>
        <button className="iconbtn" onClick={signOut} aria-label="Sign out"><Icon name="logout" /></button>
      </div>
      <main className="content">
        {!online && <div className="offline-bar" role="status"><Icon name="alert" size={18} />You are offline. Nothing can be saved until the connection returns.</div>}
        <Suspense fallback={<Loading />}><Routes>
          {viewer ? <><Route path="/reports/:id" element={<ReportView />} /><Route path="*" element={<Reports />} /></> : <>
            <Route path="/" element={<Home />} />
            <Route path="/patients" element={<Patients />} />
            <Route path="/patients/:id" element={<PatientDetail />} />
            <Route path="/review" element={<Review />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/reports/:id" element={<ReportView />} />
            <Route path="/admin" element={profile.is_admin ? <Admin /> : <Navigate to="/" />} />
            <Route path="/admin/audit" element={profile.is_admin ? <AuditLog /> : <Navigate to="/" />} />
            <Route path="/admin/import" element={profile.is_admin ? <ImportExcel /> : <Navigate to="/" />} />
            <Route path="*" element={<Navigate to="/" />} />
          </>}
        </Routes></Suspense>
      </main>
      <nav className="tabbar" aria-label="Main">
        {items.map(i => <NavLink key={i.label} to={i.to} end={i.end}><span className="tab-ico"><Icon name={i.icon} size={22} />{!!i.badge && <b className="nav-badge">{i.badge}</b>}</span>{i.label}</NavLink>)}
      </nav>
    </div>
  )
}
export default function App() { return <BrowserRouter><AuthProvider><Shell /></AuthProvider></BrowserRouter> }
