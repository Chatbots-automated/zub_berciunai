// Works as a Vercel Serverless Function (api/extractpdf.js)
// and as a Next.js Pages API route (pages/api/extractpdf.js)

const pdfParse = require("pdf-parse");
const formidable = require("formidable");

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
  // idx species tag name sex breed... date age [passport?]
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
  return out.filter((r) => {
    if (!r.tag_no) return false;
    if (seen.has(r.tag_no)) return false;
    seen.add(r.tag_no);
    return true;
  });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function readMultipart(req) {
  return new Promise((resolve, reject) => {
    const form = formidable({ multiples: false, maxFileSize: 50 * 1024 * 1024 }); // 50MB
    form.parse(req, (err, fields, files) => {
      if (err) return reject(err);
      resolve({ fields, files });
    });
  });
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

    if (ct.includes("multipart/form-data")) {
      const { files } = await readMultipart(req);
      const f = files.file; // field name must be "file"
      if (!f) {
        res.status(400).json({ error: "file missing (multipart field 'file')" });
        return;
      }
      // formidable gives { filepath } in v3
      const fs = require("fs");
      pdfBuffer = fs.readFileSync(f.filepath);
    } else if (ct.includes("application/json")) {
      const body = await readJsonBody(req);
      if (!body || !body.url) {
        res.status(400).json({ error: "Provide multipart 'file' or JSON { url }" });
        return;
      }
      const fetchRes = await fetch(body.url);
      if (!fetchRes.ok) {
        res.status(400).json({ error: "Cannot fetch URL" });
        return;
      }
      const arrBuf = await fetchRes.arrayBuffer();
      pdfBuffer = Buffer.from(arrBuf);
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

// For Next.js Pages API (ignored by Vercel raw functions):
// - disables the built-in body parser so multipart works.
module.exports.config = {
  api: { bodyParser: false }
};
