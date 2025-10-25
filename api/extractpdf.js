// api/extractpdf.js
const pdfParse = require("pdf-parse");

// --- utils ---------------------------------------------------------------

function toISO(d) {
  if (!d) return null;
  const m1 = d.match(/^(\d{4})[-./](\d{2})[-./](\d{2})$/);               // 2025-10-25
  const m2 = d.match(/^(\d{2})[-./](\d{2})[-./](\d{4})$/);               // 25-10-2025
  if (m1) return `${m1[1]}-${m1[2]}-${m1[3]}`;
  if (m2) return `${m2[3]}-${m2[2]}-${m2[1]}`;
  return null;
}

function parseAnimalsFromText(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/\s+/g, " "))
    .filter(Boolean);

  const out = [];
  const rowRe =
    /^(\d+)\s+(\S+)\s+([A-Z]{2}\d+|LT\d+|DE\d+)\s+(\S+)\s+(\S+)\s+(.+?)\s+(\d{4}[-./]\d{2}[-./]\d{2}|\d{2}[-./]\d{2}[-./]\d{4})\s+(\d+)(?:\s+([A-Z0-9\-\/]+))?$/;

  for (const l of lines) {
    const m = l.match(rowRe);
    if (!m) continue;
    const [, , species, tag, name, sex, breedPlus, date, age, pass] = m;
    out.push({
      tag_no: tag || null,
      species: (species || "").toLowerCase() || null,
      name: name || null,
      sex: sex ? sex.charAt(0).toUpperCase() + sex.slice(1).toLowerCase() : null,
      breed: breedPlus || null,
      birth_date: toISO(date),
      age_months: age ? Number(age) : null,
      passport: pass || null,
    });
  }

  const seen = new Set();
  return out.filter((r) => r.tag_no && !seen.has(r.tag_no) && seen.add(r.tag_no));
}

// --- handler -------------------------------------------------------------

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST" });
    return;
  }

  try {
    const ct = (req.headers["content-type"] || "").toLowerCase();
    let pdfBuffer = null;

    if (ct.includes("application/pdf") || ct.includes("application/octet-stream")) {
      // RAW BINARY BODY (n8n "n8n Binary File")
      const chunks = [];
      await new Promise((resolve, reject) => {
        req.on("data", (c) => chunks.push(c));
        req.on("end", resolve);
        req.on("error", reject);
      });
      pdfBuffer = Buffer.concat(chunks);

    } else if (ct.includes("application/json")) {
      // JSON with { url }
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
      res.status(400).json({ error: "Unsupported content-type" });
      return;
    }

    const parsed = await pdfParse(pdfBuffer);
    const animals = parseAnimalsFromText(parsed.text);

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ count: animals.length, animals });
  } catch (e) {
    res.status(500).json({ error: e?.message || "parse_error" });
  }
};

// If used as Next.js Pages API route, disable body parser:
module.exports.config = { api: { bodyParser: false } };
