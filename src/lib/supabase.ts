import { createClient } from '@supabase/supabase-js'
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
export const configured = Boolean(url && key)
export const supabase = createClient(url ?? 'http://localhost', key ?? 'missing')
export const initials = (n: string) => n.replace(/\(demo\)/i, '').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()
export const minsSince = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
export const fmtMins = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`)
export const today = () => new Date().toLocaleDateString('en-CA')
