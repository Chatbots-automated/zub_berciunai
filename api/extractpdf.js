// api/extractpdf.js
const pdfParse = require("pdf-parse");

// ---------- helpers ----------
function toISO(d) {
  if (!d) return null;

  let m = String(d).match(/^(\d{4})[-./](\d{2})[-./](\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  m = String(d).match(/^(\d{2})[-./](\d{2})[-./](\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;

  return null;
}

function normalizeText(s) {
  return String(s || "")
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\r/g, "\n");
}

function normalizeOneLine(s) {
  return normalizeText(s)
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLithuanianSpecies(s) {
  if (!s) return null;

  const x = String(s).trim().toLowerCase();

  const map = {
    galvijai: "galvijai",
    arkliai: "arkliai",
    avys: "avys",
    avis: "avys",
    ožkos: "ozkos",
    ozkos: "ozkos",
    kiaulės: "kiaules",
    kiaules: "kiaules",
    vištos: "vistos",
    vistos: "vistos",
    triušiai: "triusiai",
    triusiai: "triusiai",
    paukščiai: "pauksciai",
    pauksciai: "pauksciai",
  };

  return map[x] || x;
}

function normalizeSex(s) {
  if (!s) return null;

  const x = String(s).trim().toLowerCase();

  // Galvijai
  if (x.startsWith("buliuk")) return "Buliukas";
  if (x.startsWith("buliu")) return "Bulius";
  if (x.startsWith("karv")) return "Karvė";
  if (x.startsWith("tely")) return "Telyčaitė";

  // Arkliai
  if (x.startsWith("eržil") || x.startsWith("erzil")) return "Eržilas";
  if (x.startsWith("kumel")) return "Kumelė";
  if (x.startsWith("kastr")) return "Kastratas";

  // Other animals, future support
  if (x.startsWith("avinas")) return "Avinas";
  if (x.startsWith("avis")) return "Avis";
  if (x.startsWith("ėriuk") || x.startsWith("eriuk")) return "Ėriukas";
  if (x.startsWith("ožka") || x.startsWith("ozka")) return "Ožka";
  if (x.startsWith("ožys") || x.startsWith("ozys")) return "Ožys";
  if (x.startsWith("paršav") || x.startsWith("parsav")) return "Paršavedė";
  if (x.startsWith("kuil")) return "Kuilys";

  return String(s).charAt(0).toUpperCase() + String(s).slice(1).toLowerCase();
}

function parseAge(raw) {
  if (raw === null || raw === undefined || raw === "") return null;

  const n = Number(String(raw).replace(",", "."));

  if (!Number.isFinite(n)) return null;
  if (n < 0 || n > 400) return null;

  return n;
}

function parseCount(raw) {
  if (raw === null || raw === undefined || raw === "") return null;

  const n = Number(String(raw).replace(",", "."));

  if (!Number.isFinite(n)) return null;

  return n;
}

const SEX_WORDS =
  "Telyčaitė|Telycaite|Telytė|Telyte|Telyčia|Telycia|Buliukas|Bulius|Karvė|Karve|Eržilas|Erzilas|Kumelė|Kumele|Kastratas|Avis|Avinas|Ėriukas|Eriukas|Ožka|Ozka|Ožys|Ozys|Paršavedė|Parsavede|Kuilys";

function normalizeBreedSpacing(s) {
  if (!s) return null;

  return String(s)
    .replace(
      new RegExp(`(${SEX_WORDS})(?=[A-ZĄČĘĖĮŠŲŪŽ])`, "g"),
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
    .replace(/\bDeklaruota gyvūnų\b/gi, "")
    .replace(new RegExp(`^(${SEX_WORDS})\\s*`, "i"), "")
    .trim();

  return cleaned || null;
}

function cleanName(s) {
  if (!s) return null;

  let name = String(s)
    .replace(/\s+/g, " ")
    .trim();

  if (!name) return null;

  const onlyUpperNameChars = /^[A-ZĄČĘĖĮŠŲŪŽ\s.'-]+$/u.test(name);

  if (onlyUpperNameChars) {
    name = name.replace(/\s+/g, "");
  }

  return name || null;
}

function findSexMatch(slice) {
  if (!slice) return null;

  const normalized = normalizeBreedSpacing(slice);
  const SEX_RE = new RegExp(`(${SEX_WORDS})`, "i");

  return normalized.match(SEX_RE);
}

function splitSexFromBreedIfNeeded(row) {
  if (!row) return row;

  if (row.sex) {
    row.breed = cleanBreed(normalizeBreedSpacing(row.breed));
    return row;
  }

  const breed = row.breed ? normalizeBreedSpacing(row.breed) : "";

  if (!breed) return row;

  const gluedSexRe = new RegExp(`^(${SEX_WORDS})\\s*(.*)$`, "i");
  const m = breed.match(gluedSexRe);

  if (!m) return row;

  row.sex = normalizeSex(m[1]);
  row.breed = cleanBreed(m[2]);

  return row;
}

function truncateRowSlice(s) {
  if (!s) return "";

  const raw = String(s);

  const stops = [
    /www\.zudc\.lt/i,
    /Gyvų gyvūnų sąrašas/i,
    /Sugrupuota\s+statistika/i,
    /Iš\s+viso\s+ataskaitoje/i,
    /Iš\s+viso\s+registruota\s+grupėmis/i,
    /Deklaruota\s+gyvūnų/i,
    /\n\s*\d+\.\s+Laikytojas/i,
    /Eil\.\s*Nr\.\s*Rūšis\s*Grupė\s*Gyvūnų\s*skaičius/i,
  ];

  let cut = raw.length;

  for (const re of stops) {
    const idx = raw.search(re);
    if (idx !== -1 && idx < cut) cut = idx;
  }

  return raw.slice(0, cut);
}

function isLikelyIndividualSpecies(speciesRaw) {
  const s = normalizeLithuanianSpecies(speciesRaw);

  return [
    "galvijai",
    "arkliai",
    "avys",
    "ozkos",
    "kiaules",
    "triusiai",
  ].includes(s);
}

// ---------- header / section helpers ----------
function getHeaderDebug(originalText) {
  const text = normalizeText(originalText);

  const allLines = text
    .split(/\n/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const headerPattern = /Eil\.\s*Nr\.[\s\S]*?Gimimo\s*data/i;
  const headerMatch = text.match(headerPattern);
  const startIdx = headerMatch ? text.indexOf(headerMatch[0]) : -1;

  const headerIdx = allLines.findIndex(
    (l) =>
      /Eil\.\s*Nr\./i.test(l) &&
      /(Rūšis|Rusis)/i.test(l) &&
      /Gimimo\s*data/i.test(l)
  );

  return {
    allLines,
    headerIdx,
    startIdx,
    foundHeader: startIdx !== -1 || headerIdx !== -1,
  };
}

// ---------- individual animal parser ----------
function parseIndividualAnimalsFromText(originalText) {
  const text = normalizeText(originalText || "");

  const { allLines, headerIdx, startIdx, foundHeader } = getHeaderDebug(text);

  if (!foundHeader) {
    return {
      rows: [],
      debug: {
        headerIdx,
        totalLines: allLines.length,
        startIdx,
        foundHeader: false,
        rawHeadsFound: 0,
        rawHeadsFoundNormalized: 0,
      },
    };
  }

  // KEY FIX:
  // Use BOTH raw body and normalized one-line body.
  // Some PDFs fail on raw text because row columns are broken strangely.
  const bodyRaw = startIdx !== -1 ? text.slice(startIdx) : text;
  const bodyNormalized = normalizeOneLine(bodyRaw);

  const headReRaw =
    /(\d{1,6})\s*([A-ZĄČĘĖĮŠŲŪŽa-ząčęėįšųūž]+)\s*((?:[A-Z]{2,3}\d{6,20}|\d{8,20}))/gi;

  const headReNormalized =
    /(\d{1,6})\s+([A-ZĄČĘĖĮŠŲŪŽa-ząčęėįšųūž]+)\s+((?:[A-Z]{2,3}\d{6,20}|\d{8,20}))/gi;

  function collectHeads(body, re) {
    const heads = [];
    let m;

    re.lastIndex = 0;

    while ((m = re.exec(body)) !== null) {
      const idx = Number(m[1]);
      const speciesRaw = m[2];
      const tag = m[3];

      if (!idx || !isLikelyIndividualSpecies(speciesRaw)) continue;

      heads.push({
        idx,
        speciesRaw,
        species: normalizeLithuanianSpecies(speciesRaw),
        tag,
        headStart: m.index,
        dataStart: re.lastIndex,
      });
    }

    return heads;
  }

  let bodyUsed = bodyRaw;
  let heads = collectHeads(bodyRaw, headReRaw);
  const rawHeadsFound = heads.length;

  if (heads.length === 0) {
    bodyUsed = bodyNormalized;
    heads = collectHeads(bodyNormalized, headReNormalized);
  }

  const rawHeadsFoundNormalized = heads.length;

  const DATE_RE =
    /(\d{4}[-./]\d{2}[-./]\d{2}|\d{2}[-./]\d{2}[-./]\d{4})/;

  const AGE_RE = /^\s*(\d+(?:[,.]\d+)?)(?:\s*(?:mėn|men)\.?)?/i;

  const PASS_RE = /\b(?:[A-Z]{2}-\d+|\d{4,12})\b/;

  const rows = [];

  for (let i = 0; i < heads.length; i++) {
    const current = heads[i];
    const next = heads[i + 1];

    const sliceEnd = next ? next.headStart : bodyUsed.length;

    const rawSliceBeforeTruncate = bodyUsed.slice(current.dataStart, sliceEnd);
    const rawSlice = truncateRowSlice(rawSliceBeforeTruncate);

    const slice = normalizeBreedSpacing(normalizeOneLine(rawSlice));

    const sexMatch = findSexMatch(slice);
    const sex = sexMatch ? normalizeSex(sexMatch[0]) : null;

    const beforeSex = sexMatch ? slice.slice(0, sexMatch.index).trim() : "";
    const name = cleanName(beforeSex);

    const afterSexIdx = sexMatch ? sexMatch.index + sexMatch[0].length : 0;
    const afterSex = slice.slice(afterSexIdx).trim();

    const dateMatch = afterSex.match(DATE_RE) || slice.match(DATE_RE);
    const dateRaw = dateMatch ? dateMatch[0] : null;
    const birthDate = toISO(dateRaw);

    let ageMonths = null;
    let breedRaw = null;
    let passport = null;

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

          const afterAge = afterDate
            .slice(ageMatch[0].length)
            .trim();

          const passMatch = afterAge.match(PASS_RE);
          passport = passMatch ? passMatch[0] : null;
        } else {
          const passMatch = afterDate.match(PASS_RE);
          passport = passMatch ? passMatch[0] : null;
        }
      } else {
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

            const afterAge = afterDate
              .slice(ageMatch[0].length)
              .trim();

            const passMatch = afterAge.match(PASS_RE);
            passport = passMatch ? passMatch[0] : null;
          } else {
            const passMatch = afterDate.match(PASS_RE);
            passport = passMatch ? passMatch[0] : null;
          }
        }
      }
    }

    let row = {
      row_index: current.idx,
      species: current.species,
      species_label: current.speciesRaw,
      tag_no: current.tag,
      name,
      sex,
      breed: cleanBreed(normalizeBreedSpacing(breedRaw)),
      birth_date: birthDate,
      age_months: ageMonths,
      passport,
      row_type: "individual",
      source: "vic_pdf",
    };

    row = splitSexFromBreedIfNeeded(row);

    if (
      row.row_index &&
      row.species &&
      row.tag_no &&
      /^(?:[A-Z]{2,3}\d+|\d+)$/i.test(row.tag_no) &&
      row.birth_date
    ) {
      rows.push(row);
    }
  }

  const seen = new Set();

  const unique = rows.filter((r) => {
    const key = `${r.species}:${r.tag_no}`;
    if (seen.has(key)) return false;
    seen.add(key);
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
      rawHeadsFound,
      rawHeadsFoundNormalized,
      parser_mode: rawHeadsFound > 0 ? "raw_body" : "normalized_body",
    },
  };
}

// ---------- grouped animal parser ----------
function parseGroupedAnimalsFromText(originalText) {
  const text = normalizeText(originalText || "");

  const groups = [];

  const groupHeaderRe =
    /Eil\.\s*Nr\.\s*Rūšis\s*Grupė\s*Gyvūnų\s*skaičius\s*Matavimo\s*vienetai/gi;

  let headerMatch;

  while ((headerMatch = groupHeaderRe.exec(text)) !== null) {
    const blockStart = groupHeaderRe.lastIndex;
    const rest = text.slice(blockStart);

    const nextSectionMatch = rest.search(/\n\s*\d+\.\s+Laikytojas/i);
    const declaredMatch = rest.search(/Deklaruota\s+gyvūnų/i);
    const footerMatch = rest.search(/www\.zudc\.lt/i);

    let blockEnd = rest.length;

    for (const idx of [nextSectionMatch, declaredMatch, footerMatch]) {
      if (idx !== -1 && idx < blockEnd) blockEnd = idx;
    }

    const block = rest.slice(0, blockEnd);

    const lines = block
      .split(/\n/)
      .map((s) => s.replace(/\s+/g, " ").trim())
      .filter(Boolean);

    for (const line of lines) {
      const rowRe =
        /^(\d{1,6})\s+([A-ZĄČĘĖĮŠŲŪŽa-ząčęėįšųūž]+)\s+(.+?)\s+(\d+(?:[,.]\d+)?)\s+([A-ZĄČĘĖĮŠŲŪŽa-ząčęėįšųūž.]+)$/u;

      const m = line.match(rowRe);

      if (!m) continue;

      const rowIndex = Number(m[1]);
      const speciesRaw = m[2];
      const groupName = m[3].trim();
      const count = parseCount(m[4]);
      const unit = m[5].trim();

      if (!rowIndex || !speciesRaw || count === null) continue;

      groups.push({
        row_index: rowIndex,
        species: normalizeLithuanianSpecies(speciesRaw),
        species_label: speciesRaw,
        group: groupName,
        animal_count: count,
        unit,
        row_type: "group",
        source: "vic_pdf",
      });
    }
  }

  const seen = new Set();

  return groups.filter((r) => {
    const key = `${r.species}:${r.group}:${r.animal_count}:${r.unit}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------- main parser ----------
function parseAnimalsFromText(text) {
  const individualResult = parseIndividualAnimalsFromText(text);
  const groupedRows = parseGroupedAnimalsFromText(text);

  const speciesCounts = {};

  for (const r of individualResult.rows) {
    speciesCounts[r.species] = (speciesCounts[r.species] || 0) + 1;
  }

  const groupedSpeciesCounts = {};

  for (const r of groupedRows) {
    groupedSpeciesCounts[r.species] = (groupedSpeciesCounts[r.species] || 0) + 1;
  }

  return {
    rows: individualResult.rows,
    groupedRows,
    debug: {
      ...individualResult.debug,
      individual_count: individualResult.rows.length,
      grouped_count: groupedRows.length,
      species_counts: speciesCounts,
      grouped_species_counts: groupedSpeciesCounts,
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
    const { rows, groupedRows, debug } = parseAnimalsFromText(parsed.text || "");

    res.setHeader("Cache-Control", "no-store");

    res.status(200).json({
      count: rows.length,
      animals: rows,
      grouped_count: groupedRows.length,
      grouped_animals: groupedRows,
      debug,
    });
  } catch (e) {
    console.error("[extractpdf] ERROR:", e);

    res.status(500).json({
      error: e?.message || "parse_error",
    });
  }
};

module.exports.config = {
  api: {
    bodyParser: false,
  },
};
