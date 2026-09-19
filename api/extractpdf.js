// api/extractpdf.js

const pdfParse = require("pdf-parse");

// ============================================================
// HELPERS
// ============================================================

function toISO(d) {
  if (!d) return null;

  let m = String(d).match(/^(\d{4})[-./](\d{2})[-./](\d{2})$/);

  if (m) {
    return `${m[1]}-${m[2]}-${m[3]}`;
  }

  m = String(d).match(/^(\d{2})[-./](\d{2})[-./](\d{4})$/);

  if (m) {
    return `${m[3]}-${m[2]}-${m[1]}`;
  }

  return null;
}

function normalizeText(s) {
  return String(s || "")
    .replace(/\u00A0/g, " ")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ");
}

function normalizeOneLine(s) {
  return normalizeText(s)
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanValue(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const cleaned = String(value)
    .replace(/\s+/g, " ")
    .trim();

  return cleaned || null;
}

function normalizeCompact(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const cleaned = String(value)
    .replace(/\s+/g, "")
    .trim();

  return cleaned || null;
}

function normalizeLithuanianSpecies(s) {
  if (!s) return null;

  const x = String(s)
    .trim()
    .toLowerCase();

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
    pauksciai: "pauksciai"
  };

  return map[x] || x;
}

function normalizeSex(s) {
  if (!s) return null;

  const x = String(s)
    .trim()
    .toLowerCase();

  // Galvijai
  if (x.startsWith("buliuk")) return "Buliukas";
  if (x.startsWith("buliu")) return "Bulius";
  if (x.startsWith("karv")) return "Karvė";
  if (x.startsWith("tely")) return "Telyčaitė";

  // Arkliai
  if (
    x.startsWith("eržil") ||
    x.startsWith("erzil")
  ) {
    return "Eržilas";
  }

  if (x.startsWith("kumel")) return "Kumelė";
  if (x.startsWith("kastr")) return "Kastratas";

  // Others
  if (x.startsWith("avinas")) return "Avinas";
  if (x.startsWith("avis")) return "Avis";

  if (
    x.startsWith("ėriuk") ||
    x.startsWith("eriuk")
  ) {
    return "Ėriukas";
  }

  if (
    x.startsWith("ožka") ||
    x.startsWith("ozka")
  ) {
    return "Ožka";
  }

  if (
    x.startsWith("ožys") ||
    x.startsWith("ozys")
  ) {
    return "Ožys";
  }

  if (
    x.startsWith("paršav") ||
    x.startsWith("parsav")
  ) {
    return "Paršavedė";
  }

  if (x.startsWith("kuil")) {
    return "Kuilys";
  }

  return (
    String(s).charAt(0).toUpperCase() +
    String(s).slice(1).toLowerCase()
  );
}

function parseAge(raw) {
  if (
    raw === null ||
    raw === undefined ||
    raw === ""
  ) {
    return null;
  }

  const n = Number(
    String(raw).replace(",", ".")
  );

  if (!Number.isFinite(n)) return null;

  if (n < 0 || n > 400) {
    return null;
  }

  return n;
}

function parseCount(raw) {
  if (
    raw === null ||
    raw === undefined ||
    raw === ""
  ) {
    return null;
  }

  const n = Number(
    String(raw).replace(",", ".")
  );

  if (!Number.isFinite(n)) {
    return null;
  }

  return n;
}

// ============================================================
// PDF HEADER / FARM METADATA
// ============================================================

