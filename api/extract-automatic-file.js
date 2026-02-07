// /api/extract-automatic-file.js
import fs from "fs/promises";
import formidable from "formidable";
import { read, utils } from "xlsx";

export const config = {
  api: { bodyParser: false, sizeLimit: "100mb" },
};

// ---------- column definitions ----------
const AT1_COLS = [
  "cow_number",
  "ear_number",
  "cow_state",
  "group_number",
  "pregnant_since",
  "lactation_days",
  "inseminated_at",
  "pregnant_days",
  "next_pregnancy_date",
  "days_until_waiting_pregnancy",
];

// ---- AT2 schemas ----
// (A..AJ) WITHOUT the mysterious D column
const AT2_COLS_NO_D = [
  "cow_number",            // A
  "genetic_worth",         // B
  "blood_line",            // C
  "avg_milk_prod_weight",  // D (in this schema)
  "produce_milk",          // E
  "last_milking_date",     // F
  "last_milking_time",     // G
  "last_milking_weight",   // H
  "milking_date_1",        // I
  "milking_time_1",        // J
  "milking_weight_1",      // K
  "milking_date_2",        // L
  "milking_time_2",        // M
  "milking_weight_2",      // N
  "milking_date_3",        // O
  "milking_time_3",        // P
  "milking_weight_3",      // Q
  "milking_date_4",        // R
  "milking_time_4",        // S
  "milking_weight_4",      // T
  "milking_date_5",        // U
  "milking_time_5",        // V
  "milking_weight_5",      // W
  "milking_date_6",        // X
  "milking_time_6",        // Y
  "milking_weight_6",      // Z
  "milking_date_7",        // AA
  "milking_time_7",        // AB
  "milking_weight_7",      // AC
  "milking_date_8",        // AD
  "milking_time_8",        // AE
  "milking_weight_8",      // AF
  "milking_date_9",        // AG
  "milking_time_9",        // AH
  "milking_weight_9",      // AI
];

// WITH the extra blank “D” column after blood_line (this is your file)
const AT2_COLS_WITH_D = [
  "cow_number",            // A
  "genetic_worth",         // B
  "blood_line",            // C
  "unused_d",              // D (blank / unused)
  "avg_milk_prod_weight",  // E
  "produce_milk",          // F (Taip/Ne)
  "last_milking_date",     // G
  "last_milking_time",     // H
  "last_milking_weight",   // I
  "milking_date_1",        // J
  "milking_time_1",        // K
  "milking_weight_1",      // L
  "milking_date_2",        // M
  "milking_time_2",        // N
  "milking_weight_2",      // O
  "milking_date_3",        // P
  "milking_time_3",        // Q
  "milking_weight_3",      // R
  "milking_date_4",        // S
  "milking_time_4",        // T
  "milking_weight_4",      // U
  "milking_date_5",        // V
  "milking_time_5",        // W
  "milking_weight_5",      // X
  "milking_date_6",        // Y
  "milking_time_6",        // Z
  "milking_weight_6",      // AA
  "milking_date_7",        // AB
  "milking_time_7",        // AC
  "milking_weight_7",      // AD
  "milking_date_8",        // AE
  "milking_time_8",        // AF
  "milking_weight_8",      // AG
  "milking_date_9",        // AH
  "milking_time_9",        // AI
  "milking_weight_9",      // AJ
];

const AT3_COLS = [
  "cow_number",
  "teat_missing_right_back",
  "teat_missing_back_left",
  "teat_missing_front_left",
  "teat_missing_front_right",
  "insemination_count",
  "bull_1",
  "bull_2",
  "bull_3",
  "lactation_number",
];

// ---------- helpers ----------
function isRowEmpty(row) {
  if (!Array.isArray(row) || row.length === 0) return true;
  return row.every((v) => v == null || String(v).trim() === "");
}

