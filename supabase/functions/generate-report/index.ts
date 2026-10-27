import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const day = (iso: string) => `${MONTHS[+iso.slice(5, 7) - 1]} ${+iso.slice(8, 10)}`
const periodText = (a: string, b: string) => `${day(a)} \u2013 ${day(b)}, ${b.slice(0, 4)}`

async function complete(provider: string, model: string, key: string, prompt: string): Promise<string> {
  let res: Response
  if (provider === 'anthropic') {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 2500, messages: [{ role: 'user', content: prompt }] }),
    })
  } else if (provider === 'openai') {
    res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model, input: prompt, max_output_tokens: 6000 }),
    })
  } else if (provider === 'gemini') {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 6000, responseMimeType: 'application/json' } }),
    })
  } else throw new Error('Unknown provider')
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${provider} returned ${res.status}: ${String(data?.error?.message ?? data?.error ?? res.statusText).slice(0, 200)}`)
  if (provider === 'anthropic') return (data.content ?? []).map((c: any) => c.text ?? '').join('').trim()
  if (provider === 'openai')
    return (data.output_text ?? (data.output ?? []).flatMap((o: any) => o.content ?? []).map((c: any) => c.text ?? '').join('')).trim()
  return (data.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? '').join('').trim()
}

const num = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`

// Used when no AI key is saved or the AI call fails. Built only from the database figures.
function fallback(s: any, period: string) {
  const pct = s.consultations ? Math.round((s.major_concerns / s.consultations) * 100) : 0
  const top = (s.top_conditions ?? []) as { condition: string; count: number }[]
  return {
    summary: `This report covers the Sick Bay consultation log for the period ${period}. A total of ${num(s.consultations, 'consultation')} ${s.consultations === 1 ? 'was' : 'were'} recorded, involving ${num(s.unique_patients, 'unique staff member')}. ${num(s.major_concerns, 'consultation')} (about ${pct}%) ${s.major_concerns === 1 ? 'was' : 'were'} flagged with a major concern, and ${num(s.referrals, 'staff member')} ${s.referrals === 1 ? 'was' : 'were'} referred to a hospital or specialist.`,
    trend: [`A total of ${num(s.consultations, 'consultation')} ${s.consultations === 1 ? 'was' : 'were'} recorded at the Sick Bay between ${period}, involving ${num(s.unique_patients, 'unique staff member')}. ${num(s.staff_with_multiple_visits, 'employee')} returned for more than one consultation within the period.`,
      top.length ? 'Breakdown by leading presentation:' : '', ...top.map(t => `- ${t.condition} \u2013 ${num(t.count, 'case')}`)].filter(Boolean).join('\n'),
    recommendations: 'The clinic team should review the figures above and add recommendations before this report is finalised.',
    conclusion: `Over the reporting period (${period}), the Sick Bay recorded ${num(s.consultations, 'consultation')}. The unit continued to provide first-line care and referred cases outside its scope where necessary.`,
  }
}

function prompt(s: any, period: string) {
  const pct = s.consultations ? Math.round((s.major_concerns / s.consultations) * 100) : 0
  const avg = s.consultations / Math.max(1, s.days_covered)
  return `You are drafting a Sick Bay report for the Safety Manager of an office staff clinic in Lagos, Nigeria. Write in formal British English, third person, as the clinic's report. Use ONLY the facts in DATA. Never invent numbers, causes, names or diagnoses, never identify any individual, and do not give individual clinical advice.

Return ONLY a JSON object with these string fields (use \\n for line breaks; separate paragraphs with a blank line):
- "summary": one paragraph of 4-6 sentences: total consultations and unique staff, the leading presentations, a same-day cluster only if busiest_day.count is at least 4 and at least twice the daily average (${avg.toFixed(1)}), referrals, and major concerns with the percentage.
- "trend": a paragraph with the totals and the number of staff who returned more than once (a count only), then a line "Breakdown by leading presentation:", then one line per top condition in the form "- Condition \u2013 N cases", then a paragraph on major concerns (count and percentage) and referrals.
- "recommendations": 3-5 short paragraphs, each starting with a topic label and a colon, proposing workplace-level measures only (screening, ergonomics, hygiene reviews, awareness sessions) that follow from the data.
- "conclusion": two short paragraphs naming the reporting period and summarising the overall picture.

DATA:
period: ${period}
stats: ${JSON.stringify({ ...s, major_concern_percent: pct })}`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { from, to, include_names } = await req.json()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) return json({ error: 'Choose a valid period.' }, 400)

    const url = Deno.env.get('SUPABASE_URL')!
    const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
    const { data: me } = await asUser.auth.getUser()
    const { data: role } = await asUser.rpc('auth_role')
    if (!me?.user || !['nurse', 'doctor'].includes(role)) return json({ error: 'Only the nurse or doctor can generate reports.' }, 403)

    const { data: snap, error: snapErr } = await asUser.rpc('report_snapshot', { p_from: from, p_to: to, p_names: include_names !== false })
    if (snapErr) return json({ error: snapErr.message }, 400)
    const s = snap.stats
    if (!s.consultations) return json({ error: 'There are no consultations in that period.' }, 400)

    const period = periodText(from, to)
    let text = fallback(s, period); let used: { provider: string; model: string } | null = null; let note = ''
    const { data: cfg } = await asUser.from('ai_settings').select('provider, model_id').single()
    if (cfg) {
      const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
      const { data: key } = await service.rpc('get_ai_key', { p_provider: cfg.provider })
      if (!key) note = `No ${cfg.provider} API key is saved, so the narrative is a plain draft. Add a key on the Admin page for AI-written text.`
      else {
        try {
          // Only aggregated figures and condition labels are sent. No names, no visit details.
          const raw = await complete(cfg.provider, cfg.model_id, key, prompt(s, period))
          const parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1))
          for (const k of ['summary', 'trend', 'recommendations', 'conclusion'] as const) if (typeof parsed[k] === 'string' && parsed[k].trim()) text[k] = parsed[k].trim()
          used = { provider: cfg.provider, model: cfg.model_id }
        } catch (e) { note = `The AI step failed (${e instanceof Error ? e.message : 'unknown error'}), so a plain draft was used.` }
      }
    }

    const { data: row, error } = await asUser.from('reports').insert({
      period_from: from, period_to: to, include_names: include_names !== false, ...text,
      stats: s, rows: snap.rows, personnel: snap.personnel, is_demo: !!snap.has_demo,
      ai_provider: used?.provider ?? null, ai_model: used?.model ?? null, created_by: me.user.id,
    }).select('id').single()
    if (error) return json({ error: error.message }, 400)
    return json({ id: row.id, ai: !!used, note })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Unexpected error' }, 500)
  }
})