function parseDocumentMetadata(originalText) {
  const text = normalizeText(originalText || "");
  const oneLine = normalizeOneLine(text);

  const metadata = {
    holder_name: null,

    // IMPORTANT:
    // this is the Asmens/įmonės kodas
    client_personal_code: null,

    // VIC "Valda"
    holding_code: null,

    // VIC "Banda"
    herd_code: null,

    holder_type: null,
    declared_species: null,

    holder_address: null,
    herd_address: null,

    registration_date: null
  };

  // ----------------------------------------------------------
  // Main header:
  //
  // 1. Laikytojas IEVA SKUČIENĖ
  // Valda 1011843413
  // Banda 11315300527
  // ----------------------------------------------------------

  const mainHeaderMatch = oneLine.match(
    /(?:\d+\.\s*)?Laikytojas\s+(.+?)\s+Valda\s+(\d+)\s+Banda\s+(\d+)/i
  );

  if (mainHeaderMatch) {
    metadata.holder_name =
      cleanValue(mainHeaderMatch[1]);

    metadata.holding_code =
      normalizeCompact(mainHeaderMatch[2]);

    metadata.herd_code =
      normalizeCompact(mainHeaderMatch[3]);
  }

  // ----------------------------------------------------------
  // Personal/company code
  //
  // Asmens/įmonės kodas 49203291027
  // ----------------------------------------------------------

  const personalCodeMatch = oneLine.match(
    /Asmens\s*\/?\s*įmonės\s+kodas\s+(\d{8,13})/i
  );

  if (personalCodeMatch) {
    metadata.client_personal_code =
      normalizeCompact(personalCodeMatch[1]);
  }

  // Support versions without Lithuanian letters
  if (!metadata.client_personal_code) {
    const fallbackCodeMatch = oneLine.match(
      /Asmens\s*\/?\s*imones\s+kodas\s+(\d{8,13})/i
    );

    if (fallbackCodeMatch) {
      metadata.client_personal_code =
        normalizeCompact(fallbackCodeMatch[1]);
    }
  }

  // ----------------------------------------------------------
  // Holder type
  //
  // Tipas Valdytojas
  // ----------------------------------------------------------

  const holderTypeMatch = oneLine.match(
    /Tipas\s+(.+?)\s+Rūšis\b/i
  );

  if (holderTypeMatch) {
    metadata.holder_type =
      cleanValue(holderTypeMatch[1]);
  }

  // ASCII fallback
  if (!metadata.holder_type) {
    const holderTypeFallback = oneLine.match(
      /Tipas\s+(.+?)\s+Rusis\b/i
    );

    if (holderTypeFallback) {
      metadata.holder_type =
        cleanValue(holderTypeFallback[1]);
    }
  }

  // ----------------------------------------------------------
  // Declared species
  //
  // Rūšis Galvijai
  // ----------------------------------------------------------

  const speciesMatch = oneLine.match(
    /Rūšis\s+([A-ZĄČĘĖĮŠŲŪŽa-ząčęėįšųūž]+)(?=\s+Laikytojo\s+adresas|\s+Įregistravimo|\s+Iregistravimo|\s+Eil\.|\s*$)/i
  );

  if (speciesMatch) {
    metadata.declared_species =
      normalizeLithuanianSpecies(
        speciesMatch[1]
      );
  }

  // ASCII fallback
  if (!metadata.declared_species) {
    const speciesFallback = oneLine.match(
      /Rusis\s+([A-Za-z]+)(?=\s+Laikytojo\s+adresas|\s+Iregistravimo|\s+Eil\.|\s*$)/i
    );

    if (speciesFallback) {
      metadata.declared_species =
        normalizeLithuanianSpecies(
          speciesFallback[1]
        );
    }
  }

  // ----------------------------------------------------------
  // Holder address
  //
  // Laikytojo adresas ...
  // ----------------------------------------------------------

  const holderAddressMatch = oneLine.match(
    /Laikytojo\s+adresas\s+(.+?)(?=\s+Įregistravimo\s+data|\s+Iregistravimo\s+data|\s+Bandos\s+adresas|\s+Eil\.\s*Nr\.)/i
  );

  if (holderAddressMatch) {
    metadata.holder_address =
      cleanValue(holderAddressMatch[1]);
  }

  // ----------------------------------------------------------
  // Registration date
  //
  // Įregistravimo data
  // išregistravimo data
  // 2010-04-16
  // ----------------------------------------------------------

  const registrationDateMatch = oneLine.match(
    /(?:Įregistravimo|Iregistravimo)\s+data(?:\s+išregistravimo\s+data|\s+isregistravimo\s+data)?\s+(\d{4}-\d{2}-\d{2})/i
  );

  if (registrationDateMatch) {
    metadata.registration_date =
      toISO(registrationDateMatch[1]);
  }

  // ----------------------------------------------------------
  // Herd address
  // ----------------------------------------------------------

  const herdAddressMatch = oneLine.match(
    /Bandos\s+adresas\s+(.+?)(?=\s+Eil\.\s*Nr\.|\s+www\.zudc\.lt|\s+Gyvų\s+gyvūnų\s+sąrašas|$)/i
  );

  if (herdAddressMatch) {
    metadata.herd_address =
      cleanValue(herdAddressMatch[1]);
  }

  return metadata;
}

