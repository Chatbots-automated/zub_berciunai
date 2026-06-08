// api/extractpdf.js
const pdfParse = require("pdf-parse");

// ---------- helpers ----------
function toISO(d) {
  if (!d) return null;

  // YYYY[-./]MM[-./]DD
  let m = String(d).match(/^(\d{4})[-./](\d{2})[-./](\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  // DD[-./]MM[-./]YYYY
  m = String(d).match(/^(\d{2})[-./](\d{2})[-./](\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;

  return null;
}

function normalizeSex(s) {
  if (!s) return null;

  const x = String(s).trim().toLowerCase();

  if (x.startsWith("buliuk")) return "Buliukas";
  if (x.startsWith("buliu")) return "Bulius";
  if (x.startsWith("karv")) return "Karvė";
  if (x.startsWith("tely")) return "Telyčaitė";

  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function parseAge(raw) {
  if (raw === null || raw === undefined || raw === "") return null;

  const n = Number(String(raw).replace(",", "."));

  if (!Number.isFinite(n)) return null;

  // Prevent summary garbage like 758 from becoming animal age
  if (n < 0 || n > 300) return null;

  return n;
}

function normalizeBreedSpacing(s) {
  if (!s) return null;

  return String(s)
    // Insert missing space when pdf-parse glues sex + breed:
    // BuliukasHolšteinai -> Buliukas Holšteinai
    // TelyčaitėLietuvos žalieji -> Telyčaitė Lietuvos žalieji
    .replace(
      /(Buliukas|Bulius|Karvė|Karve|Telyčaitė|Telycaite|Telytė|Telyte|Telyčia|Telycia)(?=[A-ZĄČĘĖĮŠŲŪŽ])/g,
      "$1 "
    )
    .replace(/\s+/g, " ")
    .trim();
}

function cleanBreed(s) {
  if (!s) return null;

  const cleaned = String(s)
    .replace(/\s+/g, " ")
    .replace(/\bwww\.zudc\.lt\b/gi, "")
    .replace(/\bGyvų gyvūnų sąrašas\b/gi, "")
    .replace(/\bSugrupuota statistika\b/gi, "")
    .replace(/\bIš viso ataskaitoje\b/gi, "")
    .replace(/\bIš viso registruota grupėmis\b/gi, "")

    // Remove sex if it somehow still leaked into breed
    .replace(
      /^(Buliukas|Bulius|Karvė|Karve|Telyčaitė|Telycaite|Telytė|Telyte|Telyčia|Telycia)\s*/i,
      ""
    )

    .trim();

  return cleaned || null;
}

function findSexMatch(slice) {
  if (!slice) return null;

  const normalized = normalizeBreedSpacing(slice);

  // No strict word boundary, because pdf-parse can glue:
  // BuliukasHolšteinai
  // KarvėHolšteinai
  // TelyčaitėLietuvos žalieji
  const SEX_RE =
    /(Telyčaitė|Telycaite|Telytė|Telyte|Telyčia|Telycia|Buliukas|Bulius|Karvė|Karve)/i;

  return normalized.match(SEX_RE);
}

function splitSexFromBreedIfNeeded(row) {
  if (!row) return row;

  // If sex is already detected, just make sure breed is clean
  if (row.sex) {
    row.breed = cleanBreed(normalizeBreedSpacing(row.breed));
    return row;
  }

  const breed = row.breed ? normalizeBreedSpacing(row.breed) : "";

  if (!breed) return row;

  // Handles:
  // BuliukasHolšteinai
  // Buliukas Lietuvos žalieji
  // TelyčaitėLietuvos žalieji
  // KarvėHolšteinai
  const gluedSexRe =
    /^(Telyčaitė|Telycaite|Telytė|Telyte|Telyčia|Telycia|Buliukas|Bulius|Karvė|Karve)\s*(.*)$/i;

  const m = breed.match(gluedSexRe);

  if (!m) return row;

  row.sex = normalizeSex(m[1]);
  row.breed = cleanBreed(m[2]);

  return row;
}

// ---------- core parser ----------
function parseAnimalsFromText(text) {
  const originalText = text || "";

  const allLines = originalText
    .split(/\r?\n/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const headerPattern = /Eil\.\s*Nr\.[\s\S]*?Gimimo\s*data/i;
  const headerMatch = originalText.match(headerPattern);
  const startIdx = headerMatch ? originalText.indexOf(headerMatch[0]) : -1;

  const headerIdx = allLines.findIndex(
    (l) =>
      /Eil\.\s*Nr\./i.test(l) &&
      /(Rūšis|Rusis)/i.test(l) &&
      /Gimimo\s*data/i.test(l)
  );

  if (startIdx === -1 || headerIdx === -1) {
    return {
      rows: [],
      debug: {
        headerIdx,
        totalLines: allLines.length,
        startIdx,
        foundHeader: false,
      },
    };
  }

  let body = originalText.slice(startIdx);

  // Cut off the summary/statistics/footer after the real animal table.
  // This prevents the last animal from eating:
  // "Karvė Iš viso: 758..."
  const stopMatch = body.search(
    /(?:Sugrupuota\s+statistika|Iš\s+viso\s+ataskaitoje|Iš\s+viso\s+registruota\s+grupėmis)/i
  );

  if (stopMatch !== -1) {
    body = body.slice(0, stopMatch);
  }

  // Row head: index + Galvijai + tag.
  // Use \s* because pdf-parse sometimes outputs:
  // "1 GalvijaiDE000..." or weird hidden spacing.
  const headRe = /(\d{1,6})\s*Galvijai\s*((?:DE|LT)\d{9,15})/gi;

  const DATE_RE =
    /(\d{4}[-./]\d{2}[-./]\d{2}|\d{2}[-./]\d{2}[-./]\d{4})/;

  const AGE_RE = /^\s*(\d+(?:[,.]\d+)?)(?:\s*(?:mėn|men)\.?)?/i;

  const PASS_RE = /[A-Z]{2}-\d+/;

  const heads = [];
  let m;

  while ((m = headRe.exec(body)) !== null) {
    heads.push({
      idx: Number(m[1]),
      tag: m[2],
      headStart: m.index,
      dataStart: headRe.lastIndex,
    });
  }

  const rows = [];

  for (let i = 0; i < heads.length; i++) {
    const current = heads[i];
    const next = heads[i + 1];

    // End row before the next row starts.
    const sliceEnd = next ? next.headStart : body.length;

    const rawSlice = body.slice(current.dataStart, sliceEnd);
    const slice = normalizeBreedSpacing(rawSlice.replace(/\s+/g, " ").trim());

    const sexMatch = findSexMatch(slice);
    const sex = sexMatch ? normalizeSex(sexMatch[0]) : null;

    const afterSexIdx = sexMatch ? sexMatch.index + sexMatch[0].length : 0;
    const afterSex = slice.slice(afterSexIdx).trim();

    const dateMatch = afterSex.match(DATE_RE) || slice.match(DATE_RE);
    const dateRaw = dateMatch ? dateMatch[0] : null;
    const birthDate = toISO(dateRaw);

    let ageMonths = null;
    let breedRaw = null;

    if (dateMatch && dateRaw) {
      const datePosInAfterSex = afterSex.indexOf(dateRaw);

      if (datePosInAfterSex !== -1) {
        breedRaw = afterSex.slice(0, datePosInAfterSex).trim();

        const afterDate = afterSex
          .slice(datePosInAfterSex + dateRaw.length)
          .trim();

        const ageMatch = afterDate.match(AGE_RE);

        if (ageMatch) {
          ageMonths = parseAge(ageMatch[1]);
        }
      } else {
        // Fallback if date was found in full slice but not after sex
        const datePosInSlice = slice.indexOf(dateRaw);

        if (datePosInSlice !== -1) {
          if (sexMatch) {
            const sexEndInSlice = sexMatch.index + sexMatch[0].length;
            breedRaw = slice.slice(sexEndInSlice, datePosInSlice).trim();
          } else {
            breedRaw = slice.slice(0, datePosInSlice).trim();
          }

          const afterDate = slice.slice(datePosInSlice + dateRaw.length).trim();
          const ageMatch = afterDate.match(AGE_RE);

          if (ageMatch) {
            ageMonths = parseAge(ageMatch[1]);
          }
        }
      }
    }

    const passMatch = slice.match(PASS_RE);
    const passport = passMatch ? passMatch[0] : null;

    let row = {
      row_index: current.idx,
      species: "galvijai",
      tag_no: current.tag,
      name: null,
      sex,
      breed: cleanBreed(normalizeBreedSpacing(breedRaw)),
      birth_date: birthDate,
      age_months: ageMonths,
      passport,
    };

    // Final safety repair:
    // If sex was missed and breed became "BuliukasHolšteinai",
    // split it here.
    row = splitSexFromBreedIfNeeded(row);

    // Keep only actual animal rows
    if (
      row.row_index &&
      row.tag_no &&
      /^(DE|LT)\d+$/i.test(row.tag_no) &&
      row.birth_date
    ) {
      rows.push(row);
    }
  }

  // Dedup by tag, keep first
  const seen = new Set();

  const unique = rows.filter((r) => {
    if (seen.has(r.tag_no)) return false;
    seen.add(r.tag_no);
    return true;
  });

  return {
    rows: unique,
    debug: {
      headerIdx,
      totalLines: allLines.length,
      startIdx,
      foundHeader: true,
      matched: unique.length,
      rawHeadsFound: heads.length,
      stoppedBeforeSummary: stopMatch !== -1,
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

    if (
      ct.includes("application/pdf") ||
      ct.includes("application/octet-stream")
    ) {
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

        req.on("data", (ch) => {
          data += ch;
        });

        req.on("end", () => {
          try {
            resolve(data ? JSON.parse(data) : {});
          } catch (e) {
            reject(e);
          }
        });

        req.on("error", reject);
      });

      if (!body || !body.url) {
        res.status(400).json({
          error: "Provide raw PDF body or JSON { url }",
        });
        return;
      }

      const r = await fetch(body.url);

      if (!r.ok) {
        res.status(400).json({
          error: "Cannot fetch URL",
          status: r.status,
        });
        return;
      }

      pdfBuffer = Buffer.from(await r.arrayBuffer());
    } else {
      res.status(400).json({
        error: "Unsupported content-type",
        contentType: ct,
      });
      return;
    }

    const parsed = await pdfParse(pdfBuffer);
    const { rows, debug } = parseAnimalsFromText(parsed.text || "");

    res.setHeader("Cache-Control", "no-store");

    res.status(200).json({
      count: rows.length,
      animals: rows,
      debug,
    });
  } catch (e) {
    console.error("[extractpdf] ERROR:", e);

    res.status(500).json({
      error: e?.message || "parse_error",
    });
  }
};

// Next.js Pages API: disable body parser
module.exports.config = {
  api: {
    bodyParser: false,
  },
};
