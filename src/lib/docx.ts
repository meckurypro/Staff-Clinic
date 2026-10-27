import JSZip from 'jszip'
export type ReportDoc = {
  period_from: string; period_to: string
  summary: string; trend: string; recommendations: string; conclusion: string
  rows: Record<string, string>[]; personnel: Record<string, string>[]
}
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const day = (iso: string) => `${MONTHS[+iso.slice(5, 7) - 1]} ${+iso.slice(8, 10)}`
export const periodText = (a: string, b: string) => `${day(a)} \u2013 ${day(b)}, ${b.slice(0, 4)}`
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const sub = (xml: string, v: Record<string, string>) => xml.replace(/\{\{(\w+)\}\}/g, (_, k) => esc(v[k] ?? ''))
const rowBounds = (x: string, m: string): [number, number] => {
  const i = x.indexOf(m); return [Math.max(x.lastIndexOf('<w:tr ', i), x.lastIndexOf('<w:tr>', i)), x.indexOf('</w:tr>', i) + 7]
}
const paraBounds = (x: string, m: string): [number, number] => {
  const i = x.indexOf(m); return [Math.max(x.lastIndexOf('<w:p ', i), x.lastIndexOf('<w:p>', i)), x.indexOf('</w:p>', i) + 6]
}

/** Fills the blank clinic template (header, fonts and table styling stay exactly as the safety manager's format). */
export async function fillDocx(template: ArrayBuffer, r: ReportDoc): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(template)
  let x = await zip.file('word/document.xml')!.async('string')
  const repeat = (marker: string, rows: Record<string, string>[]) => {
    const [s, e] = rowBounds(x, marker); const tpl = x.slice(s, e)
    x = x.slice(0, s) + rows.map(v => sub(tpl, v)).join('') + x.slice(e)
  }
  const paras = (marker: string, text: string) => {
    const [s, e] = paraBounds(x, marker); const tpl = x.slice(s, e)
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean).map(l => (/^[-\u2022]\s+/.test(l) ? '\u2022 ' + l.replace(/^[-\u2022]\s+/, '') : l))
    x = x.slice(0, s) + lines.map(l => tpl.split(marker).join(esc(l))).join('') + x.slice(e)
  }
  repeat('{{p_sn}}', r.personnel)
  repeat('{{sn}}', r.rows)
  paras('{{SUMMARY}}', r.summary); paras('{{TREND}}', r.trend); paras('{{RECS}}', r.recommendations); paras('{{CONCL}}', r.conclusion)
  x = x.replace('{{PERIOD}}', esc(periodText(r.period_from, r.period_to)))
  zip.file('word/document.xml', x)
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

const MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
export async function buildDocx(r: ReportDoc): Promise<File> {
  const res = await fetch('/sick-bay-template.docx'); if (!res.ok) throw new Error('Report template not found')
  const bytes = await fillDocx(await res.arrayBuffer(), r)
  return new File([bytes as BlobPart], `SICK_BAY_REPORT_${r.period_from}_to_${r.period_to}.docx`, { type: MIME })
}
