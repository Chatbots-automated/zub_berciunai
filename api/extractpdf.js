// api/extractpdf.js
const pdfParse = require("pdf-parse");

// ---------- helpers ----------
function toISO(d) {
  if (!d) return null;
  const m1 = d.match(/^(\d{4})[-./](\d{2})[-./](\d{2})$/); // 2025-10-25
  const m2 = d.match(/^(\d{2})[-./](\d{2})[-./](\d{4})$/); // 25-10-2025
  if (m1) return `${m1[1]}-${m1[2]}-${m1[3]}`;
  if (m2) return `${m2[3]}-${m2[2]}-${m2[1]}`;
  return null;
}

function normalizeLine(s) {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Parse animals strictly starting after the header row:
 * "Eil. Nr. Rūšis Numeris Vardas Lytis Veislė Gimimo data Amžius Paso Serija | Numeris"
 */
function parseAnimalsFromText(text) {
  const allLines = text.split(/\r?\n/).map(normalizeLine).filter(Boolean);

  // Find the header line (tolerate diacritics / capitalization)
  const headerIdx = allLines.findIndex((l) =>
    /Eil\.\s*Nr\./i.test(l) &&
    /(Rūšis|Rusis)/i.test(l) &&
    /Numeris/i.test(l) &&
    /Gimimo\s*data/i.test(l)
  );

  // If header not found, bail early
  if (headerIdx === -1) {
    return { rows: [], debug: { headerIdx, totalLines: allLines.length } };
  }

  const lines = allLines.slice(headerIdx + 1);

  const out = [];
  /**
   * Row pattern:
   *  idx  species  tag   [optional name]  sex  breed....   date         age  [passport]
   *  1    Galvijai DE... (Jonė)           Karvė Holšteinai 2018-05-21   89   AF-...
   *
   * - name is optional because in many reports it's blank
   * - breed can be multi-word; we lazily grab until the date
   */
  const rowRe =
    /^(\d+)\s+(\S+)\s+([A-Z]{2}\d+|LT\d+|DE\d+)\s+(?:(\S+)\s+)?(\S+)\s+(.+?)\s+(\d{4}[-./]\d{2}[-./]\d{2}|\d{2}[-./]\d{2}[-./]\d{4})\s+(\d+)(?:\s+([A-Z0-9\-\/]+))?$/;

  for (const l of lines) {
    const m = l.match(rowRe);
    if (!m) continue;
    const [, idx, species, tag, nameMaybe, sex, breedPlus, date, age, pass] = m;

    out.push({
      row_index: Number(idx),
      tag_no: tag || null,
      species: (species || "").toLowerCase() || null,
      name: nameMaybe || null,
      sex: sex ? sex.charAt(0).toUpperCase() + sex.slice(1).toLowerCase() : null,
      breed: breedPlus || null,
      birth_date: toISO(date),
      age_months: age ? Number(age) : null,
      passport: pass || null,
      _raw: l,
    });
  }

  // Deduplicate by tag_no
  const seen = new Set();
  const rows = out.filter((r) => {
    if (!r.tag_no) return false;
    if (seen.has(r.tag_no)) return false;
    seen.add(r.tag_no);
    return true;
  });

  return {
    rows,
    debug: {
      headerIdx,
      totalLines: allLines.length,
      previewAroundHeader: allLines.slice(Math.max(0, headerIdx - 2), headerIdx + 8),
      matched: rows.length,
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
        req.on("end", () => {
          try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); }
        });
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

    // ---- LOGS (show in Vercel → Functions → Logs) ----
    console.log("[extractpdf] content-type:", ct);
    console.log("[extractpdf] buffer bytes:", pdfBuffer ? pdfBuffer.length : 0);

    const parsed = await pdfParse(pdfBuffer);
    console.log("[extractpdf] text length:", parsed.text ? parsed.text.length : 0);

    const { rows, debug } = parseAnimalsFromText(parsed.text || "");
    console.log("[extractpdf] headerIdx:", debug.headerIdx, "totalLines:", debug.totalLines);
    console.log("[extractpdf] previewAroundHeader:", debug.previewAroundHeader);
    console.log("[extractpdf] matched rows:", debug.matched);

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({
      count: rows.length,
      animals: rows.map(({ _raw, ...r }) => r), // don’t return _raw by default
      debug,                                   // keep debug for now while tuning
    });
  } catch (e) {
    console.error("[extractpdf] ERROR:", e);
    res.status(500).json({ error: e?.message || "parse_error" });
  }
};

// If used as Next.js Pages API route, disable body parser:
module.exports.config = { api: { bodyParser: false } };
