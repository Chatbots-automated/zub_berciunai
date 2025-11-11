// api/ingest-gea.js
// Vercel/Next.js API route: uploads an XLSX, maps rows to headers exactly as in the provided sample,
// and if a future file has *no headers*, it auto-applies the saved header set from /tmp or a fallback.
//
// Upload field name: "file" (multipart/form-data)

import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import formidable from 'formidable';
import XLSX from 'xlsx';

export const config = {
  api: {
    bodyParser: false,
    sizeLimit: '100mb'
  }
};

// ---- Header persistence (ephemeral but useful on Vercel) ----
const SNAPSHOT_PATH = '/tmp/gea_headers.json';

// ---- Optional fallback headers (comma-separated) via env: GEA_HEADERS
//     Example: GEA_HEADERS="Ausies nr, Laktacijos diena, ..."
//     If you already know the exact header list, put it here to guarantee mapping
const FALLBACK_FROM_ENV = (process.env.GEA_HEADERS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// ---- Built-in fallback (edit once you confirm the sample headers).
// Leave empty; after first upload WITH headers, we learn & save them to /tmp.
const BUILTIN_FALLBACK = [
  // Paste your exact header names from the sample here if you want a hardcoded fallback.
];

// ---- Utils ----
function loadSnapshotHeaders() {
  try {
    const raw = fs.readFileSync(SNAPSHOT_PATH, 'utf8');
    const arr = JSON.parse(raw);
    if (Array.isArray(arr) && arr.length) return arr;
  } catch (_) {}
  return null;
}
async function saveSnapshotHeaders(headers) {
  try {
    await fsp.writeFile(SNAPSHOT_PATH, JSON.stringify(headers, null, 2), 'utf8');
  } catch (_) {}
}

// Very simple detector: if first cell looks like a tag (LT/DE + digits), assume NO headers.
function looksLikeTag(value) {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  if (!v) return false;
  // Common patterns like LT0000..., DE0000...
  return /^([A-Z]{2}\d{6,}|LT\d+|DE\d+)/i.test(v);
}
function detectHasHeader(firstRow) {
  if (!firstRow) return false;
  const firstCell = firstRow[0];
  if (looksLikeTag(String(firstCell || ''))) return false;
  // If most cells are non-numeric strings, likely headers
  const cells = firstRow.filter(c => c !== null && c !== undefined);
  if (!cells.length) return false;
  const strish = cells.filter(c => typeof c === 'string' && /\D/.test(c));
  return (strish.length / cells.length) >= 0.5;
}

// Normalize Excel cell to stable JSON value
function normCell(v) {
  if (v === undefined) return null;
  if (v === null) return null;
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof v === 'string') {
    const s = v.trim();
    if (s === '' || s === '-' || s === '—') return null;

    // Try parse common date strings (dd.MM.yyyy or yyyy-MM-dd)
    const dm = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dm) return s; // already ISO
    const dm2 = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (dm2) return `${dm2[3]}-${dm2[2]}-${dm2[1]}`;
    return s;
  }
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return v;
}

// Ensure each row has same length as headers (pad/truncate)
function alignRow(row, len) {
  const r = Array.isArray(row) ? [...row] : [];
  if (r.length < len) r.push(...Array(len - r.length).fill(null));
  if (r.length > len) r.length = len;
  return r;
}

function parseExcelBuffer(buf) {
  // Read workbook
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  // Raw rows (AOA)
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, raw: false, defval: null });
  return rows;
}

async function getFormFile(req) {
  const form = formidable({
    multiples: false,
    keepExtensions: true,
    maxFileSize: 100 * 1024 * 1024
  });
  return new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => {
      if (err) return reject(err);
      const f = files?.file || files?.upload || Object.values(files || {})[0];
      if (!f) return reject(new Error('No file uploaded. Use field name "file".'));
      resolve({ fields, file: f });
    });
  });
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Use POST (multipart/form-data) with field "file".' });
      return;
    }

    const { file } = await getFormFile(req);
    const filePath = file.filepath || file.path;
    if (!filePath) {
      res.status(400).json({ error: 'Uploaded file path missing.' });
      return;
    }

    const buf = await fsp.readFile(filePath);
    const rows = parseExcelBuffer(buf);
    if (!rows || !rows.length) {
      res.status(400).json({ error: 'Excel has no rows.' });
      return;
    }

    // Decide headers
    let headers = null;
    let dataStartIdx = 0;

    const hasHeader = detectHasHeader(rows[0]);
    if (hasHeader) {
      headers = rows[0].map(c => (c == null ? '' : String(c).trim()));
      dataStartIdx = 1;

      // Save snapshot for future headerless files
      if (headers.some(h => h)) {
        await saveSnapshotHeaders(headers);
      }
    } else {
      // Try /tmp snapshot
      headers = loadSnapshotHeaders();
      if (!headers || !headers.length) {
        // Try env fallback
        headers = FALLBACK_FROM_ENV.length ? FALLBACK_FROM_ENV : BUILTIN_FALLBACK;
      }
      if (!headers || !headers.length) {
        // As a last resort, generate generic headers
        const maxLen = Math.max(...rows.map(r => (Array.isArray(r) ? r.length : 0)));
        headers = Array.from({ length: maxLen }, (_, i) => `Col${i + 1}`);
      }
      dataStartIdx = 0;
    }

    // Align all rows and build objects
    const H = headers.length;
    const dataRows = rows.slice(dataStartIdx).map(r => alignRow(r, H));
    const out = dataRows.map(r => {
      const obj = {};
      for (let i = 0; i < H; i++) {
        obj[headers[i]] = normCell(r[i]);
      }
      return obj;
    });

    res.status(200).json({
      columns: headers,
      count: out.length,
      rows: out
    });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
}
