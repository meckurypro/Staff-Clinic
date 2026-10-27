export type VisitIn = { visit_at: string; bp_s?: number; bp_d?: number; pulse?: number; temp?: number; weight?: number; rbs?: number
  complaint: string; plan_accepted?: boolean; prescriptions: string[]; referrals: string[]; advice: string[] }
export type PatientIn = { full_name: string; age?: number; phone?: string; consent?: string; department: string; visits: VisitIn[] }
export type Parsed = { patients: PatientIn[]; rowsRead: number; rowsSkipped: number; valuesDropped: number; from: string; to: string; sameNameDifferentDept: number; datesFixed: number; stillFuture: number }

const norm = (h: any) => String(h ?? '').trim().toUpperCase()
const pad = (n: number) => String(n).padStart(2, '0')
const title = (s: string) => (s === s.toUpperCase() ? s.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (_, a, b) => a + b.toUpperCase()) : s)
export const deptKey = (s: string) => s.toUpperCase().replace(/[^A-Z]/g, '')

/** Excel on a US-style computer can swap day and month on typed dates. A date in the future whose swap is in the past is fixed. */
function unswap(v: Date): Date | null {
  const now = new Date(); if (v <= now || v.getDate() > 12) return null
  const s = new Date(v.getFullYear(), v.getDate() - 1, v.getMonth() + 1); return s <= now ? s : null
}
export function parseDate(v: any): string | null {
  let y: number, m: number, d: number
  if (v instanceof Date) { y = v.getFullYear(); m = v.getMonth() + 1; d = v.getDate() }
  else {
    const t = String(v ?? '').trim().match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/)
    if (!t) return null
    d = +t[1]; m = +t[2]; y = +t[3] < 100 ? 2000 + +t[3] : +t[3]
  }
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null
  return `${y}-${pad(m)}-${pad(d)}T12:00:00+01:00`   // midday Lagos time, so the date never shifts
}
const DRUG = /^(tab|tabs|tablet|tablets|cap|caps|capsule|inj|im|iv|syp|syrup|susp|suspension|cream|gel|ointment|drops|eye|ear|nasal|oral|po|ors|sachet|lotion|spray|lozenge|suppository|\d+\s?mls?)\b/i
const REFER = /\brefer(red)?\b/i

export function parseSheet(rows: any[][], mergeAcrossDepts: boolean): Parsed {
  const hi = rows.findIndex(r => r.some(c => norm(c) === 'DATE') && r.some(c => norm(c) === 'NAME'))
  if (hi < 0) throw new Error('Could not find the DATE and NAME columns in the first rows of this sheet.')
  const head = rows[hi].map(norm); const col = (...n: string[]) => head.findIndex(h => n.includes(h))
  const c = { date: col('DATE'), name: col('NAME'), age: col('AGE'), dept: col('DEPARTMENT'), consent: col('CONSENT FORM SIGNED', 'CONSENT'), bp: col('BP'),
    pulse: col('PR', 'PULSE'), temp: col('TEMP'), weight: col('WEIGHT'), rbs: col('RBS'), comp: col('COMPLAINTS', 'COMPLAINS', 'COMPLAINT'),
    plan: col('PLAN'), acc: col('PLAN ACCEPTED'), phone: col('PHONE NUMBER', 'PHONE') }
  let skipped = 0, dropped = 0, read = 0, fixed = 0
  const inRange = (v: number, lo: number, hi2: number) => { if (Number.isFinite(v) && v >= lo && v <= hi2) return v; if (Number.isFinite(v)) dropped++; return undefined }
  const people = new Map<string, PatientIn>(); const deptsByName = new Map<string, Set<string>>()
  for (const r of rows.slice(hi + 1)) {
    if (r.every(x => x == null || String(x).trim() === '')) continue
    read++
    let raw = r[c.date]; if (raw instanceof Date) { const u = unswap(raw); if (u) { raw = u; fixed++ } }
    const name = String(r[c.name] ?? '').trim().replace(/\s+/g, ' '); const at = parseDate(raw)
    if (!name || !at) { skipped++; continue }
    const dept = String(r[c.dept] ?? '').trim().replace(/\s+/g, ' ')
    const bp = String(r[c.bp] ?? '').match(/(\d{2,3})\s*\/\s*(\d{2,3})/)
    const planText = r.slice(c.plan, c.acc > c.plan ? c.acc : c.plan + 1).map(x => String(x ?? '').trim()).filter(Boolean).join('\n')
    const v: VisitIn = { visit_at: at, complaint: String(r[c.comp] ?? '').trim(), prescriptions: [], referrals: [], advice: [],
      bp_s: bp ? inRange(+bp[1], 40, 300) : undefined, bp_d: bp ? inRange(+bp[2], 20, 200) : undefined,
      pulse: inRange(parseInt(String(r[c.pulse] ?? ''), 10), 20, 250), temp: inRange(parseFloat(String(r[c.temp] ?? '')), 30, 45),
      weight: inRange(parseFloat(String(r[c.weight] ?? '')), 1, 400), rbs: inRange(parseFloat(String(r[c.rbs] ?? '')), 10, 1000) }
    const acc = norm(r[c.acc]); if (acc === 'YES') v.plan_accepted = true; else if (acc === 'NO') v.plan_accepted = false
    for (const part of planText.split(/\n|;|,(?=\s*(?:tab|cap|inj|syp|syrup|refer))/i).map(s => s.trim()).filter(Boolean)) {
      if (REFER.test(part)) v.referrals.push(part); else if (DRUG.test(part)) v.prescriptions.push(part); else v.advice.push(part)
    }
    const key = name.toLowerCase() + (mergeAcrossDepts ? '' : '|' + dept.toLowerCase())
    let p = people.get(key)
    if (!p) { p = { full_name: title(name), department: dept, visits: [] }; people.set(key, p) }
    const ageN = parseInt(String(r[c.age] ?? ''), 10); if (ageN > 0 && ageN < 120) p.age = ageN
    const ph = String(r[c.phone] ?? '').replace(/\D/g, ''); if (ph.length >= 10) p.phone = ph.length === 10 ? '0' + ph : ph
    const cs = norm(r[c.consent]); p.consent = cs === 'YES' ? 'yes' : cs === 'NO' ? 'no' : cs ? 'not_required' : p.consent
    if (dept) p.department = dept
    p.visits.push(v)
    if (!deptsByName.has(name.toLowerCase())) deptsByName.set(name.toLowerCase(), new Set())
    if (dept) deptsByName.get(name.toLowerCase())!.add(dept.toLowerCase())
  }
  const all = [...people.values()].flatMap(p => p.visits.map(v => v.visit_at.slice(0, 10))).sort()
  return { patients: [...people.values()], rowsRead: read, rowsSkipped: skipped, valuesDropped: dropped, from: all[0] ?? '', to: all[all.length - 1] ?? '',
    sameNameDifferentDept: [...deptsByName.values()].filter(s => s.size > 1).length, datesFixed: fixed,
    stillFuture: all.filter(d => new Date(d) > new Date()).length }
}

export function lev(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[a.length][b.length]
}
/** Suggests an existing department for a spelling found in the sheet ('' = create it as new). */
export function suggestDept(src: string, existing: string[]): string {
  const k = deptKey(src); if (!k) return ''
  return existing.find(e => deptKey(e) === k) ?? existing.find(e => k.length >= 5 && lev(deptKey(e), k) <= 2) ?? ''
}
