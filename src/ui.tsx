import { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { initials } from './lib/supabase'

const P: Record<string, ReactNode> = {
  home: <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20h5v-6h4v6h5V9.5" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5" /><path d="M16 4.7a3.5 3.5 0 0 1 0 6.6" /><path d="M18 14.8c1.9.7 3.2 2.4 3.5 5.2" /></>,
  chart: <><path d="M5 20v-6" /><path d="M12 20V5" /><path d="M19 20v-9" /></>,
  shield: <><path d="M12 3 4.5 6v5.5c0 4.6 3.1 8 7.5 9.5 4.4-1.5 7.5-4.9 7.5-9.5V6L12 3Z" /><path d="m9 12 2.2 2.2L15.5 10" /></>,
  logout: <><path d="M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4" /><path d="m16 8 4 4-4 4" /><path d="M20 12H9" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  bed: <><path d="M3 18V7" /><path d="M3 14h18v4" /><path d="M21 14v-2a3 3 0 0 0-3-3h-7v5" /><circle cx="7" cy="11" r="1.6" /></>,
  back: <><path d="M19 12H5" /><path d="m11 6-6 6 6 6" /></>,
  chevron: <path d="m9 6 6 6-6 6" />,
  download: <><path d="M12 4v11" /><path d="m7 11 5 5 5-5" /><path d="M5 20h14" /></>,
  share: <><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="m8.2 10.8 7.6-3.6M8.2 13.2l7.6 3.6" /></>,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  file: <><path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" /><path d="M14 3v5h5" /><path d="M9 13h6M9 17h6" /></>,
  pulse: <path d="M3 12h4l2.5-6 4 12 2.5-6H21" />,
  alert: <><path d="M12 4 2.8 19.5h18.4L12 4Z" /><path d="M12 10v4.5M12 17.2v.1" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.8v.1" /></>,
  pill: <><rect x="3.5" y="9" width="17" height="6" rx="3" transform="rotate(-35 12 12)" /><path d="m9.2 9.6 5.6 5.6" /></>,
}
export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{P[name]}</svg>
}

export function Logo({ size = 36 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true"><defs><linearGradient id="logo-g" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#2F7BFF" /><stop offset="1" stopColor="#0C9488" /></linearGradient></defs><rect width="40" height="40" rx="11" fill="url(#logo-g)" /><path d="M8 21h6l3-7 5 14 3-7h7" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
}

const TONES = ['blue', 'teal', 'violet', 'amber', 'rose']
const toneOf = (s: string) => TONES[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % TONES.length]
export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  return <span className={'avatar avatar-' + toneOf(name)} style={{ width: size, height: size, fontSize: size * 0.38 }} aria-hidden="true">{initials(name) || '?'}</span>
}

export function Badge({ tone = 'grey', dot, children }: { tone?: 'blue' | 'teal' | 'amber' | 'red' | 'grey'; dot?: boolean; children: ReactNode }) {
  return <span className={'badge badge-' + tone}>{dot && <i className="dot" />}{children}</span>
}

export function PageHeader({ title, sub, back, actions }: { title: string; sub?: ReactNode; back?: { to: string; label: string }; actions?: ReactNode }) {
  return (
    <div className="page-head">
      {back && <Link to={back.to} className="back"><Icon name="back" size={16} />{back.label}</Link>}
      <div className="page-head-row">
        <div><h1>{title}</h1>{sub && <p className="sub">{sub}</p>}</div>
        {actions && <div className="page-actions">{actions}</div>}
      </div>
    </div>
  )
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'error' | 'ok'; children: ReactNode }) {
  return <div className={'notice notice-' + tone} role={tone === 'error' ? 'alert' : 'status'}><Icon name={tone === 'error' ? 'alert' : tone === 'ok' ? 'check' : 'info'} size={18} /><div>{children}</div></div>
}

export function Empty({ icon, title, children }: { icon: string; title: string; children?: ReactNode }) {
  return <div className="empty"><span className="empty-ico"><Icon name={icon} size={24} /></span><h3>{title}</h3>{children && <p>{children}</p>}</div>
}

export const Loading = ({ label = 'Loading…' }: { label?: string }) => <div className="loading" role="status"><span className="spinner" />{label}</div>
export const Spinner = () => <span className="spinner spinner-inline" aria-hidden="true" />
export const ROLE_LABEL: Record<string, string> = { nurse: 'Nurse', doctor: 'Doctor', safety_manager: 'Safety manager' }
