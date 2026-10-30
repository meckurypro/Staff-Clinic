const { Sheet, rowFor, HEAD, googleToken, RANGE } = require('../.tmp/sheets.cjs'); const { generateKeyPairSync } = require('node:crypto')
const assert = require('node:assert/strict')
// ---- a fake Google that follows the real API's rules, including range quoting
let tabs = [], cells = [], calls = []
const fakeFetch = async (url, init = {}) => {
  const u = new URL(url); const path = decodeURIComponent(u.pathname); const m = init.method ?? 'GET'; calls.push(`${m} ${path}`)
  const json = (b, s = 200) => ({ ok: s < 300, status: s, json: async () => b })
  if (u.hostname === 'oauth2.googleapis.com') return json({ access_token: 'tok' })
  if (init.headers?.authorization !== 'Bearer tok') return json({ error: { message: 'unauthenticated' } }, 401)
  if (path.endsWith('/v4/spreadsheets/SHEETID') && m === 'GET') return json({ sheets: tabs.map(t => ({ properties: { title: t } })) })
  if (path.endsWith(':batchUpdate')) { tabs.push(JSON.parse(init.body).requests[0].addSheet.properties.title); return json({}) }
  const r = path.split('/values/')[1]
  if (!r) return json({ error: { message: 'bad path' } }, 404)
  if (/^[^']* [^']*!?/.test(r) && !r.startsWith("'")) return json({ error: { message: 'Unable to parse range: ' + r } }, 400)   // unquoted name with a space
  if (m === 'GET') return json(cells.length ? { values: [cells[0]] } : {})
  if (r.endsWith(':clear')) { cells = []; return json({}) }
  if (r.endsWith(':append')) { assert.equal(u.searchParams.get('insertDataOption'), 'INSERT_ROWS'); cells.push(...JSON.parse(init.body).values); return json({}) }
  if (m === 'PUT') { cells = JSON.parse(init.body).values; return json({}) }
  return json({}, 400)
}
;(async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const tok = await googleToken({ client_email: 'sa@x.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }, fakeFetch)
  const visit = (id, name) => ({ id, visit_at: '2026-10-27T09:30:00Z', major_concern: 'BP 160/100', remark: 'Medications prescribed', plan_accepted: true,
    patients: { full_name: name, staff_id: null, sex: 'female', approx_age: 34, phone: '0801', departments: { name: 'Treasury' } }, vitals: [{ bp_systolic: 160, bp_diastolic: 100, pulse: 80, temp_c: 36.8 }],
    visit_notes: [{ kind: 'complaint', body: 'Headache' }, { kind: 'diagnosis', body: 'Hypertension' }], prescriptions: [{ drug: 'Amlodipine', dose: '5mg', frequency: 'OD', duration: '30/7' }], referrals: [], bed_stays: [] })
  const s = new Sheet('SHEETID', tok, fakeFetch)
  // 1. first run: the tab is missing, so it is created and the whole history is written with a header
  assert.equal(await s.prepare(), false); assert.deepEqual(tabs, ['Clinic records'])
  await s.writeAll([rowFor(visit('v1', 'Test One'), true)])
  assert.equal(cells.length, 2); assert.deepEqual(cells[0], HEAD); assert.equal(cells[1][1], 'Test One')
  // 2. later: header exists, so a new visit is APPENDED as one extra row and nothing is rewritten
  assert.equal(await s.prepare(), true)
  await s.append([rowFor(visit('v2', 'Test Two'), true)])
  assert.equal(cells.length, 3); assert.equal(cells[2][1], 'Test Two'); assert.equal(cells[1][1], 'Test One')
  assert.equal(cells[2][HEAD.indexOf('Visit ID')], 'v2'); assert.equal(cells[2][HEAD.indexOf('Diagnosis')], 'Hypertension'); assert.equal(cells[2][HEAD.indexOf('BP')], '160/100')
  // 3. names can be switched off
  assert.equal(rowFor(visit('v3', 'Secret Name'), false)[1], '\u2014')
  // 4. every row has exactly as many cells as the header
  assert.equal(cells[2].length, HEAD.length)
  // 5. access refused gives a message the admin can act on
  const denied = new Sheet('SHEETID', 'wrong', fakeFetch)
  await assert.rejects(() => denied.prepare(), /Share it with the service account email as Editor/)
  console.log('ALL SHEET TESTS PASSED'); console.log(calls.filter(c => c.includes('values')).join('\n'))
})().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
