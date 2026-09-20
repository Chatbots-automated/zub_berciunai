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

  if (x.startsWith("buliuk")) return "Buliukas";
  if (x.startsWith("buliu")) return "Bulius";
  if (x.startsWith("karv")) return "Karvė";
  if (x.startsWith("tely")) return "Telyčaitė";

  if (
    x.startsWith("eržil") ||
    x.startsWith("erzil")
  ) {
    return "Eržilas";
  }

  if (x.startsWith("kumel")) return "Kumelė";
  if (x.startsWith("kastr")) return "Kastratas";

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
  if (n < 0 || n > 400) return null;

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
  const normalized =
    normalizeText(originalText || "");

  const tableStartMatch =
    normalized.match(/Eil\.\s*Nr\./i);

  const headerText =
    tableStartMatch &&
    tableStartMatch.index !== undefined
      ? normalized.slice(
          0,
          tableStartMatch.index
        )
      : normalized.slice(0, 8000);

  const headerOneLine = headerText
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const lines = headerText
    .split(/\n+/)
    .map((line) =>
      line
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter(Boolean);

  const metadata = {
    holder_name: null,
    client_personal_code: null,
    holding_code: null,
    herd_code: null,
    holder_type: null,
    declared_species: null,
    holder_address: null,
    herd_address: null,
    registration_date: null
  };

  function firstMatch(
    patterns,
    text = headerOneLine
  ) {
    for (const pattern of patterns) {
      const match = text.match(pattern);

      if (
        match &&
        match[1] !== undefined &&
        match[1] !== null
      ) {
        const cleaned =
          cleanValue(match[1]);

        if (cleaned) {
          return cleaned;
        }
      }
    }

    return null;
  }

  function digitsOnly(value) {
    if (!value) return null;

    const digits = String(value)
      .replace(/\D/g, "")
      .trim();

    return digits || null;
  }

  function findLineValue(patterns) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      for (const pattern of patterns) {
        const match = line.match(pattern);

        if (!match) continue;

        if (match[1]) {
          const value =
            cleanValue(match[1]);

          if (value) {
            return value;
          }
        }

        if (lines[i + 1]) {
          return cleanValue(
            lines[i + 1]
          );
        }
      }
    }

    return null;
  }

  // ==========================================================
  // PERSONAL / COMPANY CODE
  // ==========================================================

  let personalCode = firstMatch([
    /Asmens\s*\/\s*įmonės\s*kodas\s*[:\-]?\s*(\d{8,13})/iu,
    /Asmens\s*\/\s*imones\s*kodas\s*[:\-]?\s*(\d{8,13})/iu,
    /Asmens\s*\/?\s*įmonės\s*kodas[\s:;\-]*(\d{8,13})/iu,
    /Asmens\s*\/?\s*imones\s*kodas[\s:;\-]*(\d{8,13})/iu
  ]);

  if (!personalCode) {
    const lineValue = findLineValue([
      /Asmens\s*\/\s*įmonės\s*kodas\s*[:\-]?\s*(.*)$/iu,
      /Asmens\s*\/\s*imones\s*kodas\s*[:\-]?\s*(.*)$/iu
    ]);

    if (lineValue) {
      const codeMatch =
        lineValue.match(
          /\b\d{8,13}\b/
        );

      if (codeMatch) {
        personalCode =
          codeMatch[0];
      }
    }
  }

  metadata.client_personal_code =
    digitsOnly(personalCode);

  // ==========================================================
  // VALDA
  // ==========================================================

  let holdingCode = firstMatch([
    /\bValda\s*[:\-]?\s*(\d{6,15})\b/iu,
    /\bValdos\s+kodas\s*[:\-]?\s*(\d{6,15})\b/iu
  ]);

  if (!holdingCode) {
    const lineValue = findLineValue([
      /\bValda\s*[:\-]?\s*(.*)$/iu,
      /\bValdos\s+kodas\s*[:\-]?\s*(.*)$/iu
    ]);

    if (lineValue) {
      const codeMatch =
        lineValue.match(
          /\b\d{6,15}\b/
        );

      if (codeMatch) {
        holdingCode =
          codeMatch[0];
      }
    }
  }

  metadata.holding_code =
    digitsOnly(holdingCode);

  // ==========================================================
  // BANDA
  // ==========================================================

  let herdCode = firstMatch([
    /\bBanda\s*[:\-]?\s*(\d{6,15})\b/iu,
    /\bBandos\s+kodas\s*[:\-]?\s*(\d{6,15})\b/iu
  ]);

  if (!herdCode) {
    const lineValue = findLineValue([
      /\bBanda\s*[:\-]?\s*(.*)$/iu,
      /\bBandos\s+kodas\s*[:\-]?\s*(.*)$/iu
    ]);

    if (lineValue) {
      const codeMatch =
        lineValue.match(
          /\b\d{6,15}\b/
        );

      if (codeMatch) {
        herdCode =
          codeMatch[0];
      }
    }
  }

  metadata.herd_code =
    digitsOnly(herdCode);

  // ==========================================================
  // HOLDER NAME
  // ==========================================================

  metadata.holder_name = firstMatch([
    /(?:^|\s)\d+\.\s*Laikytojas\s+(.+?)(?=\s*(?:Valda|Banda|Asmens\s*\/|Tipas|Rūšis|Rusis|Laikytojo\s+adresas|Įregistravimo|Iregistravimo|Eil\.))/iu,

    /(?:^|\s)Laikytojas\s+(.+?)(?=\s*(?:Valda|Banda|Asmens\s*\/|Tipas|Rūšis|Rusis|Laikytojo\s+adresas|Įregistravimo|Iregistravimo|Eil\.))/iu
  ]);

  if (!metadata.holder_name) {
    const holderLine =
      findLineValue([
        /(?:\d+\.\s*)?Laikytojas\s*[:\-]?\s*(.*)$/iu
      ]);

    if (holderLine) {
      metadata.holder_name =
        holderLine
          .replace(
            /Valda\s*\d+.*$/iu,
            ""
          )
          .replace(
            /Banda\s*\d+.*$/iu,
            ""
          )
          .replace(
            /Asmens\s*\/.*$/iu,
            ""
          )
          .trim() || null;
    }
  }

  // ==========================================================
  // HOLDER TYPE
  // ==========================================================

  metadata.holder_type = firstMatch([
    /\bTipas\s*[:\-]?\s*(.+?)(?=\s+(?:Rūšis|Rusis|Laikytojo\s+adresas|Įregistravimo|Iregistravimo|Eil\.))/iu
  ]);

  if (!metadata.holder_type) {
    const typeLine =
      findLineValue([
        /\bTipas\s*[:\-]?\s*(.*)$/iu
      ]);

    if (typeLine) {
      metadata.holder_type =
        typeLine
          .replace(
            /\s+Rūšis\b.*$/iu,
            ""
          )
          .replace(
            /\s+Rusis\b.*$/iu,
            ""
          )
          .trim() || null;
    }
  }

  // ==========================================================
  // DECLARED SPECIES
  // ==========================================================

  const speciesRaw = firstMatch([
    /\bRūšis\s*[:\-]?\s*([A-ZĄČĘĖĮŠŲŪŽa-ząčęėįšųūž]+)/iu,
    /\bRusis\s*[:\-]?\s*([A-Za-z]+)/iu
  ]);

  if (speciesRaw) {
    metadata.declared_species =
      normalizeLithuanianSpecies(
        speciesRaw
      );
  }

  // ==========================================================
  // HOLDER ADDRESS
  // ==========================================================

  metadata.holder_address =
    firstMatch([
      /Laikytojo\s+adresas\s*[:\-]?\s*(.+?)(?=\s+(?:Įregistravimo|Iregistravimo|Bandos\s+adresas|Eil\.\s*Nr\.))/iu
    ]);

  // ==========================================================
  // HERD ADDRESS
  // ==========================================================

  metadata.herd_address =
    firstMatch([
      /Bandos\s+adresas\s*[:\-]?\s*(.+?)(?=\s+(?:Eil\.\s*Nr\.|www\.zudc\.lt|Gyvų\s+gyvūnų\s+sąrašas|Sugrupuota|$))/iu
    ]);

  // ==========================================================
  // REGISTRATION DATE
  // ==========================================================

  const registrationRaw =
    firstMatch(
      [
        /Įregistravimo\s+data[\s\S]{0,120}?(\d{4}[-./]\d{2}[-./]\d{2})/iu,
        /Iregistravimo\s+data[\s\S]{0,120}?(\d{4}[-./]\d{2}[-./]\d{2})/iu
      ],
      headerText
    );

  if (registrationRaw) {
    metadata.registration_date =
      toISO(registrationRaw);
  }

  return {
    metadata,

    debug: {
      header_lines:
        lines.slice(0, 40),

      header_text:
        headerOneLine.slice(0, 3000)
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
// BREED / NAME HELPERS
// ============================================================

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
    /^[A-ZĄČĘĖĮŠŲŪŽ\s.'-]+$/u.test(
      name
    );

  if (onlyUpperNameChars) {
    name =
      name.replace(/\s+/g, "");
  }

  return name || null;
}

function findSexMatch(s) {
  if (!s) return null;

  const normalized =
    normalizeBreedSpacing(s);

  const re =
    new RegExp(
      `(${SEX_WORDS})`,
      "i"
    );

  return normalized.match(re);
}

function splitMiddleIntoNameSexBreed(
  middle
) {
  const cleanMiddle =
    normalizeBreedSpacing(
      normalizeOneLine(middle)
    );

  const sexMatch =
    findSexMatch(cleanMiddle);

  if (!sexMatch) {
    return {
      name:
        cleanName(cleanMiddle),

      sex: null,

      breed: null
    };
  }

  const nameRaw =
    cleanMiddle
      .slice(
        0,
        sexMatch.index
      )
      .trim();

  const sexRaw =
    sexMatch[0];

  const breedRaw =
    cleanMiddle
      .slice(
        sexMatch.index +
          sexRaw.length
      )
      .trim();

  return {
    name:
      cleanName(nameRaw),

    sex:
      normalizeSex(sexRaw),

    breed:
      cleanBreed(breedRaw)
  };
}

function fixSexBreed(row) {
  if (!row) return row;

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

  const gluedSexRe =
    new RegExp(
      `^(${SEX_WORDS})\\s*(.*)$`,
      "i"
    );

  const m =
    breed.match(
      gluedSexRe
    );

  if (!m) {
    return row;
  }

  row.sex =
    normalizeSex(m[1]);

  row.breed =
    cleanBreed(m[2]);

  return row;
}

// ============================================================
// HEADER DEBUG
// ============================================================

function getHeaderDebug(
  originalText
) {
  const text =
    normalizeText(
      originalText
    );

  const allLines =
    text
      .split(/\n/)
      .map((s) =>
        s
          .replace(/\s+/g, " ")
          .trim()
      )
      .filter(Boolean);

  const headerPattern =
    /Eil\.\s*Nr\.[\s\S]*?Gimimo\s*data/i;

  const headerMatch =
    text.match(
      headerPattern
    );

  const startIdx =
    headerMatch
      ? text.indexOf(
          headerMatch[0]
        )
      : -1;

  const headerIdx =
    allLines.findIndex(
      (line) =>
        /Eil\.\s*Nr\./i.test(
          line
        ) &&
        /(Rūšis|Rusis)/i.test(
          line
        ) &&
        /Gimimo\s*data/i.test(
          line
        )
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
  if (!tag) {
    return false;
  }

  return /^(?:[A-Z]{2,3}\d+|\d{8,20})$/i.test(
    String(tag).trim()
  );
}

// ============================================================
// INDIVIDUAL ANIMAL PARSER
// ============================================================

function parseIndividualAnimalsFromText(
  originalText
) {
  const text =
    normalizeText(
      originalText || ""
    );

  const oneLine =
    normalizeOneLine(text);

  const {
    allLines,
    headerIdx,
    startIdx,
    foundHeader
  } =
    getHeaderDebug(text);

  const rowRe =
    new RegExp(
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
    (m =
      rowRe.exec(
        oneLine
      )) !== null
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
      row_index:
        rowIndex,

      species,

      species_label:
        speciesRaw,

      tag_no:
        tag,

      name,

      sex,

      breed,

      birth_date:
        toISO(dateRaw),

      age_months:
        parseAge(
          ageRaw
        ),

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
      isValidTag(
        row.tag_no
      ) &&
      row.birth_date
    ) {
      rows.push(row);
    }
  }

  const seen =
    new Set();

  const unique =
    rows.filter(
      (row) => {
        const key =
          `${row.species}:${row.tag_no}`;

        if (
          seen.has(key)
        ) {
          return false;
        }

        seen.add(key);

        return true;
      }
    );

  return {
    rows:
      unique,

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
      .map((s) =>
        s
          .replace(/\s+/g, " ")
          .trim()
      )
      .filter(Boolean);

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

  const summaryRe =
    new RegExp(
      `(${GROUPED_SPECIES_WORDS})\\s*\\((.*?)\\)\\s+(\\d+(?:[,.]\\d+)?)\\s+([A-ZĄČĘĖĮŠŲŪŽa-ząčęėįšųūž.]+)`,
      "giu"
    );

  let sm;

  let syntheticIndex =
    100000;

  while (
    (sm =
      summaryRe.exec(
        text
      )) !== null
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
        parseCount(
          sm[3]
        ),

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

  return groups.filter(
    (row) => {
      const key =
        `${row.species}:${row.group}:${row.animal_count}:${row.unit}`;

      if (
        seen.has(key)
      ) {
        return false;
      }

      seen.add(key);

      return true;
    }
  );
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

  const groupedRows =
    parseGroupedAnimalsFromText(
      text
    );

  // ==========================================================
  // ADD FARM / PERSONAL CODE TO EVERY INDIVIDUAL ANIMAL
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

  // ==========================================================
  // ADD SAME METADATA TO EVERY GROUPED ANIMAL ROW
  // ==========================================================

  const groupedRowsWithMetadata =
    groupedRows.map(
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

  const groupedSpeciesCounts =
    {};

  for (
    const row of
    groupedRowsWithMetadata
  ) {
    groupedSpeciesCounts[
      row.species
    ] =
      (
        groupedSpeciesCounts[
          row.species
        ] || 0
      ) + 1;
  }

  return {
    metadata,

    rows,

    groupedRows:
      groupedRowsWithMetadata,

    debug: {
      ...individualResult.debug,

      individual_count:
        rows.length,

      grouped_count:
        groupedRowsWithMetadata.length,

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
      },

      metadata_debug:
        metadataResult.debug
    }
  };
}

// ============================================================
// REQUEST BODY HELPERS
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
          data += chunk;
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
// HANDLER
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

      if (
        contentType.includes(
          "multipart/form-data"
        )
      ) {
        return res
          .status(400)
          .json({
            error:
              "Send exactly one PDF per request as raw binary data. Multipart upload is not supported."
          });
      }

      let pdfBuffer =
        null;

      let inputMode =
        null;

      // ======================================================
      // ONE RAW PDF
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
      // ONE PDF URL
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
              error:
                'Send exactly one PDF URL: { "url": "https://..." }'
            });
        }

        const pdfUrl =
          body.url.trim();

        const remoteResponse =
          await fetch(
            pdfUrl
          );

        if (
          !remoteResponse.ok
        ) {
          return res
            .status(400)
            .json({
              error:
                "Cannot fetch PDF URL",

              status:
                remoteResponse.status
            });
        }

        pdfBuffer =
          Buffer.from(
            await remoteResponse.arrayBuffer()
          );

        inputMode =
          "url";
      }

      // ======================================================
      // UNSUPPORTED CONTENT TYPE
      // ======================================================

      else {
        return res
          .status(400)
          .json({
            error:
              "Unsupported content-type. Send one PDF as application/pdf or application/octet-stream.",

            contentType
          });
      }

      // ======================================================
      // VALIDATE FILE
      // ======================================================

      if (
        !pdfBuffer ||
        !pdfBuffer.length
      ) {
        return res
          .status(400)
          .json({
            error:
              "PDF file is empty."
          });
      }

      const signature =
        pdfBuffer
          .subarray(0, 5)
          .toString(
            "ascii"
          );

      if (
        signature !== "%PDF-"
      ) {
        return res
          .status(400)
          .json({
            error:
              "Input is not a valid PDF file."
          });
      }

      // ======================================================
      // PARSE PDF
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
            error:
              "PDF contains no extractable text."
          });
      }

      const {
        metadata,
        rows,
        groupedRows,
        debug
      } =
        parseAnimalsFromText(
          extractedText
        );

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
// VERCEL CONFIG
// ============================================================

module.exports.config = {
  api: {
    bodyParser: false
  }
};
