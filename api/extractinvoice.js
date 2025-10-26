// api/extractinvoice.js
const pdfParse = require("pdf-parse");

// ---------- utils ----------
function toISO(d) {
  if (!d) return null;
  const m1 = d.match(/^(\d{4})[.\-\/](\d{2})[.\-\/](\d{2})$/);
  const m2 = d.match(/^(\d{2})[.\-\/](\d{2})[.\-\/](\d{4})$/);
  if (m1) return `${m1[1]}-${m1[2]}-${m1[3]}`;
  if (m2) return `${m2[3]}-${m2[2]}-${m2[1]}`;
  return null;
}
// Normalize EU-style numbers: "14.000,00" → 14000.00 ; "0,04" → 0.04 ; "610 00" → 610.00
function num(s) {
  if (s == null) return null;
  const cleaned = String(s)
    .replace(/\s/g, "")
    .replace(/[^0-9,.\-]/g, "")       // keep digits, comma, dot, minus
    // treat dots as thousand sep when there is also a comma
    .replace(/(\d)\.(?=\d{3}([.,]|$))/g, "$1")
    .replace(",", ".");
  const v = Number(cleaned);
  return Number.isFinite(v) ? v : null;
}
function norm(s) { return (s || "").replace(/\s+/g, " ").trim(); }
function linesOf(text) { return (text || "").split(/\r?\n/).map(norm).filter(Boolean); }

// ---------- header parsing ----------
function parseHeader(text) {
  const t = text;

  // Invoice number
  // Handles: "PVM SĄSKAITA - FAKTŪRA AVNG serija Nr.0092292" or "... Nr.: 0092292" or simple "Nr. X"
  const nr =
    t.match(/Sąskaita\s*-\s*faktūra.*?(?:serija\s*)?Nr\.?\s*[:.]?\s*([A-Za-z0-9\-\/_.]+)/i) ||
    t.match(/PVM\s*SĄSKAITA.*?(?:serija\s*)?Nr\.?\s*[:.]?\s*([A-Za-z0-9\-\/_.]+)/i) ||
    t.match(/\b(?:Faktūra|Invoice)\s*Nr\.?\s*([A-Za-z0-9\-\/_.]+)/i) ||
    t.match(/\bNr\.?\s*([A-Za-z0-9\-\/_.]{4,})\b/);

  // Date (look for “2025 m. spalio 7 d.”, “2025-10-01”, “01.10.2025”, etc.)
  const dateRaw =
    t.match(/\b(20\d{2})\s*m\.\s*[^\d]{0,6}\s*(\d{1,2})\s*d\./i) ? // e.g., "2025 m. spalio 7 d."
      (() => {
        const m = t.match(/\b(20\d{2})\s*m\.\s*[^\d]{0,10}\s*(\d{1,2})\s*d\./i);
        // Month name not trivial; fallback to numeric date elsewhere if present.
        return null;
      })()
    : null;

  const dateMatch =
    t.match(/\b(?:Data|Išrašymo\s*data|Issue\s*date|202\d[-.\/]\d{2}[-.\/]\d{2}|\d{2}[-.\/]\d{2}[-.\/]202\d)\b.*?(\d{2}[.\-\/]\d{2}[.\-\/]20\d{2}|20\d{2}[.\-\/]\d{2}[.\-\/]\d{2})/) ||
    t.match(/\b(20\d{2}[.\-\/]\d{2}[.\-\/]\d{2})\b/) ||
    t.match(/\b(\d{2}[.\-\/]\d{2}[.\-\/]20\d{2})\b/);

  const currency = (t.match(/\b(EUR|USD|GBP|PLN)\b/) || [])[1] || "EUR";

  // Supplier
  const supVat = (t.match(/\b(PVM\s*kodas|VAT)\s*[:\-]?\s*([A-Z]{2}\d{5,12})/i) || [])[2] || null;
  const supCode = (t.match(/\b(Įmonės\s*kodas|Imonės\s*kodas|Kodas)\s*[:\-]?\s*(\d{7,})/i) || [])[2] || null;
  const iban = (t.match(/\bIBAN\s*[:\-]?\s*([A-Z]{2}[0-9A-Z]{13,34})\b/) || [])[1] || null;

  // Heuristics for supplier name: take the first “UAB/AB/MB/…” occurrence near bank/IBAN/VAT blocks
  let supplierName = null;
  const supNameRx = /^.*\b(UAB|AB|MB|IĮ|VŠĮ|ŪB)\b.*$/mi;
  const sn = t.match(supNameRx);
  if (sn) supplierName = norm(sn[0]);

  // Totals
  const totalNet = num((t.match(/\b(Suma\s*be\s*PVM|Tarpinė\s*suma|Net\s*amount)\s*[:\-]?\s*([0-9 .,\-]+)\b/i) || [])[2]);
  const totalVat = num((t.match(/\b(PVM\s*suma|PVM|VAT)\s*[:\-]?\s*([0-9 .,\-]+)\b/i) || [])[2]);
  const totalGross = num((t.match(/\b(Suma\s*su\s*PVM|Bendra\s*suma|Iš viso|Total)\s*[:\-]?\s*([0-9 .,\-]+)\b/i) || [])[2]);
  const vatRate = (t.match(/\bPVM\s*tarif(as|ai)?\s*[:\-]?\s*(\d{1,2})\s*%/i) || [])[2] ? parseInt((t.match(/\bPVM\s*tarif(as|ai)?\s*[:\-]?\s*(\d{1,2})\s*%/i) || [])[2], 10) : null;

  const invDateISO = dateMatch ? toISO(dateMatch[1] || dateMatch[0]) : null;

  return {
    supplier: {
      name: supplierName,
      code: supCode,
      vat_code: supVat,
      address: null,
      iban
    },
    invoice: {
      number: nr ? (nr[1] || nr[2]) : null,
      date: invDateISO,
      currency,
      total_net: totalNet,
      total_vat: totalVat,
      total_gross: totalGross,
      vat_rate: vatRate
    }
  };
}

