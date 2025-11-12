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

// Lithuanian letters
const LIT = "A-Za-zĄČĘĖĮŠŲŪŽąčęėįšųūž";

// Normalize sex to a canonical label
function normalizeSex(s) {
  if (!s) return null;
  const x = s.toLowerCase();
  if (x.startsWith("buliu")) return "Bulius";     // Bulius, Buliukas → Bulius (change if you want to keep 'Buliukas')
  if (x.startsWith("karv"))  return "Karvė";      // Karvė/Karve → Karvė
  if (x.startsWith("tely"))  return "Telyčaitė";  // Telytė/Telyte/Telyčia/Telycia → Telyčaitė
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/**
 * Parse animals by scanning the raw text from the header down.
 */
function parseAnimalsFromText(text) {
  // Find header region (work on raw text for glued columns)
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

  // Sex variants (diacritics + ASCII fallbacks)
  const SEX = "(Karvė|Karve|Telyčaitė|Telytė|Telyte|Telyčia|Telycia|Bulius|Buliukas)";
  // Breed can contain letters, digits, spaces, %, /, (), +, &, commas, dots, hyphens, and even newlines.
  const BREED_CHARS = `${LIT}0-9%/()&+.,\\-\\s`;

  /**
   * Ultra-robust row regex:
   * - Index + 'Galvijai' + Tag
   * - Then: ANYTHING (name, junk) lazily until the first SEX token → capture that SEX
   * - Then: BREED lazily until an ISO date → capture that BREED
   * - Then: DATE + AGE + optional PASSPORT
   */
  const rowRe = new RegExp(
    String.raw`(\d+)` +                           // 1: row index
    String.raw`\s*` +
    String.raw`(Galvijai)` +                      // 2: species text
    String.raw`\s*` +
    String.raw`(DE\d+|LT\d+)` +                   // 3: tag
    String.raw`[\s\S]*?` +                        //    (optional name/junk of arbitrary length)
    String.raw`(${SEX})` +                        // 4: sex token (first one after tag)
    String.raw`\s*` +
    String.raw`([${BREED_CHARS}]*?)` +            // 5: breed (very permissive)
    String.raw`(?=\d{4}-\d{2}-\d{2})` +           //     stop right before date
    String.raw`(\d{4}-\d{2}-\d{2})` +             // 6: birth date
    String.raw`(\d+)` +                           // 7: age in months glued to date
    String.raw`(?:\s*([A-Z]{2}-\d+))?`,           // 8: optional passport like AF-096882
    "gi"
  );

  const rows = [];
  let m;
  while ((m = rowRe.exec(body)) !== null) {
    const [
      _,
      idx,
      speciesText,
      tag,
      sexRaw,     // group 4 (already matched by SEX)
      breedRaw,   // group 5
      dateStr,    // group 6
      ageStr,     // group 7
      passport,   // group 8
    ] = m;

    const breed = (breedRaw || "").replace(/\s+/g, " ").trim();

    rows.push({
      row_index: Number(idx),
      species: (speciesText || "").toLowerCase(),
      tag_no: tag,
      name: null, // name is intentionally skipped in this robust parser
      sex: normalizeSex(sexRaw || null),
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
