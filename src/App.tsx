import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth'
import { configured, supabase } from './lib/supabase'
import Login from './pages/Login'
import Home from './pages/Home'
import Patients from './pages/Patients'
import PatientDetail from './pages/PatientDetail'
import Reports from './pages/Reports'

function Shell() {
  const { session, profile, loading } = useAuth()
  if (!configured) return <div className="center"><h1>Setup needed</h1><p>Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (see .env.example), then reload.</p></div>
  if (loading) return <div className="center">Loading…</div>
  if (!session) return <Login />
  if (!profile) return <div className="center"><h1>No clinic profile</h1><p>Your login works, but no profile is linked to it yet. Ask the admin to add one.</p><button onClick={() => supabase.auth.signOut()}>Sign out</button></div>
  const viewer = profile.role === 'safety_manager'
  return (
    <div className="shell">
      <header><strong>Staff Clinic</strong><span>{profile.full_name} · {profile.role.replace('_', ' ')}</span></header>
      <main>
        <Routes>
          {viewer ? <Route path="*" element={<Reports />} /> : <>
            <Route path="/" element={<Home />} />
            <Route path="/patients" element={<Patients />} />
            <Route path="/patients/:id" element={<PatientDetail />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="*" element={<Navigate to="/" />} />
          </>}
        </Routes>
      </main>
      <nav>
        {!viewer && <NavLink to="/" end>Home</NavLink>}
        {!viewer && <NavLink to="/patients">Patients</NavLink>}
        <NavLink to={viewer ? '/' : '/reports'}>Reports</NavLink>
        <button onClick={() => supabase.auth.signOut()}>Sign out</button>
      </nav>
    </div>
  )
}
export default function App() { return <BrowserRouter><AuthProvider><Shell /></AuthProvider></BrowserRouter> }
