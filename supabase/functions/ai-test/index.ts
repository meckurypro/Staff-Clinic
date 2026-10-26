import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

async function complete(provider: string, model: string, key: string, prompt: string): Promise<string> {
  let res: Response
  if (provider === 'anthropic') {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 64, messages: [{ role: 'user', content: prompt }] }),
    })
  } else if (provider === 'openai') {
    res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model, input: prompt, max_output_tokens: 256 }),
    })
  } else if (provider === 'gemini') {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 256 } }),
    })
  } else throw new Error('Unknown provider')

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = data?.error?.message ?? data?.error ?? res.statusText
    throw new Error(`${provider} returned ${res.status}: ${String(msg).slice(0, 200)}`)
  }
  if (provider === 'anthropic') return (data.content ?? []).map((c: any) => c.text ?? '').join('').trim()
  if (provider === 'openai')
    return (data.output_text ?? (data.output ?? []).flatMap((o: any) => o.content ?? []).map((c: any) => c.text ?? '').join('')).trim()
  return (data.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? '').join('').trim()
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    })
    const { data: isAdmin } = await asUser.rpc('auth_is_admin')
    if (!isAdmin) return json({ error: 'Admin only' }, 403)

    const { data: s, error } = await asUser.from('ai_settings').select('provider, model_id').single()
    if (error || !s) return json({ error: 'AI settings not found' }, 400)

    const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: key } = await service.rpc('get_ai_key', { p_provider: s.provider })
    if (!key) return json({ error: `No API key saved for ${s.provider}` }, 400)

    // The test prompt contains no patient information.
    const started = Date.now()
    const reply = await complete(s.provider, s.model_id, key, 'Reply with the single word OK.')
    return json({ ok: true, provider: s.provider, model: s.model_id, reply: reply.slice(0, 40), ms: Date.now() - started })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Unexpected error' }, 500)
  }
})
