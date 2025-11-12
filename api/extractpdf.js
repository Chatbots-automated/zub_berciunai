// api/extractpdf.js
const pdfParse = require("pdf-parse");

// ---------- helpers ----------
function toISO(d) {
  if (!d) return null;
  // YYYY[-./]MM[-./]DD
  let m = d.match(/^(\d{4})[-./](\d{2})[-./](\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // DD[-./]MM[-./]YYYY
  m = d.match(/^(\d{2})[-./](\d{2})[-./](\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

function normalizeSex(s) {
  if (!s) return null;
  const x = s.toLowerCase();
  if (x.startsWith("buliu")) return "Bulius";     // Bulius, Buliukas → Bulius (tweak if you want to keep Buliukas)
  if (x.startsWith("karv"))  return "Karvė";      // Karvė/Karve → Karvė
  if (x.startsWith("tely"))  return "Telyčaitė";  // Telytė/Telyte/Telyčia/Telycia → Telyčaitė
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

// ---------- core parser ----------
function parseAnimalsFromText(text) {
  // Find header region
  const headerPattern = /Eil\.\s*Nr\.[\s\S]*?Gimimo\s*data/i;
  const headerMatch = text.match(headerPattern);
  const startIdx = headerMatch ? text.indexOf(headerMatch[0]) : -1;

  const allLines = text
    .split(/\r?\n/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const headerIdx = allLines.findIndex(
    (l) => /Eil\.\s*Nr\./i.test(l) && /(Rūšis|Rusis)/i.test(l) && /Gimimo\s*data/i.test(l)
  );

  if (startIdx === -1 || headerIdx === -1) {
    return {
      rows: [],
      debug: { headerIdx, totalLines: allLines.length, startIdx, foundHeader: false },
    };
  }

  const body = text.slice(startIdx);

  // Row head: index + 'Galvijai' + tag
  const headRe = /(\d+)\s*Galvijai\s*(DE\d+|LT\d+)/gi;

  // Tokens/patterns inside a row slice
  const SEX_RE = /\b(Karvė|Karve|Telyčaitė|Telytė|Telyte|Telyčia|Telycia|Bulius|Buliukas)\b/i;
  const DATE_RE = /(\d{4}[-./]\d{2}[-./]\d{2}|\d{2}[-./]\d{2}[-./]\d{4})/; // first match after sex
  const AGE_RE  = /^\s*(\d+)(?:\s*(?:mėn|men)\.?)?/i;
  const PASS_RE = /[A-Z]{2}-\d+/;

  // Build segments between row heads
  const segments = [];
  let m;
  while ((m = headRe.exec(body)) !== null) {
    const idx = Number(m[1]);
    const tag = m[2];
    const start = m.index + m[0].length;
    segments.push({ idx, tag, start });
  }
  // Add end boundaries
  for (let i = 0; i < segments.length; i++) {
    segments[i].end = (i + 1 < segments.length) ? segments[i + 1].start - (segments[i + 1].tag.length + 0) : body.length;
  }

  const rows = [];
  for (let i = 0; i < segments.length; i++) {
    const { idx, tag, start, end } = segments[i];
    // Safer end: up to next head match index
    const nextHead = (function () {
      const m2 = headRe.exec(body); // headRe lastIndex is at end; reset and find next from this segment's start
      return null;
    })();
    const segEnd = (i + 1 < segments.length) ? segments[i + 1].start - (0) : end; // keep earlier computed end
    const slice = body.slice(start, segEnd);

    // 1) Sex (anchor)
    const sexMatch = slice.match(SEX_RE);
    if (!sexMatch) {
      // If sex missing, we still try to find date/age and leave sex null
    }
    const sex = sexMatch ? normalizeSex(sexMatch[0]) : null;
    const afterSexIdx = sexMatch ? (sexMatch.index + sexMatch[0].length) : 0;
    const afterSex = slice.slice(afterSexIdx);

    // 2) Date (first date after sex)
    const dateMatch = afterSex.match(DATE_RE) || slice.match(DATE_RE);
    const dateStrRaw = dateMatch ? dateMatch[0] : null;
    const dateISO = toISO(dateStrRaw);

    // 3) Age (digits right after found date)
    let ageMonths = null;
    if (dateMatch) {
      const afterDate = afterSex.slice(afterSex.indexOf(dateMatch[0]) + dateMatch[0].length);
      const ageMatch = afterDate.match(AGE_RE);
      if (ageMatch) ageMonths = Number(ageMatch[1]);
    }

    // 4) Breed (between sex and date)
    let breedRaw = null;
    if (sexMatch && dateMatch) {
      const breedRegion = afterSex.slice(0, afterSex.indexOf(dateMatch[0]));
      breedRaw = breedRegion.replace(/\s+/g, " ").trim();
    } else if (sexMatch) {
      // If date not found, take some reasonable chunk after sex as breed
      breedRaw = afterSex.replace(/\s+/g, " ").trim();
    }

    // 5) Passport (anywhere in slice)
    const passMatch = slice.match(PASS_RE);
    const passport = passMatch ? passMatch[0] : null;

    rows.push({
      row_index: idx,
      species: "galvijai",
      tag_no: tag,
      name: null,
      sex: sex,
      breed: breedRaw || null,
      birth_date: dateISO,
      age_months: Number.isFinite(ageMonths) ? ageMonths : null,
      passport: passport,
    });
  }

  // Dedup by tag (keep first)
  const seen = new Set();
  const unique = rows.filter((r) => !seen.has(r.tag_no) && seen.add(r.tag_no));

  return {
    rows: unique,
    debug: {
      headerIdx,
      totalLines: allLines.length,
      startIdx,
      foundHeader: true,
      matched: unique.length,
    },
  };
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
      const body = await new Promise((resolve, reject) => {
        let data = "";
        req.setEncoding("utf8");
        req.on("data", (ch) => (data += ch));
        req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
        req.on("error", reject);
      });
      if (!body || !body.url) {
        res.status(400).json({ error: "Provide raw PDF body or JSON { url }" });
        return;
      }
      const r = await fetch(body.url);
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
    const { rows, debug } = parseAnimalsFromText(parsed.text || "");

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ count: rows.length, animals: rows, debug });
  } catch (e) {
    console.error("[extractpdf] ERROR:", e);
    res.status(500).json({ error: e?.message || "parse_error" });
  }
};

// Next.js Pages API: disable body parser
module.exports.config = { api: { bodyParser: false } };