function rowToString(row) {
  return (Array.isArray(row) ? row : [])
    .map((v) => (v == null ? "" : String(v).trim()))
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function findMarkerIndex(rows, marker) {
  const m = marker.toLowerCase();
  for (let i = 0; i < rows.length; i++) {
    const s = rowToString(rows[i]);
    if (s.includes(m)) return i;
  }
  return -1;
}

function cleanSectionRows(sectionRows) {
  let start = 0;
  while (start < sectionRows.length && isRowEmpty(sectionRows[start])) start++;

  let end = sectionRows.length - 1;
  while (end >= start && isRowEmpty(sectionRows[end])) end--;

  return sectionRows.slice(start, end + 1).filter((r) => !isRowEmpty(r));
}

function mapRowsToObjects(rows, cols) {
  const width = cols.length;
  return rows.map((r) => {
    const row = Array.isArray(r) ? r.slice(0, width) : [];
    while (row.length < width) row.push(null);

    const obj = {};
    for (let i = 0; i < width; i++) obj[cols[i]] = row[i];
    return obj;
  });
}

function parseExcelBuffer(buf) {
  const wb = read(buf, { type: "buffer", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return utils.sheet_to_json(ws, {
    header: 1,
    raw: false,
    defval: null,
    blankrows: true,
  });
}

async function getUploadBuffer(req) {
  const ct = String(req.headers["content-type"] || "").toLowerCase();

  if (ct.startsWith("multipart/form-data")) {
    const form = formidable({
      multiples: false,
      keepExtensions: true,
      maxFileSize: 100 * 1024 * 1024,
    });

    const { buffer } = await new Promise((resolve, reject) => {
      form.parse(req, async (err, fields, files) => {
        if (err) return reject(err);
        const f = files?.file || files?.upload || (files && Object.values(files)[0]);
        if (!f) return reject(new Error('No file uploaded. Use form field "file".'));

        const fp = f.filepath || f.path;
        if (!fp) return reject(new Error("Uploaded file path missing."));

        try {
          resolve({ buffer: await fs.readFile(fp) });
        } catch (e) {
          reject(e);
        }
      });
    });

    return buffer;
  }

  const chunks = [];
  for await (const ch of req) chunks.push(ch);
  const buffer = Buffer.concat(chunks);
  if (!buffer.length) throw new Error('Empty body. Send multipart "file" or raw Excel bytes.');
  return buffer;
}

// --- Heuristic: decide AT2 schema ---
function pickAt2Schema(sec2) {
  const first = sec2.find(r => Array.isArray(r) && r.some(v => String(v ?? "").trim() !== ""));
  if (!first) return AT2_COLS_WITH_D; // default to WITH_D (your case)

  const cell = (i) => String(first[i] ?? "").trim();

  const looksBoolLT = (s) => {
    const v = s.toLowerCase();
    return v === "taip" || v === "ne";
  };
  const looksDate = (s) => /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s) || /^\d{4}-\d{2}-\d{2}$/.test(s) || /^\d{1,2}\.\d{1,2}\.\d{4}$/.test(s);
  const looksTime = (s) => /^\d{1,2}:\d{2}$/.test(s);
  const looksNumber = (s) => s !== "" && !isNaN(Number(String(s).replace(",", ".")));

  // WITH_D layout expects:
  // [0 cow,1 genetic,2 blood,3 blank/unused,4 avgNum,5 Taip/Ne,6 date,7 time,8 weightNum, 9 date...]
  const dBlank = cell(3) === "" || cell(3).toLowerCase() === "null";
  const avgOk  = looksNumber(cell(4));
  const boolOk = looksBoolLT(cell(5));
  const dateOk = looksDate(cell(6));
  const timeOk = looksTime(cell(7));

  if (dBlank && avgOk && boolOk && dateOk && timeOk) return AT2_COLS_WITH_D;

  // Otherwise try NO_D
  return AT2_COLS_NO_D;
}

// ---------- main handler ----------
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({
        error: "Use POST",
        hint: 'Send multipart/form-data with field "file" OR raw XLS bytes.',
      });
    }

    const buffer = await getUploadBuffer(req);
    const rows = parseExcelBuffer(buffer);
    if (!rows || !rows.length) return res.status(400).json({ error: "Excel has no rows." });

    const i1 = findMarkerIndex(rows, "1 ATASKAITA");
    const i2 = findMarkerIndex(rows, "2 ATASKAITA");
    const i3 = findMarkerIndex(rows, "3 ATASKAITA");

    if (i1 === -1 || i2 === -1 || i3 === -1) {
      return res.status(400).json({
        error: "Could not find all 3 markers (1/2/3 ATASKAITA).",
        found: { i1, i2, i3 },
      });
    }

    const sec1 = cleanSectionRows(rows.slice(i1 + 1, i2));
    const sec2 = cleanSectionRows(rows.slice(i2 + 1, i3));
    const sec3 = cleanSectionRows(rows.slice(i3 + 1));

    const ataskaita1 = mapRowsToObjects(sec1, AT1_COLS);

    const at2Cols = pickAt2Schema(sec2);
    const ataskaita2 = mapRowsToObjects(sec2, at2Cols);

    const ataskaita3 = mapRowsToObjects(sec3, AT3_COLS);

    return res.status(200).json({
      meta: {
        markers: { i1, i2, i3 },
        at2_schema: at2Cols === AT2_COLS_WITH_D ? "WITH_D" : "NO_D",
        counts: {
          ataskaita1: ataskaita1.length,
          ataskaita2: ataskaita2.length,
          ataskaita3: ataskaita3.length,
        },
      },
      ataskaita1,
      ataskaita2,
      ataskaita3,
    });
  } catch (err) {
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
