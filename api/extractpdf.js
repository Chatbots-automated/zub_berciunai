// api/extractpdf.js

const pdfParse = require("pdf-parse");

// ============================================================
// BASIC HELPERS
// ============================================================

function toISO(value) {
  if (!value) return null;

  const s = String(value).trim();

  let match = s.match(
    /^(\d{4})[-./](\d{2})[-./](\d{2})$/
  );

  if (match) {
    return `${match[1]}-${match[2]}-${match[3]}`;
  }

  match = s.match(
    /^(\d{2})[-./](\d{2})[-./](\d{4})$/
  );

  if (match) {
    return `${match[3]}-${match[2]}-${match[1]}`;
  }

  return null;
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\u00A0/g, " ")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ");
}

function normalizeOneLine(value) {
  return normalizeText(value)
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanValue(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const result = String(value)
    .replace(/\s+/g, " ")
    .trim();

  return result || null;
}

function normalizeCompact(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const result = String(value)
    .replace(/\s+/g, "")
    .trim();

  return result || null;
}

function onlyDigits(value) {
  if (!value) return null;

  const result = String(value)
    .replace(/\D/g, "")
    .trim();

  return result || null;
}

// ============================================================
// SPECIES / SEX
// ============================================================

function normalizeLithuanianSpecies(value) {
  if (!value) return null;

  const v = String(value)
    .trim()
    .toLowerCase();

  const map = {
    galvijai: "galvijai",
    galvijas: "galvijai",

    arkliai: "arkliai",
    arklys: "arkliai",

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

  return map[v] || v;
}

function normalizeSex(value) {
  if (!value) return null;

  const v = String(value)
    .trim()
    .toLowerCase();

  if (v.startsWith("buliuk")) {
    return "Buliukas";
  }

  if (v.startsWith("buliu")) {
    return "Bulius";
  }

  if (v.startsWith("karv")) {
    return "Karvė";
  }

  if (v.startsWith("tely")) {
    return "Telyčaitė";
  }

  if (
    v.startsWith("eržil") ||
    v.startsWith("erzil")
  ) {
    return "Eržilas";
  }

  if (v.startsWith("kumel")) {
    return "Kumelė";
  }

  if (v.startsWith("kastr")) {
    return "Kastratas";
  }

  if (v.startsWith("avinas")) {
    return "Avinas";
  }

  if (v.startsWith("avis")) {
    return "Avis";
  }

  if (
    v.startsWith("ėriuk") ||
    v.startsWith("eriuk")
  ) {
    return "Ėriukas";
  }

  if (
    v.startsWith("ožka") ||
    v.startsWith("ozka")
  ) {
    return "Ožka";
  }

  if (
    v.startsWith("ožys") ||
    v.startsWith("ozys")
  ) {
    return "Ožys";
  }

  if (
    v.startsWith("paršav") ||
    v.startsWith("parsav")
  ) {
    return "Paršavedė";
  }

  if (v.startsWith("kuil")) {
    return "Kuilys";
  }

  return (
    String(value)
      .charAt(0)
      .toUpperCase() +
    String(value)
      .slice(1)
      .toLowerCase()
  );
}

function parseAge(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const number = Number(
    String(value).replace(",", ".")
  );

  if (!Number.isFinite(number)) {
    return null;
  }

  if (
    number < 0 ||
    number > 400
  ) {
    return null;
  }

  return number;
}

function parseCount(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const number = Number(
    String(value).replace(",", ".")
  );

  return Number.isFinite(number)
    ? number
    : null;
}

// ============================================================
// VIC DOCUMENT METADATA
// ============================================================

function parseDocumentMetadata(originalText) {
  const normalized =
    normalizeText(originalText || "");

  /*
   * Only use the first header.
   *
   * Everything before:
   * Eil. Nr. Rūšis Numeris...
   */
  const tableStart =
    normalized.search(
      /Eil\.\s*Nr\./i
    );

  const headerText =
    tableStart >= 0
      ? normalized.slice(
          0,
          tableStart
        )
      : normalized.slice(
          0,
          10000
        );

  const oneLine =
    normalizeOneLine(
      headerText
    );

  /*
   * pdf-parse sometimes does this:
   *
   * DALIA KAIRAITIENĖValda1003923779Banda10662800013
   *
   * Therefore we keep a completely compact version too.
   */
  const compact =
    headerText
      .replace(/\s+/g, "");

  const metadata = {
    holder_name: null,

    client_personal_code:
      null,

    holding_code:
      null,

    herd_code:
      null,

    holder_type:
      null,

    declared_species:
      null,

    holder_address:
      null,

    herd_address:
      null,

    registration_date:
      null
  };

  // ==========================================================
  // PERSONAL / COMPANY CODE
  // ==========================================================

  let match =
    compact.match(
      /Asmens\/(?:įmonės|imones)kodas(\d{8,13})/iu
    );

  if (!match) {
    match =
      oneLine.match(
        /Asmens\s*\/\s*(?:įmonės|imones)\s*kodas\s*[:\-]?\s*(\d{8,13})/iu
      );
  }

  if (match?.[1]) {
    metadata.client_personal_code =
      onlyDigits(
        match[1]
      );
  }

  // ==========================================================
  // VALDA
  //
  // Important:
  // DO NOT require a word boundary AFTER "Valda".
  //
  // It can be:
  // Valda1003923779
  // ==========================================================

  match =
    compact.match(
      /Valda(\d{6,15})/iu
    );

  if (!match) {
    match =
      oneLine.match(
        /Valda\s*[:\-]?\s*(\d{6,15})/iu
      );
  }

  if (match?.[1]) {
    metadata.holding_code =
      onlyDigits(
        match[1]
      );
  }

  // ==========================================================
  // BANDA
  // ==========================================================

  match =
    compact.match(
      /Banda(\d{6,15})/iu
    );

  if (!match) {
    match =
      oneLine.match(
        /Banda\s*[:\-]?\s*(\d{6,15})/iu
      );
  }

  if (match?.[1]) {
    metadata.herd_code =
      onlyDigits(
        match[1]
      );
  }

  // ==========================================================
  // HOLDER NAME
  // ==========================================================

  match =
    oneLine.match(
      /(?:\d+\.\s*)?Laikytojas\s*(.+?)(?=\s*Valda\s*\d|\s*Banda\s*\d|\s*Asmens\s*\/)/iu
    );

  if (match?.[1]) {
    metadata.holder_name =
      cleanValue(
        match[1]
      );
  }

  // Fallback when values are fully glued
  if (
    !metadata.holder_name
  ) {
    const holderStart =
      compact.search(
        /Laikytojas/iu
      );

    const valdaStart =
      compact.search(
        /Valda\d/iu
      );

    if (
      holderStart >= 0 &&
      valdaStart >
        holderStart
    ) {
      let value =
        compact.slice(
          holderStart +
            "Laikytojas".length,
          valdaStart
        );

      /*
       * Compact fallback cannot reconstruct
       * spaces in full names perfectly.
       *
       * Usually normal oneLine parsing above
       * succeeds first.
       */
      metadata.holder_name =
        cleanValue(value);
    }
  }

  // ==========================================================
  // TYPE
  //
  // Handles:
  // Tipas Valdytojas Rūšis Galvijai
  // TipasValdytojasRūšisGalvijai
  // ==========================================================

  match =
    oneLine.match(
      /Tipas\s*(.+?)(?=\s*Rūšis|\s*Rusis)/iu
    );

  if (match?.[1]) {
    metadata.holder_type =
      cleanValue(
        match[1]
      );
  }

  // ==========================================================
  // SPECIES
  // ==========================================================

  match =
    oneLine.match(
      /(?:Rūšis|Rusis)\s*(.+?)(?=\s*Laikytojo\s*adresas|\s*Įregistravimo|\s*Iregistravimo|\s*Eil\.)/iu
    );

  if (match?.[1]) {
    metadata.declared_species =
      normalizeLithuanianSpecies(
        cleanValue(
          match[1]
        )
      );
  }

  // ==========================================================
  // HOLDER ADDRESS
  // ==========================================================

  match =
    oneLine.match(
      /Laikytojo\s*adresas\s*(.+?)(?=\s*Įregistravimo\s*data|\s*Iregistravimo\s*data|\s*Bandos\s*adresas|\s*Eil\.)/iu
    );

  if (match?.[1]) {
    metadata.holder_address =
      cleanValue(
        match[1]
      );
  }

  // ==========================================================
  // REGISTRATION DATE
  // ==========================================================

  match =
    headerText.match(
      /(?:Įregistravimo|Iregistravimo)\s*data[\s\S]{0,150}?(\d{4}[-./]\d{2}[-./]\d{2})/iu
    );

  if (match?.[1]) {
    metadata.registration_date =
      toISO(
        match[1]
      );
  }

  // ==========================================================
  // HERD ADDRESS
  // ==========================================================

  match =
    oneLine.match(
      /Bandos\s*adresas\s*(.+?)(?=\s*Eil\.\s*Nr\.|$)/iu
    );

  if (match?.[1]) {
    metadata.herd_address =
      cleanValue(
        match[1]
      );
  }

  return {
    metadata,

    debug: {
      raw_header:
        oneLine.slice(
          0,
          3000
        ),

      compact_header:
        compact.slice(
          0,
          3000
        )
    }
  };
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

// ============================================================
// NAME / SEX / BREED
// ============================================================

function normalizeBreedSpacing(value) {
  if (!value) return null;

  return String(value)
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

function cleanBreed(value) {
  if (!value) return null;

  const result =
    String(value)
      .replace(/\s+/g, " ")

      .replace(
        /\bwww\.zudc\.lt\b/gi,
        ""
      )

      .replace(
        /\bGyvų gyvūnų sąrašas\b/gi,
        ""
      )

      .replace(
        /\bSugrupuota statistika\b/gi,
        ""
      )

      .replace(
        /\bIš viso ataskaitoje\b/gi,
        ""
      )

      .replace(
        /\bIš viso registruota grupėmis\b/gi,
        ""
      )

      .replace(
        /\bDeklaruota gyvūnų\b/gi,
        ""
      )

      .replace(
        new RegExp(
          `^(${SEX_WORDS})\\s*`,
          "i"
        ),
        ""
      )

      .trim();

  return result || null;
}

function cleanName(value) {
  if (!value) return null;

  let name =
    String(value)
      .replace(/\s+/g, " ")
      .trim();

  if (!name) {
    return null;
  }

  return name;
}

function findSexMatch(value) {
  if (!value) return null;

  const normalized =
    normalizeBreedSpacing(
      value
    );

  return normalized.match(
    new RegExp(
      `(${SEX_WORDS})`,
      "i"
    )
  );
}

function splitMiddleIntoNameSexBreed(
  middle
) {
  const cleaned =
    normalizeBreedSpacing(
      normalizeOneLine(
        middle
      )
    );

  const sexMatch =
    findSexMatch(
      cleaned
    );

  if (!sexMatch) {
    return {
      name:
        cleanName(
          cleaned
        ),

      sex: null,

      breed: null
    };
  }

  const namePart =
    cleaned
      .slice(
        0,
        sexMatch.index
      )
      .trim();

  const sexPart =
    sexMatch[0];

  const breedPart =
    cleaned
      .slice(
        sexMatch.index +
          sexPart.length
      )
      .trim();

  return {
    name:
      cleanName(
        namePart
      ),

    sex:
      normalizeSex(
        sexPart
      ),

    breed:
      cleanBreed(
        breedPart
      )
  };
}

function fixSexBreed(row) {
  if (!row) {
    return row;
  }

  if (row.sex) {
    row.breed =
      cleanBreed(
        normalizeBreedSpacing(
          row.breed
        )
      );

    return row;
  }

  const breed =
    row.breed
      ? normalizeBreedSpacing(
          row.breed
        )
      : "";

  if (!breed) {
    return row;
  }

  const match =
    breed.match(
      new RegExp(
        `^(${SEX_WORDS})\\s*(.*)$`,
        "i"
      )
    );

  if (!match) {
    return row;
  }

  row.sex =
    normalizeSex(
      match[1]
    );

  row.breed =
    cleanBreed(
      match[2]
    );

  return row;
}

// ============================================================
// INDIVIDUAL ANIMALS
// ============================================================

function isValidTag(value) {
  if (!value) {
    return false;
  }

  return /^(?:[A-Z]{2,3}\d+|\d{8,20})$/i.test(
    String(value).trim()
  );
}

function parseIndividualAnimalsFromText(
  originalText
) {
  const text =
    normalizeText(
      originalText || ""
    );

  const oneLine =
    normalizeOneLine(
      text
    );

  /*
   * VERY IMPORTANT FIX:
   *
   * Old:
   *
   * [A-Z]{2}-\d+ OR \d{4,12}
   *
   * That meant row index 1000 could be
   * treated as the previous animal's passport.
   *
   * New:
   *
   * passport requires letters + hyphen + number:
   *
   * AC-522862
   * AF-473623
   *
   * Therefore row 1000 remains the next row.
   */

  const rowRegex =
    new RegExp(
      [
        // Row
        `(\\d{1,6})`,

        // Species
        `\\s*(${SPECIES_WORDS})`,

        // Tag number
        `\\s*((?:[A-Z]{2,3}\\d+|\\d{8,20}))`,

        // Name + sex + breed
        `\\s*([\\s\\S]*?)`,

        // Birth date
        `(\\d{4}[-./]\\d{2}[-./]\\d{2}|\\d{2}[-./]\\d{2}[-./]\\d{4})`,

        // Age
        `\\s*(\\d+(?:[,.]\\d+)?)`,

        // Optional passport
        // IMPORTANT: NO digits-only alternative
        `(?:\\s*([A-Z]{1,4}-\\d+))?`
      ].join(""),
      "gi"
    );

  const rows = [];

  let match;

  while (
    (
      match =
        rowRegex.exec(
          oneLine
        )
    ) !== null
  ) {
    const rowIndex =
      Number(
        match[1]
      );

    const speciesRaw =
      match[2];

    const tag =
      match[3];

    const middle =
      match[4];

    const birthRaw =
      match[5];

    const ageRaw =
      match[6];

    const passport =
      match[7] || null;

    const parts =
      splitMiddleIntoNameSexBreed(
        middle
      );

    let row = {
      row_index:
        rowIndex,

      species:
        normalizeLithuanianSpecies(
          speciesRaw
        ),

      species_label:
        speciesRaw,

      tag_no:
        tag,

      name:
        parts.name,

      sex:
        parts.sex,

      breed:
        parts.breed,

      birth_date:
        toISO(
          birthRaw
        ),

      age_months:
        parseAge(
          ageRaw
        ),

      passport,

      row_type:
        "individual",

      source:
        "vic_pdf"
    };

    row =
      fixSexBreed(
        row
      );

    if (
      row.row_index &&
      row.species &&
      isValidTag(
        row.tag_no
      ) &&
      row.birth_date
    ) {
      rows.push(
        row
      );
    }
  }

  // ==========================================================
  // DEDUPLICATION
  // ==========================================================

  const seen =
    new Set();

  const unique =
    [];

  for (const row of rows) {
    const key =
      `${row.species}:${row.tag_no}`;

    if (
      seen.has(key)
    ) {
      continue;
    }

    seen.add(
      key
    );

    unique.push(
      row
    );
  }

  return {
    rows:
      unique,

    debug: {
      matched_before_dedupe:
        rows.length,

      matched_after_dedupe:
        unique.length,

      parser_mode:
        "global_date_anchored_v2"
    }
  };
}

// ============================================================
// GROUPED ANIMALS
// ============================================================

function parseGroupedAnimalsFromText(
  originalText
) {
  const text =
    normalizeText(
      originalText || ""
    );

  const groups = [];

  const lines =
    text
      .split(/\n/)
      .map(
        (line) =>
          line
            .replace(
              /\s+/g,
              " "
            )
            .trim()
      )
      .filter(
        Boolean
      );

  let insideGroupedTable =
    false;

  for (
    const line of lines
  ) {
    if (
      /Eil\.\s*Nr\.\s*Rūšis\s*Grupė\s*Gyvūnų\s*skaičius\s*Matavimo\s*vienetai/i.test(
        line
      )
    ) {
      insideGroupedTable =
        true;

      continue;
    }

    if (
      insideGroupedTable &&
      (
        /www\.zudc\.lt/i.test(
          line
        ) ||
        /Gyvų gyvūnų sąrašas/i.test(
          line
        ) ||
        /Deklaruota\s+gyvūnų/i.test(
          line
        ) ||
        /^\d+\.\s+Laikytojas/i.test(
          line
        ) ||
        /Iš\s+viso\s+ataskaitoje/i.test(
          line
        ) ||
        /Iš\s+viso\s+registruota\s+grupėmis/i.test(
          line
        )
      )
    ) {
      insideGroupedTable =
        false;

      continue;
    }

    if (
      !insideGroupedTable
    ) {
      continue;
    }

    const match =
      line.match(
        new RegExp(
          `^(\\d{1,6})\\s+(${GROUPED_SPECIES_WORDS})\\s+(.+?)\\s+(\\d+(?:[,.]\\d+)?)\\s+([A-ZĄČĘĖĮŠŲŪŽa-ząčęėįšųūž.]+)$`,
          "iu"
        )
      );

    if (!match) {
      continue;
    }

    const rowIndex =
      Number(
        match[1]
      );

    const count =
      parseCount(
        match[4]
      );

    if (
      !rowIndex ||
      count === null
    ) {
      continue;
    }

    groups.push({
      row_index:
        rowIndex,

      species:
        normalizeLithuanianSpecies(
          match[2]
        ),

      species_label:
        match[2],

      group:
        match[3].trim(),

      animal_count:
        count,

      unit:
        match[5].trim(),

      row_type:
        "group",

      source:
        "vic_pdf"
    });
  }

  const seen =
    new Set();

  return groups.filter(
    (row) => {
      const key =
        [
          row.species,
          row.group,
          row.animal_count,
          row.unit
        ].join(":");

      if (
        seen.has(key)
      ) {
        return false;
      }

      seen.add(
        key
      );

      return true;
    }
  );
}

// ============================================================
// TOTAL COUNT FROM VIC FOOTER
// ============================================================

function parseReportedTotal(
  originalText
) {
  const text =
    normalizeText(
      originalText
    );

  /*
   * Example:
   *
   * Iš viso ataskaitoje:
   * Galvijai Iš viso: 1892
   */

  const match =
    text.match(
      /Iš\s+viso\s+ataskaitoje[\s\S]{0,500}?Galvijai\s+Iš\s+viso:\s*(\d+)/iu
    );

  if (!match?.[1]) {
    return null;
  }

  const number =
    Number(
      match[1]
    );

  return Number.isFinite(number)
    ? number
    : null;
}

// ============================================================
// MAIN PARSER
// ============================================================

function parseAnimalsFromText(
  text
) {
  const metadataResult =
    parseDocumentMetadata(
      text
    );

  const metadata =
    metadataResult.metadata;

  const individualResult =
    parseIndividualAnimalsFromText(
      text
    );

  const groupedResult =
    parseGroupedAnimalsFromText(
      text
    );

  const reportedTotal =
    parseReportedTotal(
      text
    );

  // ==========================================================
  // ADD CLIENT / FARM METADATA TO EVERY ANIMAL
  // ==========================================================

  const rows =
    individualResult.rows.map(
      (animal) => ({
        ...animal,

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
          metadata.holder_name
      })
    );

  const groupedRows =
    groupedResult.map(
      (group) => ({
        ...group,

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
          metadata.holder_name
      })
    );

  const speciesCounts =
    {};

  for (
    const row of rows
  ) {
    speciesCounts[
      row.species
    ] =
      (
        speciesCounts[
          row.species
        ] || 0
      ) + 1;
  }

  return {
    metadata,

    rows,

    groupedRows,

    reportedTotal,

    debug: {
      ...individualResult.debug,

      individual_count:
        rows.length,

      grouped_count:
        groupedRows.length,

      reported_total:
        reportedTotal,

      total_matches_report:
        reportedTotal === null
          ? null
          : rows.length ===
            reportedTotal,

      missing_from_reported_total:
        reportedTotal === null
          ? null
          : reportedTotal -
            rows.length,

      species_counts:
        speciesCounts,

      metadata_found: {
        holder_name:
          !!metadata.holder_name,

        client_personal_code:
          !!metadata.client_personal_code,

        holding_code:
          !!metadata.holding_code,

        herd_code:
          !!metadata.herd_code,

        holder_type:
          !!metadata.holder_type,

        declared_species:
          !!metadata.declared_species
      },

      metadata_debug:
        metadataResult.debug
    }
  };
}

// ============================================================
// REQUEST HELPERS
// ============================================================

async function readRawRequest(
  req
) {
  const chunks = [];

  await new Promise(
    (
      resolve,
      reject
    ) => {
      req.on(
        "data",
        (chunk) => {
          chunks.push(
            chunk
          );
        }
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

  return Buffer.concat(
    chunks
  );
}

async function readJsonRequest(
  req
) {
  return new Promise(
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
        (chunk) => {
          data +=
            chunk;
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
          } catch (error) {
            reject(
              error
            );
          }
        }
      );

      req.on(
        "error",
        reject
      );
    }
  );
}

// ============================================================
// API HANDLER
//
// EXACTLY ONE PDF PER REQUEST
// ============================================================

module.exports =
  async function handler(
    req,
    res
  ) {
    if (
      req.method !== "POST"
    ) {
      return res
        .status(405)
        .json({
          ok: false,

          error:
            "Use POST"
        });
    }

    try {
      const contentType =
        String(
          req.headers[
            "content-type"
          ] || ""
        ).toLowerCase();

      let pdfBuffer =
        null;

      let inputMode =
        null;

      // ======================================================
      // DO NOT ALLOW MULTIPART / MULTIPLE FILES
      // ======================================================

      if (
        contentType.includes(
          "multipart/form-data"
        )
      ) {
        return res
          .status(400)
          .json({
            ok: false,

            error:
              "Send exactly one PDF per request as raw binary data. Multipart upload is not supported."
          });
      }

      // ======================================================
      // RAW PDF
      // ======================================================

      if (
        contentType.includes(
          "application/pdf"
        ) ||
        contentType.includes(
          "application/octet-stream"
        )
      ) {
        pdfBuffer =
          await readRawRequest(
            req
          );

        inputMode =
          "raw_pdf";
      }

      // ======================================================
      // ONE URL
      // ======================================================

      else if (
        contentType.includes(
          "application/json"
        )
      ) {
        const body =
          await readJsonRequest(
            req
          );

        if (
          Array.isArray(body) ||
          Array.isArray(
            body?.url
          ) ||
          body?.urls ||
          body?.files
        ) {
          return res
            .status(400)
            .json({
              ok: false,

              error:
                "Only one PDF is allowed per request."
            });
        }

        if (
          !body ||
          typeof body.url !==
            "string" ||
          !body.url.trim()
        ) {
          return res
            .status(400)
            .json({
              ok: false,

              error:
                'Send exactly one PDF URL: { "url": "https://..." }'
            });
        }

        const response =
          await fetch(
            body.url.trim()
          );

        if (
          !response.ok
        ) {
          return res
            .status(400)
            .json({
              ok: false,

              error:
                "Could not fetch PDF URL",

              status:
                response.status
            });
        }

        pdfBuffer =
          Buffer.from(
            await response.arrayBuffer()
          );

        inputMode =
          "url";
      }

      else {
        return res
          .status(400)
          .json({
            ok: false,

            error:
              "Unsupported content-type. Send one PDF as application/pdf or application/octet-stream.",

            content_type:
              contentType
          });
      }

      // ======================================================
      // VALIDATE PDF
      // ======================================================

      if (
        !pdfBuffer ||
        !pdfBuffer.length
      ) {
        return res
          .status(400)
          .json({
            ok: false,

            error:
              "PDF file is empty."
          });
      }

      const signature =
        pdfBuffer
          .subarray(
            0,
            5
          )
          .toString(
            "ascii"
          );

      if (
        signature !==
        "%PDF-"
      ) {
        return res
          .status(400)
          .json({
            ok: false,

            error:
              "Input is not a valid PDF."
          });
      }

      // ======================================================
      // PDF PARSE
      // ======================================================

      const parsed =
        await pdfParse(
          pdfBuffer
        );

      const extractedText =
        parsed.text || "";

      if (
        !extractedText.trim()
      ) {
        return res
          .status(422)
          .json({
            ok: false,

            error:
              "PDF contains no extractable text."
          });
      }

      const result =
        parseAnimalsFromText(
          extractedText
        );

      const {
        metadata,
        rows,
        groupedRows,
        reportedTotal,
        debug
      } = result;

      // ======================================================
      // RESPONSE
      // ======================================================

      res.setHeader(
        "Cache-Control",
        "no-store"
      );

      return res
        .status(200)
        .json({
          ok: true,

          input_mode:
            inputMode,

          // ------------------------------------------
          // Farm / client identity
          // ------------------------------------------

          client_personal_code:
            metadata
              .client_personal_code,

          personal_code:
            metadata
              .client_personal_code,

          holding_code:
            metadata
              .holding_code,

          vic_farm_code:
            metadata
              .holding_code,

          herd_code:
            metadata
              .herd_code,

          holder_name:
            metadata
              .holder_name,

          holder_type:
            metadata
              .holder_type,

          declared_species:
            metadata
              .declared_species,

          holder_address:
            metadata
              .holder_address,

          herd_address:
            metadata
              .herd_address,

          registration_date:
            metadata
              .registration_date,

          metadata,

          // ------------------------------------------
          // Individual animals
          // ------------------------------------------

          count:
            rows.length,

          reported_count:
            reportedTotal,

          count_matches_report:
            reportedTotal === null
              ? null
              : rows.length ===
                reportedTotal,

          animals:
            rows,

          // ------------------------------------------
          // Groups
          // ------------------------------------------

          grouped_count:
            groupedRows.length,

          grouped_animals:
            groupedRows,

          debug
        });
    } catch (error) {
      console.error(
        "[extractpdf] ERROR:",
        error
      );

      return res
        .status(500)
        .json({
          ok: false,

          error:
            error?.message ||
            "parse_error"
        });
    }
  };

// ============================================================
// VERCEL
// ============================================================

module.exports.config = {
  api: {
    bodyParser: false
  }
};
