import type { OrderDetailDTO } from "./dto";
import { amount, dateTime, shortAddress } from "./format";

/**
 * A small dependency-free PDF writer: text only, standard fonts, A4, automatic page breaks.
 * Enough for a clear order. Content is reduced to ASCII so byte offsets equal string
 * offsets, which the cross-reference table needs.
 */

interface Line { x: number; text: string; size: number; font: "F1" | "F2" | "F3" }

const PAGE_W = 595, PAGE_H = 842, MARGIN = 48;

const ascii = (s: string) =>
  s.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—·]/g, "-").replace(/…/g, "...")
    .replace(/[^\x20-\x7e]/g, "?");
const esc = (s: string) => ascii(s).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

function buildPdf(pages: Line[][][]): Uint8Array {
  // pages: array of pages; each page is an array of rows; a row is an array of Lines sharing a baseline.
  const objects: string[] = [];
  const add = (body: string) => { objects.push(body); return objects.length; };

  const fontRegular = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const fontBold = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const fontMono = add("<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>");
  const pagesId = objects.length + 1 + pages.length * 2; // reserve: content+page per page, then the Pages node

  const pageIds: number[] = [];
  for (const rows of pages) {
    let y = PAGE_H - MARGIN;
    let stream = "";
    for (const row of rows) {
      const size = Math.max(...row.map((l) => l.size));
      y -= size + 5;
      for (const l of row) stream += `BT /${l.font} ${l.size} Tf ${l.x} ${y} Td (${esc(l.text)}) Tj ET\n`;
    }
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}endstream`);
    const page = add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Contents ${content} 0 R /Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R /F3 ${fontMono} 0 R >> >> >>`);
    pageIds.push(page);
  }
  const pagesNode = add(`<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
  const catalog = add(`<< /Type /Catalog /Pages ${pagesNode} 0 R >>`);

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`;

  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}

const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "~" : s.padEnd(n));
const padL = (s: string, n: number) => s.padStart(n);

/** An order as a PDF. Every figure is the stored, server-calculated value. */
export function purchaseOrderPdf(d: OrderDetailDTO): Uint8Array {
  const o = d.order;
  const rows: Line[][] = [];
  const row = (...l: Line[]) => rows.push(l);
  const text = (t: string, size = 10, font: Line["font"] = "F1", x = MARGIN): Line => ({ x, text: t, size, font });
  const gap = () => row(text("", 6));

  const orderNumber = d.request ? `${d.request.requestNumber}` : "";
  row(text("ORDER", 20, "F2"));
  row(text(`Order ${o.orderNumber}${orderNumber ? `   Request ${orderNumber}` : ""}`, 11));
  row(text(`Status: ${o.status.replace(/_/g, " ")}     Issued: ${dateTime(o.createdAt)}`, 10));
  gap();
  row(text("BUYER", 9, "F2"), text("SELLER", 9, "F2", 320));
  row(text(d.business?.name ?? "", 11, "F2"), text(d.supplier?.name ?? "", 11, "F2", 320));
  row(text(d.business?.address ?? "", 9), text([d.supplier?.city, d.supplier?.countryCode].filter(Boolean).join(", "), 9, "F1", 320));
  row(text("", 9), text(d.destination ? `Pays to ${shortAddress(d.destination.address)} (${d.destination.status})` : "No payment address", 9, "F1", 320));
  gap();

  const cols = (a: string, b: string, c: string, e: string) => `${pad(a, 34)} ${padL(b, 10)} ${padL(c, 12)} ${padL(e, 13)}`;
  row(text(cols("Item", "Qty", "Unit price", "Amount"), 9, "F3"));
  row(text("-".repeat(72), 9, "F3"));
  for (const it of d.items) row(text(cols(it.description, amount(it.quantity, 2).replace(/\.00$/, ""), amount(it.unitPrice), amount(it.totalPrice)), 9, "F3"));
  row(text("-".repeat(72), 9, "F3"));
  row(text(`${padL("Subtotal", 58)} ${padL(amount(o.subtotal), 13)}`, 9, "F3"));
  row(text(`${padL("Delivery", 58)} ${padL(amount(o.deliveryCost), 13)}`, 9, "F3"));
  row(text(`${padL(`TOTAL (${o.currency})`, 58)} ${padL(amount(o.totalAmount), 13)}`, 10, "F3"));
  gap();
  row(text(`Payment: ${amount(o.paymentAmount)} ${o.paymentAsset}`, 10, "F2"));
  row(text(`Terms: ${o.paymentTerms ?? "-"}`, 9));
  row(text(`Delivery: ${o.deliveryTerms ?? "-"}`, 9));
  gap();
  row(text("APPROVAL", 9, "F2"));
  row(text(o.approvedAt ? `Approved ${dateTime(o.approvedAt)}` : "Not yet approved. No payment has been made.", 9));
  if (o.approvedFingerprint) row(text(`Approval fingerprint: ${o.approvedFingerprint}`, 7, "F3"));
  gap();
  row(text("Generated by Procura. Amounts are recalculated on the server from unit prices.", 8));

  // Paginate by an approximate row budget.
  const pages: Line[][][] = [];
  let cur: Line[][] = [];
  let used = 0;
  for (const r of rows) {
    const h = Math.max(...r.map((l) => l.size)) + 5;
    if (used + h > PAGE_H - MARGIN * 2) { pages.push(cur); cur = []; used = 0; }
    cur.push(r); used += h;
  }
  if (cur.length) pages.push(cur);
  return buildPdf(pages);
}

export function downloadBytes(filename: string, bytes: Uint8Array, mime = "application/pdf"): void {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}
