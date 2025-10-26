// api/extractinvoice.js
const pdfParse = require("pdf-parse");

// ---------- utils ----------
function norm(s) { return (s || "").replace(/\s+/g, " ").trim(); }
function linesOf(text) { return (text || "").split(/\r?\n/).map(norm).filter(Boolean); }
function toISO(d) {
  if (!d) return null;
  const m1 = d.match(/^(\d{4})[.\-\/](\d{2})[.\-\/](\d{2})$/);
  const m2 = d.match(/^(\d{2})[.\-\/](\d{2})[.\-\/](\d{4})$/);
  if (m1) return `${m1[1]}-${m1[2]}-${m1[3]}`;
  if (m2) return `${m2[3]}-${m2[2]}-${m2[1]}`;
  return null;
}
// EU number normalizer: "14.000,00" → 14000.00 ; "2.521" → 2.521 ; "610 00" → 610.00
function num(s) {
  if (s == null) return null;
  let t = String(s).replace(/\s/g, "").replace(/[^0-9,.\-]/g, "");
  // remove thousand dots when a comma/decimal exists
  t = t.replace(/(\d)\.(?=\d{3}([.,]|$))/g, "$1");
  // if there are both dot and comma, assume comma is decimal
  if (t.includes(",") && t.includes(".")) t = t.replace(/\./g, "").replace(",", ".");
  else t = t.replace(",", ".");
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

function mostRecentDate(text) {
  const ds = [];
  const rx = /\b(\d{2}[.\-\/]\d{2}[.\-\/]\d{4}|\d{4}[.\-\/]\d{2}[.\-\/]\d{2})\b/g;
  let m;
  while ((m = rx.exec(text))) {
    const iso = toISO(m[1]);
    if (iso) ds.push(iso);
  }
  ds.sort(); // lexicographic works for ISO
  return ds.length ? ds[ds.length - 1] : null;
}

function between(text, startMarker, endMarker) {
  const s = text.indexOf(startMarker);
  if (s === -1) return null;
  const e = text.indexOf(endMarker, s + startMarker.length);
  return e === -1 ? text.slice(s + startMarker.length) : text.slice(s + startMarker.length, e);
}

// ---------- header parsing ----------
function parseHeader(text) {
  const t = text;

  // Prefer dates near "Serija" or an explicit "Data" label
  const serDate = (t.match(/Serija[^\n\r]*?\b(\d{2}[.\-\/]\d{2}[.\-\/]\d{4})\b/i) || [])[1];
  const labeledDate = (t.match(/\b(Išrašymo|Išdavimo|Data|Issue)\s*[:\-]?\s*(\d{2}[.\-\/]\d{2}[.\-\/]\d{4}|\d{4}[.\-\/]\d{2}[.\-\/]\d{2})/i) || [])[2];
  const dateISO = toISO(serDate || labeledDate) || mostRecentDate(t);

  // Invoice number (catch “PVM SĄSKAITA… serija Nr.0092292”, “Serija DBG/Data 5250125994/01.10.2025” etc.)
  const nr =
    (t.match(/Sąskaita\s*-\s*faktūra[^\n\r]*?\b(?:serija)?\s*Nr\.?\s*[:.]?\s*([A-Za-z0-9\-\/_.]+)/i) || [])[1] ||
    (t.match(/\bSerija[^\n\r]*?\b([A-Z0-9\-\/_.]{5,})\b/i) || [])[1] ||
    (t.match(/\b(?:Faktūra|Invoice)\s*Nr\.?\s*([A-Za-z0-9\-\/_.]+)/i) || [])[1] ||
    (t.match(/\bNr\.?\s*([A-Za-z0-9\-\/_.]{4,})\b/) || [])[1] || null;

  // Split by labeled blocks for better supplier detection
  const supplierBlock = between(t, "Tiekėjas", "Pirkėjas") || between(t, "Tiekėjas:", "Pirkėjas:") || null;

  // Supplier fields
  let supplierName = null, supVat = null, supCode = null, iban = null;
  if (supplierBlock) {
    const sb = supplierBlock;
    supplierName = (sb.match(/^.*\b(UAB|AB|MB|IĮ|VŠĮ|ŪB)\b.*$/mi) || [])[0] || null;
    supVat = (sb.match(/\b(PVM\s*kodas|VAT)\s*[:\-]?\s*([A-Z]{2}\d{5,12})/i) || [])[2] || null;
    supCode = (sb.match(/\b(Įmonės\s*kodas|Imonės\s*kodas|Kodas)\s*[:\-]?\s*(\d{7,})/i) || [])[2] || null;
    iban = (sb.match(/\bIBAN\s*[:\-]?\s*([A-Z]{2}[0-9A-Z]{13,34})\b/) || [])[1] || null;
  } else {
    // fallback: whole text
    supplierName = (t.match(/^.*\b(UAB|AB|MB|IĮ|VŠĮ|ŪB)\b.*$/mi) || [])[0] || null;
    supVat = (t.match(/\b(PVM\s*kodas|VAT)\s*[:\-]?\s*([A-Z]{2}\d{5,12})/i) || [])[2] || null;
    supCode = (t.match(/\b(Įmonės\s*kodas|Imonės\s*kodas|Kodas)\s*[:\-]?\s*(\d{7,})/i) || [])[2] || null;
    iban = (t.match(/\bIBAN\s*[:\-]?\s*([A-Z]{2}[0-9A-Z]{13,34})\b/) || [])[1] || null;
  }

  // Currency
  const currency = (t.match(/\b(EUR|USD|GBP|PLN)\b/) || [])[1] || "EUR";

  // Totals
  const totalNet =
    num((t.match(/\b(PVM\s*apmokestinama\s*suma|Suma\s*be\s*PVM|Tarpinė\s*suma|Net\s*amount)\s*[:\-]?\s*([0-9 .,\-]+)\b/i) || [])[2]);
  const totalVat =
    num((t.match(/\b(PVM\s*suma|VAT)\s*[:\-]?\s*([0-9 .,\-]+)\b/i) || [])[2]);
  const totalGross =
    num((t.match(/\b(Iš\s*viso|Bendra\s*suma|Total|Suma\s*su\s*PVM)\s*[:\-]?\s*([0-9 .,\-]+)\b/i) || [])[2]);

  const vatRate = (t.match(/\bPVM\s*tarif(as|ai)?\s*[:\-]?\s*(\d{1,2})\s*%/i) || [])[2]
    ? parseInt((t.match(/\bPVM\s*tarif(as|ai)?\s*[:\-]?\s*(\d{1,2})\s*%/i) || [])[2], 10)
    : null;

  return {
    supplier: {
      name: supplierName ? norm(supplierName) : null,
      code: supCode || null,
      vat_code: supVat || null,
      address: null,
      iban: iban || null,
    },
    invoice: {
      number: nr,
      date: dateISO,
      currency,
      total_net: totalNet,
      total_vat: totalVat,
      total_gross: totalGross,
      vat_rate: vatRate
    }
  };
}

// ---------- lines parsing ----------
function parseLines(text) {
  const LIT = "A-Za-zĄČĘĖĮŠŲŪŽąčęėįšųūž";
  const UNIT = `[${LIT}%/\\.a-zA-Z]{1,8}`;
  // allow 2–4 decimals
  const NUM = String.raw`(?:\d{1,3}(?:[ .]\d{3})*|\d+)(?:[.,]\d{2,4})?`;
  const STOP = /(iš viso|viso|bendra suma|total)/i;

  const ls = linesOf(text);
  const out = [];
  let lineNo = 0;

  // (1) Full table: Desc … Qty Unit Price VAT% Net VAT Gross  (Avena)
  const reFull = new RegExp(
    String.raw`^(?:(?<sku>[A-Z0-9\-\._]{2,})\s+)?` +
    String.raw`(?<desc>.+?)\s+` +
    String.raw`(?<qty>${NUM})\s*` +
    String.raw`(?:(?<unit>${UNIT})\s+)?` +
    String.raw`(?<price>${NUM})\s+` +
    String.raw`(?<vat>\d{1,2})\s*%?\s+` +
    String.raw`(?<net>${NUM})\s+` +
    String.raw`(?<vatamt>${NUM})\s+` +
    String.raw`(?<gross>${NUM})\s*$`,
    "i"
  );

  // (2) Four columns: Desc … Qty Unit Price Sum  (Kalnapilis)
  const reFour = new RegExp(
    String.raw`^(?:(?<sku>[A-Z0-9\-\._]{2,})\s+)?` +
    String.raw`(?<desc>.+?)\s+` +
    String.raw`(?<qty>${NUM})\s+` +
    String.raw`(?<unit>${UNIT})\s+` +
    String.raw`(?<price>${NUM})\s+` +
    String.raw`(?<sum>${NUM})\s*$`,
    "i"
  );

  // (3) Minimal fallback
  const reMin = new RegExp(
    String.raw`^(?:(?<sku>[A-Z0-9\-\._]{2,})\s+)?` +
    String.raw`(?<desc>.+?)\s+` +
    String.raw`(?<qty>${NUM})\s*` +
    String.raw`(?:(?<unit>${UNIT})\s+)?` +
    String.raw`(?<price>${NUM})` +
    String.raw`(?:\s+(?<gross>${NUM}))?\s*$`,
    "i"
  );

  for (const raw of ls) {
    if (!raw) continue;
    if (STOP.test(raw)) break;

    let g = null, kind = null;
    let m = raw.match(reFull);
    if (m) { g = m.groups || {}; kind = "full"; }
    else if ((m = raw.match(reFour))) { g = m.groups || {}; kind = "four"; }
    else if ((m = raw.match(reMin))) { g = m.groups || {}; kind = "min"; }
    if (!g) continue;

    lineNo += 1;

    const qty = num(g.qty);
    const unit = g.unit || null;
    const price = num(g.price);
    let net = g.net ? num(g.net) : null;
    let vatRate = g.vat ? parseInt(g.vat, 10) : null;
    let vatAmt = g.vatamt ? num(g.vatamt) : null;
    let gross = g.gross ? num(g.gross) : null;

    // For the four-column layout: sum is net (no VAT column on row)
    if (kind === "four") {
      net = num(g.sum);
      // header totals will provide VAT; we keep row vat null
    }
    // For minimal: derive net/gross when possible
    if (!net && qty != null && price != null) net = +(qty * price).toFixed(2);
    if (!gross && net != null && vatRate != null) gross = +(net * (1 + vatRate/100)).toFixed(2);
    if (!vatAmt && gross != null && net != null) vatAmt = +(gross - net).toFixed(2);

    out.push({
      line_no: lineNo,
      sku: g.sku || null,
      description: norm(g.desc),
      qty, unit, unit_price: price,
      vat_rate: vatRate,
      net, vat: vatAmt, gross,
      _kind: kind
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
      if (!b.url) { res.status(400).json({ error: "Provide raw PDF body or JSON { url }" }); return; }
      const r = await fetch(b.url);
      if (!r.ok) { res.status(400).json({ error: "Cannot fetch URL" }); return; }
      pdfBuffer = Buffer.from(await r.arrayBuffer());
    } else {
      res.status(400).json({ error: "Unsupported content-type", contentType: ct });
      return;
    }

    const parsed = await pdfParse(pdfBuffer);
    const text = parsed.text || "";

    const header = parseHeader(text);
    const items = parseLines(text);

    // Compute totals if missing (and align four-col rows with header VAT if present)
    const sumNet = items.lines.reduce((a, r) => a + (r.net || 0), 0);
    const sumVat = items.lines.reduce((a, r) => a + (r.vat || 0), 0);
    const sumGross = items.lines.reduce((a, r) => a + (r.gross || 0), 0);

    if (header.invoice.total_net == null && sumNet) header.invoice.total_net = +sumNet.toFixed(2);
    if (header.invoice.total_vat == null && sumVat) header.invoice.total_vat = +sumVat.toFixed(2);
    if (header.invoice.total_gross == null && sumGross) header.invoice.total_gross = +sumGross.toFixed(2);

    // Vendor hint for future vendor-specific tweaks
    let vendor_hint = null;
    if (/Kalnapil/i.test(text)) vendor_hint = "Kalnapilis";
    if (/Avena/i.test(text)) vendor_hint = vendor_hint ? vendor_hint + ", Avena" : "Avena";

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({
      supplier: header.supplier,
      invoice: header.invoice,
      lines: items.lines.map(({ _kind, ...r }) => r),
      vendor_hint,
      debug: {
        text_len: text.length,
        matched_lines: items.matched,
        kinds: items.lines.reduce((acc, r) => (acc[r._kind] = (acc[r._kind]||0)+1, acc), {})
      }
    });
  } catch (e) {
    console.error("[extractinvoice] ERROR:", e);
    res.status(500).json({ error: e?.message || "parse_error" });
  }
};

module.exports.config = { api: { bodyParser: false } };
