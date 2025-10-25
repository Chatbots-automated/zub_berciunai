// api/extractpdf.js
const pdfParse = require("pdf-parse");

// ---------- helpers ----------
function toISO(d) {
  if (!d) return null;
  const m1 = d.match(/^(\d{4})[-./](\d{2})[-./](\d{2})$/);
  const m2 = d.match(/^(\d{2})[-./](\d{2})[-./](\d{4})$/);
  if (m1) return `${m1[1]}-${m1[2]}-${m1[3]}`;
  if (m2) return `${m2[3]}-${m2[2]}-${m2[1]}`;
  return null;
}

// Character class incl. Lithuanian letters (upper+lower)
const LIT = "A-Za-zĄČĘĖĮŠŲŪŽąčęėįšųūž";
const WORD = `[${LIT}'’.-]+`;
const WORDS = `[${LIT} '’.-]+`;

/**
 * Parse animals by scanning the raw text from the header down with a global regex.
 * Rows in the PDF often have *no spaces* between columns, e.g.:
 *   1GalvijaiDE000123...KarvėHolšteinai2018-05-2189
 */
function parseAnimalsFromText(text) {
  // Find header line position in the raw text (not normalized)
  const headerPattern = /Eil\.\s*Nr\.[\s\S]*?Gimimo\s*data/i;
  const headerMatch = text.match(headerPattern);
  const startIdx = headerMatch ? text.indexOf(headerMatch[0]) : -1;

  // Derive a "preview lines" like before, for easier debugging
  const allLines = text.split(/\r?\n/).map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
  const headerIdx = allLines.findIndex((l) =>
    /Eil\.\s*Nr\./i.test(l) && /(Rūšis|Rusis)/i.test(l) && /Gimimo\s*data/i.test(l)
  );

  if (startIdx === -1 || headerIdx === -1) {
    return {
      rows: [],
      debug: { headerIdx, totalLines: allLines.length, startIdx, foundHeader: false }
    };
  }

  const body = text.slice(startIdx); // scan from header onwards

  // Global regex:
  //  index   species    tag                       (optional name)   sex                               breed              date           age     (optional passport)
  const rowRe = new RegExp(
    String.raw`(\d+)` +                 // 1: row index
    String.raw`\s*` +
    String.raw`(Galvijai)` +            // 2: species text (in these PDFs always "Galvijai")
    String.raw`\s*` +
    String.raw`(DE\d+|LT\d+)` +         // 3: tag (DE..., LT...)
    String.raw`\s*` +
    String.raw`(?:(${WORD})\s*)?` +     // 4: optional name (single token if present; usually absent)
    String.raw`(Karvė|Telyčaitė|Bulius|Telyciaite|Telyčia|Telycia)` + // 5: sex (variants)
    String.raw`\s*` +
    String.raw`(${WORDS}?)` +           // 6: breed (lazy; we’ll trim later)
    String.raw`(\d{4}-\d{2}-\d{2})` +   // 7: date (anchors the end of breed)
    String.raw`(\d+)` +                 // 8: age (often glued right after the date)
    String.raw`(?:\s*([A-Z]{2}-\d+))?` +// 9: optional passport (e.g., AF-096882)
    String.raw``,
    "g"
  );

  const rows = [];
  let m;
  while ((m = rowRe.exec(body)) !== null) {
    const [
      _,
      idx,
      speciesText,
      tag,
      nameMaybe,
      sexRaw,
      breedRaw,
      dateStr,
      ageStr,
      passport,
    ] = m;

    // Clean breed (it may include trailing spaces)
    const breed = (breedRaw || "").trim();

    rows.push({
      row_index: Number(idx),
      species: speciesText.toLowerCase(),
      tag_no: tag,
      name: nameMaybe || null,
      sex: sexRaw ? sexRaw.charAt(0).toUpperCase() + sexRaw.slice(1).toLowerCase() : null,
      breed: breed || null,
      birth_date: toISO(dateStr),
      age_months: ageStr ? Number(ageStr) : null,
      passport: passport || null,
    });
  }

  // Dedup by tag
  const seen = new Set();
  const unique = rows.filter((r) => !seen.has(r.tag_no) && seen.add(r.tag_no));

  return {
    rows: unique,
    debug: {
      headerIdx,
      totalLines: allLines.length,
      startIdx,
      foundHeader: true,
      previewAroundHeader: allLines.slice(Math.max(0, headerIdx - 2), headerIdx + 8),
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

    console.log("[extractpdf] content-type:", ct);
    console.log("[extractpdf] buffer bytes:", pdfBuffer ? pdfBuffer.length : 0);

    const parsed = await pdfParse(pdfBuffer);
    console.log("[extractpdf] text length:", parsed.text ? parsed.text.length : 0);

    const { rows, debug } = parseAnimalsFromText(parsed.text || "");
    console.log("[extractpdf] headerIdx:", debug.headerIdx, "startIdx:", debug.startIdx, "totalLines:", debug.totalLines);
    console.log("[extractpdf] matched rows:", debug.matched);

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({
      count: rows.length,
      animals: rows,
      debug,
    });
  } catch (e) {
    console.error("[extractpdf] ERROR:", e);
    res.status(500).json({ error: e?.message || "parse_error" });
  }
};

// Next.js Pages API: disable body parser
module.exports.config = { api: { bodyParser: false } };
