import { jsPDF } from 'jspdf'
import * as AT from 'jspdf-autotable'
const autoTable: (doc: any, o: any) => void = (AT as any).autoTable ?? (AT as any).default?.default ?? (AT as any).default
import { periodText, type ReportDoc } from './docx'

const INK = '#44546A'
const lines = (t: string) => t.split('\n').map(l => l.trim()).filter(Boolean).map(l => (/^[-\u2022]\s+/.test(l) ? '\u2022 ' + l.replace(/^[-\u2022]\s+/, '') : l))

/** PDF version of the Sick Bay report (landscape letter, same sections and tables as the Word file). */
export function fillPdf(r: ReportDoc, logo?: string): Uint8Array {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' })
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 54, BOTTOM = H - 50
  let y = 40
  const room = (h: number) => { if (y + h > BOTTOM) { doc.addPage(); y = 50 } }
  if (logo) { doc.addImage(logo, 'PNG', M, y, 150, 31); y += 48 }
  doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(0); doc.text('SICK BAY REPORT', M, y); y += 20
  doc.setFont('helvetica', 'normal').text(`Reporting Period: ${periodText(r.period_from, r.period_to)}`, M, y); y += 24
  const heading = (t: string) => { room(40); doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(INK); doc.text(t, M, y); y += 16; doc.setTextColor(0) }
  const body = (t: string) => {
    doc.setFont('helvetica', 'normal').setFontSize(10.5)
    for (const l of lines(t)) { for (const part of doc.splitTextToSize(l, W - 2 * M) as string[]) { room(15); doc.text(part, M, y); y += 14.5 } y += 5 }
    y += 6
  }
  const table = (head: string[], rows: string[][], widths: number[]) => {
    autoTable(doc, { startY: y, head: [head], body: rows, margin: { left: M, right: M, bottom: 50 }, theme: 'grid', rowPageBreak: 'avoid',
      styles: { font: 'helvetica', fontSize: 9, textColor: 0, lineColor: 0, lineWidth: 0.5, cellPadding: 3 },
      headStyles: { fillColor: '#E2EFD9', textColor: 0, fontStyle: 'bold', halign: 'center' },
      columnStyles: Object.fromEntries(widths.map((w, i) => [i, { cellWidth: w }])) })
    y = (doc as any).lastAutoTable.finalY + 22
  }
  heading('1.0 Executive Summary'); body(r.summary)
  heading('2.0 Details of Healthcare Personnel')
  table(['S/N', 'Name', 'Designation'], r.personnel.map(p => [p.p_sn, p.p_name, p.p_des]), [40, 230, 200])
  heading('3.0 Medical Consultation and Intervention')
  table(['S/N', 'Name', 'Date of Visit', 'Reason for Visit', 'Medical Conditions', 'Major Concern (Where applicable)', 'Remark'],
    r.rows.map(x => [x.sn, x.name, x.date, x.reason, x.condition, x.concern, x.remark]), [30, 100, 70, 130, 120, 120, 114])
  heading('4.0 Trend and Pattern'); body(r.trend)
  heading('5.0 Comments and Recommendations'); body(r.recommendations)
  heading('6.0 Conclusion'); body(r.conclusion)
  const n = doc.getNumberOfPages()
  for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(120); doc.text(`Page ${i} of ${n}`, W - M, H - 24, { align: 'right' }) }
  return new Uint8Array(doc.output('arraybuffer'))
}

export async function buildPdf(r: ReportDoc): Promise<File> {
  let logo: string | undefined
  try {
    const blob = await (await fetch('/boi-logo.png')).blob()
    logo = await new Promise<string>(res => { const f = new FileReader(); f.onload = () => res(String(f.result)); f.readAsDataURL(blob) })
  } catch { /* the report is still valid without the logo */ }
  return new File([fillPdf(r, logo) as BlobPart], `SICK_BAY_REPORT_${r.period_from}_to_${r.period_to}.pdf`, { type: 'application/pdf' })
}