// ============================================================
// ANIMAL PARSER CONSTANTS
// ============================================================

const SPECIES_WORDS =
  "Galvijai|Arkliai|Avys|Avis|Ožkos|Ozkos|Kiaulės|Kiaules|Triušiai|Triusiai";

const GROUPED_SPECIES_WORDS =
  "Vištos|Vistos|Paukščiai|Pauksciai|Galvijai|Arkliai|Avys|Avis|Ožkos|Ozkos|Kiaulės|Kiaules|Triušiai|Triusiai";

const SEX_WORDS =
  "Telyčaitė|Telycaite|Telytė|Telyte|Telyčia|Telycia|Buliukas|Bulius|Karvė|Karve|Eržilas|Erzilas|Kumelė|Kumele|Kastratas|Avis|Avinas|Ėriukas|Eriukas|Ožka|Ozka|Ožys|Ozys|Paršavedė|Parsavede|Kuilys";

function normalizeBreedSpacing(s) {
  if (!s) return null;

  return String(s)
    .replace(
      new RegExp(
        `(${SEX_WORDS})(?=[A-ZĄČĘĖĮŠŲŪŽ])`,
        "g"
      ),
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
    .replace(
      new RegExp(
        `^(${SEX_WORDS})\\s*`,
        "i"
      ),
      ""
    )
    .trim();

  return cleaned || null;
}

function cleanName(s) {
  if (!s) return null;

  let name = String(s)
    .replace(/\s+/g, " ")
    .trim();

  if (!name) return null;

  const onlyUpperNameChars =
    /^[A-ZĄČĘĖĮŠŲŪŽ\s.'-]+$/u.test(name);

  if (onlyUpperNameChars) {
    name = name.replace(/\s+/g, "");
  }

  return name || null;
}

function findSexMatch(s) {
  if (!s) return null;

  const normalized =
    normalizeBreedSpacing(s);

  const re = new RegExp(
    `(${SEX_WORDS})`,
    "i"
  );

  return normalized.match(re);
}

function splitMiddleIntoNameSexBreed(middle) {
  const cleanMiddle =
    normalizeBreedSpacing(
      normalizeOneLine(middle)
    );

  const sexMatch =
    findSexMatch(cleanMiddle);

  if (!sexMatch) {
    return {
      name: cleanName(cleanMiddle),
      sex: null,
      breed: null
    };
  }

  const nameRaw = cleanMiddle
    .slice(0, sexMatch.index)
    .trim();

  const sexRaw =
    sexMatch[0];

  const breedRaw = cleanMiddle
    .slice(
      sexMatch.index +
      sexRaw.length
    )
    .trim();

  return {
    name: cleanName(nameRaw),
    sex: normalizeSex(sexRaw),
    breed: cleanBreed(breedRaw)
  };
}

function fixSexBreed(row) {
  if (!row) return row;

  if (row.sex) {
    row.breed =
      cleanBreed(
        normalizeBreedSpacing(row.breed)
      );

    return row;
  }

  const breed = row.breed
    ? normalizeBreedSpacing(row.breed)
    : "";

  if (!breed) {
    return row;
  }

  const gluedSexRe =
    new RegExp(
      `^(${SEX_WORDS})\\s*(.*)$`,
      "i"
    );

  const m =
    breed.match(gluedSexRe);

  if (!m) {
    return row;
  }

  row.sex =
    normalizeSex(m[1]);

  row.breed =
    cleanBreed(m[2]);

  return row;
}

function getHeaderDebug(originalText) {
  const text =
    normalizeText(originalText);

  const allLines = text
    .split(/\n/)
    .map((s) =>
      s.replace(/\s+/g, " ").trim()
    )
    .filter(Boolean);

  const headerPattern =
    /Eil\.\s*Nr\.[\s\S]*?Gimimo\s*data/i;

  const headerMatch =
    text.match(headerPattern);

  const startIdx =
    headerMatch
      ? text.indexOf(headerMatch[0])
      : -1;

  const headerIdx =
    allLines.findIndex(
      (l) =>
        /Eil\.\s*Nr\./i.test(l) &&
        /(Rūšis|Rusis)/i.test(l) &&
        /Gimimo\s*data/i.test(l)
    );

  return {
    allLines,
    headerIdx,
    startIdx,
    foundHeader:
      startIdx !== -1 ||
      headerIdx !== -1
  };
}

function isValidTag(tag) {
  if (!tag) return false;

  return /^(?:[A-Z]{2,3}\d+|\d{8,20})$/i.test(
    String(tag).trim()
  );
}

// ============================================================
// INDIVIDUAL ANIMAL PARSER
// ============================================================

function parseIndividualAnimalsFromText(originalText) {
  const text =
    normalizeText(originalText || "");

  const oneLine =
    normalizeOneLine(text);

  const {
    allLines,
    headerIdx,
    startIdx,
    foundHeader
  } = getHeaderDebug(text);

  const rowRe = new RegExp(
    [
      `(\\d{1,6})`,
      `\\s*(${SPECIES_WORDS})`,
      `\\s*((?:[A-Z]{2,3}\\d+|\\d{8,20}))`,
      `\\s*([\\s\\S]*?)`,
      `(\\d{4}[-./]\\d{2}[-./]\\d{2}|\\d{2}[-./]\\d{2}[-./]\\d{4})`,
      `\\s*(\\d+(?:[,.]\\d+)?)`,
      `(?:\\s*((?:[A-Z]{2}-\\d+|\\d{4,12})))?`
    ].join(""),
    "gi"
  );

  const rows = [];

  let m;

  while (
    (m = rowRe.exec(oneLine)) !== null
  ) {
    const rowIndex =
      Number(m[1]);

    const speciesRaw =
      m[2];

    const tag =
      m[3];

    const middle =
      m[4];

    const dateRaw =
      m[5];

    const ageRaw =
      m[6];

    const passportRaw =
      m[7] || null;

    const species =
      normalizeLithuanianSpecies(
        speciesRaw
      );

    const {
      name,
      sex,
      breed
    } =
      splitMiddleIntoNameSexBreed(
        middle
      );

    let row = {
      row_index: rowIndex,

      species,

      species_label:
        speciesRaw,

      tag_no: tag,

      name,

      sex,

      breed,

      birth_date:
        toISO(dateRaw),

      age_months:
        parseAge(ageRaw),

      passport:
        passportRaw,

      row_type:
        "individual",

      source:
        "vic_pdf"
    };

    row =
      fixSexBreed(row);

    if (
      row.row_index &&
      row.species &&
      isValidTag(row.tag_no) &&
      row.birth_date
    ) {
      rows.push(row);
    }
  }

  const seen =
    new Set();

  const unique =
    rows.filter((r) => {
      const key =
        `${r.species}:${r.tag_no}`;

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);

      return true;
    });

  return {
    rows: unique,

    debug: {
      headerIdx,
      totalLines:
        allLines.length,
      startIdx,
      foundHeader,
      matched:
        unique.length,
      dateAnchoredMatches:
        rows.length,
      parser_mode:
        "date_anchored_global"
    }
  };
}

// ============================================================
// GROUPED ANIMAL PARSER
// ============================================================

function parseGroupedAnimalsFromText(originalText) {
  const text =
    normalizeText(originalText || "");

  const groups = [];

  const lines = text
    .split(/\n/)
    .map((s) =>
      s.replace(/\s+/g, " ").trim()
    )
    .filter(Boolean);

  let insideGroupedTable = false;

  for (const line of lines) {
    if (
      /Eil\.\s*Nr\.\s*Rūšis\s*Grupė\s*Gyvūnų\s*skaičius\s*Matavimo\s*vienetai/i.test(
        line
      )
    ) {
      insideGroupedTable = true;
      continue;
    }

    if (
      insideGroupedTable &&
      (
        /www\.zudc\.lt/i.test(line) ||
        /Gyvų gyvūnų sąrašas/i.test(line) ||
        /Deklaruota\s+gyvūnų/i.test(line) ||
        /^\d+\.\s+Laikytojas/i.test(line) ||
        /Iš\s+viso\s+ataskaitoje/i.test(line) ||
        /Iš\s+viso\s+registruota\s+grupėmis/i.test(line)
      )
    ) {
      insideGroupedTable = false;
      continue;
    }

    if (!insideGroupedTable) {
      continue;
    }

    const rowRe =
      new RegExp(
        `^(\\d{1,6})\\s+(${GROUPED_SPECIES_WORDS})\\s+(.+?)\\s+(\\d+(?:[,.]\\d+)?)\\s+([A-ZĄČĘĖĮŠŲŪŽa-ząčęėįšųūž.]+)$`,
        "iu"
      );

    const m =
      line.match(rowRe);

    if (!m) {
      continue;
    }

    const rowIndex =
      Number(m[1]);

    const speciesRaw =
      m[2];

    const groupName =
      m[3].trim();

    const count =
      parseCount(m[4]);

    const unit =
      m[5].trim();

    if (
      !rowIndex ||
      !speciesRaw ||
      count === null
    ) {
      continue;
    }

    groups.push({
      row_index:
        rowIndex,

      species:
        normalizeLithuanianSpecies(
          speciesRaw
        ),

      species_label:
        speciesRaw,

      group:
        groupName,

      animal_count:
        count,

      unit,

      row_type:
        "group",

      source:
        "vic_pdf"
    });
  }

  // Example:
  // Vištos (Iš viso) 9 vnt.

  const summaryRe =
    new RegExp(
      `(${GROUPED_SPECIES_WORDS})\\s*\\((.*?)\\)\\s+(\\d+(?:[,.]\\d+)?)\\s+([A-ZĄČĘĖĮŠŲŪŽa-ząčęėįšųūž.]+)`,
      "giu"
    );

  let sm;

  let syntheticIndex =
    100000;

  while (
    (sm = summaryRe.exec(text)) !== null
  ) {
    groups.push({
      row_index:
        syntheticIndex++,

      species:
        normalizeLithuanianSpecies(
          sm[1]
        ),

      species_label:
        sm[1],

      group:
        sm[2].trim(),

      animal_count:
        parseCount(sm[3]),

      unit:
        sm[4].trim(),

      row_type:
        "group",

      source:
        "vic_pdf_summary"
    });
  }

  const seen =
    new Set();

  return groups.filter((r) => {
    const key =
      `${r.species}:${r.group}:${r.animal_count}:${r.unit}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);

    return true;
  });
}

// ============================================================
// MAIN PARSER
// ============================================================

function parseAnimalsFromText(text) {
  const metadata =
    parseDocumentMetadata(text);

  const individualResult =
    parseIndividualAnimalsFromText(
      text
    );

  const groupedRows =
    parseGroupedAnimalsFromText(
      text
    );

  const speciesCounts = {};

  for (
    const r of individualResult.rows
  ) {
    speciesCounts[r.species] =
      (speciesCounts[r.species] || 0) +
      1;
  }

  const groupedSpeciesCounts = {};

  for (const r of groupedRows) {
    groupedSpeciesCounts[r.species] =
      (groupedSpeciesCounts[r.species] || 0) +
      1;
  }

  return {
    metadata,

    rows:
      individualResult.rows,

    groupedRows,

    debug: {
      ...individualResult.debug,

      individual_count:
        individualResult.rows.length,

      grouped_count:
        groupedRows.length,

      species_counts:
        speciesCounts,

      grouped_species_counts:
        groupedSpeciesCounts,

      metadata_found: {
        holder_name:
          !!metadata.holder_name,

        client_personal_code:
          !!metadata.client_personal_code,

        holding_code:
          !!metadata.holding_code,

        herd_code:
          !!metadata.herd_code
      }
    }
  };
}

// ============================================================
// API HANDLER
// ============================================================

module.exports =
  async function handler(req, res) {
    if (req.method !== "POST") {
      res
        .status(405)
        .json({
          error: "Use POST"
        });

      return;
    }

    try {
      const ct =
        (
          req.headers["content-type"] ||
          ""
        ).toLowerCase();

      let pdfBuffer = null;

      // ------------------------------------------------------
      // Raw PDF body
      // ------------------------------------------------------

      if (
        ct.includes(
          "application/pdf"
        ) ||
        ct.includes(
          "application/octet-stream"
        )
      ) {
        const chunks = [];

        await new Promise(
          (resolve, reject) => {
            req.on(
              "data",
              (c) =>
                chunks.push(c)
            );

            req.on(
              "end",
              resolve
            );

            req.on(
              "error",
              reject
            );
          }
        );

        pdfBuffer =
          Buffer.concat(chunks);
      }

      // ------------------------------------------------------
      // JSON URL
      // ------------------------------------------------------

      else if (
        ct.includes(
          "application/json"
        )
      ) {
        const body =
          await new Promise(
            (
              resolve,
              reject
            ) => {
              let data = "";

              req.setEncoding(
                "utf8"
              );

              req.on(
                "data",
                (ch) => {
                  data += ch;
                }
              );

              req.on(
                "end",
                () => {
                  try {
                    resolve(
                      data
                        ? JSON.parse(
                            data
                          )
                        : {}
                    );
                  } catch (e) {
                    reject(e);
                  }
                }
              );

              req.on(
                "error",
                reject
              );
            }
          );

        if (
          !body ||
          !body.url
        ) {
          res
            .status(400)
            .json({
              error:
                "Provide raw PDF body or JSON { url }"
            });

          return;
        }

        const r =
          await fetch(body.url);

        if (!r.ok) {
          res
            .status(400)
            .json({
              error:
                "Cannot fetch URL",

              status:
                r.status
            });

          return;
        }

        pdfBuffer =
          Buffer.from(
            await r.arrayBuffer()
          );
      }

      // ------------------------------------------------------
      // Unsupported
      // ------------------------------------------------------

      else {
        res
          .status(400)
          .json({
            error:
              "Unsupported content-type",

            contentType:
              ct
          });

        return;
      }

      // ------------------------------------------------------
      // Parse PDF
      // ------------------------------------------------------

      const parsed =
        await pdfParse(
          pdfBuffer
        );

      const {
        metadata,
        rows,
        groupedRows,
        debug
      } =
        parseAnimalsFromText(
          parsed.text || ""
        );

      res.setHeader(
        "Cache-Control",
        "no-store"
      );

      // ------------------------------------------------------
      // IMPORTANT:
      // metadata is included BOTH inside metadata {}
      // and important IDs at root level for n8n
      // ------------------------------------------------------

      res
        .status(200)
        .json({
          // Most important for farm matching
          client_personal_code:
            metadata.client_personal_code,

          personal_code:
            metadata.client_personal_code,

          holding_code:
            metadata.holding_code,

          vic_farm_code:
            metadata.holding_code,

          herd_code:
            metadata.herd_code,

          holder_name:
            metadata.holder_name,

          holder_type:
            metadata.holder_type,

          declared_species:
            metadata.declared_species,

          holder_address:
            metadata.holder_address,

          herd_address:
            metadata.herd_address,

          registration_date:
            metadata.registration_date,

          // Full metadata object too
          metadata,

          // Animals
          count:
            rows.length,

          animals:
            rows,

          grouped_count:
            groupedRows.length,

          grouped_animals:
            groupedRows,

          debug
        });
    } catch (e) {
      console.error(
        "[extractpdf] ERROR:",
        e
      );

      res
        .status(500)
        .json({
          error:
            e?.message ||
            "parse_error"
        });
    }
  };

// ============================================================
// VERCEL CONFIG
// ============================================================

module.exports.config = {
  api: {
    bodyParser: false
  }
};