// ---------- line parsing ----------
/**
 * We support two common patterns:
 *  (A) Full line with columns (SKU?) Desc ... Qty Unit Price VAT% Net VAT Gross
 *  (B) Minimal line: Desc ... Qty [Unit?] Price VAT% Gross
 * We stop when we hit totals lines like "Iš viso", "Suma", "Total".
 */
function parseLines(text) {
  const LIT = "A-Za-zĄČĘĖĮŠŲŪŽąčęėįšųūž";
  const UNIT = `[${LIT}%/\\.a-zA-Z]{1,8}`;
  const NUM = String.raw`(?:\d{1,3}(?:[ .]\d{3})*|\d+)(?:[.,]\d{2})?`; // 14.000,00 ; 0,04 ; 610 00
  const STOP = /(iš viso|viso|bendra suma|total)/i;

  const ls = linesOf(text);
  const out = [];
  let lineNo = 0;

  // Patterns
  const reFull = new RegExp(
    // optional SKU
    String.raw`^(?:(?<sku>[A-Z0-9\-\._]{2,})\s+)?` +
    // description (anything non-greedy until we can match quantities/prices)
    String.raw`(?<desc>.+?)\s+` +
    // quantity (may have comma) possibly glued to comma/paren (e.g., "200,00(" from Avena PDF)
    String.raw`(?<qty>${NUM})\s*[\(\)]?\s+` +
    // optional unit
    String.raw`(?:(?<unit>${UNIT})\s+)?` +
    // price
    String.raw`(?<price>${NUM})\s+` +
    // VAT %
    String.raw`(?<vat>\d{1,2})\s*%?\s+` +
    // net
    String.raw`(?<net>${NUM})\s+` +
    // vat amount
    String.raw`(?<vatamt>${NUM})\s+` +
    // gross
    String.raw`(?<gross>${NUM})\s*$`,
    "i"
  );

  const reMinimal = new RegExp(
    String.raw`^(?:(?<sku>[A-Z0-9\-\._]{2,})\s+)?` +
    String.raw`(?<desc>.+?)\s+` +
    String.raw`(?<qty>${NUM})\s*[\(\)]?\s+` +
    String.raw`(?:(?<unit>${UNIT})\s+)?` +
    String.raw`(?<price>${NUM})\s+` +
    String.raw`(?<vat>\d{1,2})\s*%?\s+` +
    String.raw`(?<gross>${NUM})\s*$`,
    "i"
  );

  for (const raw of ls) {
    if (!raw) continue;
    if (STOP.test(raw)) break;

    let m = raw.match(reFull) || raw.match(reMinimal);
    if (!m) continue;
    const g = m.groups || {};

    lineNo += 1;
    const qty = num(g.qty);
    const price = num(g.price);
    const vatRate = g.vat ? parseInt(g.vat, 10) : null;

    // derive numbers if missing
    let net = g.net ? num(g.net) : (price != null && qty != null ? +(price * qty).toFixed(2) : null);
    let gross = g.gross ? num(g.gross) : (net != null && vatRate != null ? +(net * (1 + vatRate / 100)).toFixed(2) : null);
    let vatAmt = g.vatamt ? num(g.vatamt) : (gross != null && net != null ? +(gross - net).toFixed(2) : null);

    out.push({
      line_no: lineNo,
      sku: g.sku || null,
      description: norm(g.desc),
      qty,
      unit: g.unit || null,
      unit_price: price,
      vat_rate: vatRate,
      net,
      vat: vatAmt,
      gross
    });
  }

  return { matched: out.length, lines: out };
}

