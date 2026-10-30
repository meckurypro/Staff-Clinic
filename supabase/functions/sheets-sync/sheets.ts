// Pure helpers for the Google Sheet mirror. No Deno or Supabase imports, so they can be tested with a fake Google server.
export const TAB = 'Clinic records'
export const RANGE = `'${TAB}'`            // names with spaces must be quoted in A1 notation
export const HEAD = ['Date', 'Name', 'Staff ID', 'Sex', 'Age', 'Department', 'Phone', 'BP', 'Pulse', 'Temp C', 'Weight kg', 'RBS', 'Complaint',
  'Diagnosis', "Doctor's note", 'Nursing note', 'Prescription', 'Referral', 'Major concern', 'Remark', 'Bed rest', 'Plan accepted', 'Visit ID']
export const VISIT_SELECT = 'id, visit_at, major_concern, remark, plan_accepted, patients(full_name, staff_id, sex, approx_age, phone, departments(name)), vitals(bp_systolic, bp_diastolic, pulse, temp_c, weight_kg, rbs_mgdl), visit_notes(kind, body), prescriptions(drug, dose, frequency, duration), referrals(destination), bed_stays(admitted_at, discharged_at)'

type F = typeof fetch
const b64u = (b: ArrayBuffer | string) =>
  btoa(typeof b === 'string' ? b : String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export async function googleToken(sa: { client_email: string; private_key: string }, f: F = fetch): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claim = b64u(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }))
  const der = Uint8Array.from(atob(sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')), c => c.charCodeAt(0))
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${claim}`))
  const res = await f('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claim}.${b64u(sig)}` }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`Google sign-in failed: ${data.error_description ?? data.error}`)
  return data.access_token
}

const lagos = (iso: string) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Africa/Lagos', dateStyle: 'medium', timeStyle: 'short' })
const join = (a: (string | null | undefined)[]) => a.filter(Boolean).join('; ')

export function rowFor(v: any, showNames: boolean): (string | number)[] {
  const p = v.patients ?? {}; const vt = v.vitals?.[0] ?? {}
  const notes = (k: string) => join((v.visit_notes ?? []).filter((n: any) => n.kind === k).map((n: any) => n.body))
  return [lagos(v.visit_at), showNames ? p.full_name ?? '' : '\u2014', p.staff_id ?? '', p.sex ?? '', p.approx_age ?? '', p.departments?.name ?? '', p.phone ?? '',
    vt.bp_systolic ? `${vt.bp_systolic}/${vt.bp_diastolic}` : '', vt.pulse ?? '', vt.temp_c ?? '', vt.weight_kg ?? '', vt.rbs_mgdl ?? '',
    notes('complaint'), notes('diagnosis'), notes('medical'), notes('nursing'),
    join((v.prescriptions ?? []).map((r: any) => [r.drug, r.dose, r.frequency, r.duration].filter(Boolean).join(' '))),
    join((v.referrals ?? []).map((r: any) => r.destination)), v.major_concern ?? '', v.remark ?? '',
    (v.bed_stays ?? []).map((b: any) => `${lagos(b.admitted_at)}${b.discharged_at ? ' to ' + lagos(b.discharged_at) : ' (in bed)'}`).join('; '),
    v.plan_accepted == null ? '' : v.plan_accepted ? 'Yes' : 'No', v.id ?? '']
}

export class SheetError extends Error {}

export class Sheet {
  private base: string; private h: Record<string, string>
  constructor(id: string, token: string, private f: F = fetch) {
    this.base = `https://sheets.googleapis.com/v4/spreadsheets/${id}`; this.h = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
  }
  private async call(url: string, init: RequestInit = {}) {
    const res = await this.f(url, { ...init, headers: this.h }); const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new SheetError(body?.error?.message ?? `Google returned ${res.status}`)
    return body
  }
  /** Creates the tab if it is missing. Returns true when the header row is already in place. */
  async prepare(): Promise<boolean> {
    let meta
    try { meta = await this.call(`${this.base}?fields=sheets.properties.title`) }
    catch (e) { throw new SheetError(`Google refused access to the sheet (${(e as Error).message}). Share it with the service account email as Editor.`) }
    if (!(meta.sheets ?? []).some((s: any) => s.properties.title === TAB)) {
      await this.call(`${this.base}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{ addSheet: { properties: { title: TAB } } }] }) })
      return false
    }
    const top = await this.call(`${this.base}/values/${encodeURIComponent(RANGE + '!A1')}`)
    return top.values?.[0]?.[0] === HEAD[0]
  }
  /** Replaces the whole tab: header, then every row. */
  async writeAll(rows: (string | number)[][]) {
    await this.call(`${this.base}/values/${encodeURIComponent(RANGE)}:clear`, { method: 'POST', body: '{}' })
    await this.call(`${this.base}/values/${encodeURIComponent(RANGE + '!A1')}?valueInputOption=RAW`, { method: 'PUT', body: JSON.stringify({ values: [HEAD, ...rows] }) })
  }
  /** Adds rows below the last one. */
  async append(rows: (string | number)[][]) {
    await this.call(`${this.base}/values/${encodeURIComponent(RANGE + '!A1')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, { method: 'POST', body: JSON.stringify({ values: rows }) })
  }
}
