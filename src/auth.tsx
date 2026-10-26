import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
export type Profile = { id: string; full_name: string; role: 'nurse' | 'doctor' | 'safety_manager'; is_admin: boolean }
type Ctx = { session: Session | null; profile: Profile | null; loading: boolean }
const C = createContext<Ctx>({ session: null, profile: null, loading: true })
export const useAuth = () => useContext(C)
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [ready, setReady] = useState(false)
  const [profileDone, setProfileDone] = useState(false)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true) })
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])
  useEffect(() => {
    if (!session) { setProfile(null); setProfileDone(true); return }
    setProfileDone(false)
    supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle().then(({ data }) => { setProfile(data as Profile | null); setProfileDone(true) })
  }, [session])
  return <C.Provider value={{ session, profile, loading: !ready || !profileDone }}>{children}</C.Provider>
}