// ---------- handler ----------
module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST" });
    return;
  }

  try {
    const ct = (req.headers["content-type"] || "").toLowerCase();
    let pdfBuffer = null;

    if (ct.includes("application/pdf") || ct.includes("application/octet-stream")) {
      const chunks = [];
      await new Promise((resolve, reject) => {
        req.on("data", (c) => chunks.push(c));
        req.on("end", resolve);
        req.on("error", reject);
      });
      pdfBuffer = Buffer.concat(chunks);
    } else if (ct.includes("application/json")) {
      let body = "";
      await new Promise((resolve, reject) => {
        req.setEncoding("utf8");
        req.on("data", (ch) => (body += ch));
        req.on("end", resolve);
        req.on("error", reject);
      });
      const b = body ? JSON.parse(body) : {};
      if (!b.url) {
        res.status(400).json({ error: "Provide raw PDF body or JSON { url }" });
        return;
      }
      const r = await fetch(b.url);
      if (!r.ok) {
        res.status(400).json({ error: "Cannot fetch URL" });
        return;
      }
      pdfBuffer = Buffer.from(await r.arrayBuffer());
    } else {
      res.status(400).json({ error: "Unsupported content-type", contentType: ct });
      return;
    }

    const parsed = await pdfParse(pdfBuffer);
    const text = parsed.text || "";

    const header = parseHeader(text);
    const items = parseLines(text);

    // Compute totals if missing
    const sumNet = items.lines.reduce((a, r) => a + (r.net || 0), 0);
    const sumVat = items.lines.reduce((a, r) => a + (r.vat || 0), 0);
    const sumGross = items.lines.reduce((a, r) => a + (r.gross || 0), 0);

    if (header.invoice.total_net == null && sumNet) header.invoice.total_net = +sumNet.toFixed(2);
    if (header.invoice.total_vat == null && sumVat) header.invoice.total_vat = +sumVat.toFixed(2);
    if (header.invoice.total_gross == null && sumGross) header.invoice.total_gross = +sumGross.toFixed(2);

    // Basic vendor hints (helps later if you want per-supplier tweaks)
    let vendor_hint = null;
    if (/Kalnapil/i.test(text)) vendor_hint = "Kalnapilis";
    if (/Avena/i.test(text)) vendor_hint = vendor_hint ? vendor_hint + ", Avena" : "Avena";

    // Logs (visible in Vercel Functions logs)
    console.log("[extractinvoice] bytes:", pdfBuffer.length, "text:", text.length, "lines:", items.matched, "vendor:", vendor_hint);

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({
      supplier: header.supplier,
      invoice: header.invoice,
      lines: items.lines,
      vendor_hint,
      debug: { text_len: text.length, matched_lines: items.matched }
    });
  } catch (e) {
    console.error("[extractinvoice] ERROR:", e);
    res.status(500).json({ error: e?.message || "parse_error" });
  }
};

// Next.js Pages API compatibility:
module.exports.config = { api: { bodyParser: false } };
