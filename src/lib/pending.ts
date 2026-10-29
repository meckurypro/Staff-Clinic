import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
/** Entries someone recorded on this clinician's behalf that are waiting for their confirmation. */
export function usePending(enabled: boolean, uid?: string) {
  const [n, setN] = useState(0)
  const refresh = useCallback(async () => {
    if (!enabled || !uid) return setN(0)
    const q = (t: string) => supabase.from(t).select('id', { count: 'exact', head: true }).eq('entry_type', 'on_behalf_pending').eq('author_id', uid)
    const r = await Promise.all([q('visit_notes'), q('prescriptions'), q('referrals')])
    setN(r.reduce((a, x) => a + (x.count ?? 0), 0))
  }, [enabled, uid])
  useEffect(() => {
    refresh(); const t = setInterval(refresh, 60000); window.addEventListener('pending-changed', refresh)
    return () => { clearInterval(t); window.removeEventListener('pending-changed', refresh) }
  }, [refresh])
  return n
}
export function useOnline() {
  const [on, setOn] = useState(navigator.onLine)
  useEffect(() => { const u = () => setOn(true), d = () => setOn(false); window.addEventListener('online', u); window.addEventListener('offline', d); return () => { window.removeEventListener('online', u); window.removeEventListener('offline', d) } }, [])
  return on
}
