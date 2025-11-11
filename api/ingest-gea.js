// Vercel/Next.js API: uploads an XLSX and maps rows to the exact headers.
// Accepts EITHER multipart/form-data (field "file") OR raw binary body.
// If the first row has headers, we learn & cache them in /tmp for future headerless files.
// We also hardcode your provided header list as a built-in fallback.

import fs from 'fs';
import fsp from 'fs/promises';
import formidable from 'formidable';
import { read, utils } from 'xlsx';

export const config = {
  api: {
    bodyParser: false,      // we handle stream ourselves / via formidable
    sizeLimit: '100mb'
  }
};

// ---- Persistent header snapshot (per-deployment; resets on cold start) ----
const SNAPSHOT_PATH = '/tmp/gea_headers.json';

// ---- Built-in fallback headers (YOUR list) ----
const BUILTIN_FALLBACK = [
  'karves nr','kaklo nr','statusas','grupe','pieno vidurkis',
  'melzimo data','melzimo laikas','pieno kiekis',
  'melzimo data','melzimo laikas','pieno kiekis',
  'melzimo data','melzimo laikas','pieno kiekis',
  'melzimo data','melzimo laikas','pieno kiekis',
  'melzimo data','melzimo laikas','pieno kiekis',
  'dalyvauja pieno gamyboje','apsiversiavo','laktacijos dienos','apseklinimo diena'
];

// ---- Optional env fallback (comma-separated) ----
const FALLBACK_FROM_ENV = (process.env.GEA_HEADERS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

function normHdr(s) {
  return String(s ?? '').trim();
}

function loadSnapshotHeaders() {
  try {
    const raw = fs.readFileSync(SNAPSHOT_PATH, 'utf8');
    const arr = JSON.parse(raw);
    if (Array.isArray(arr) && arr.length) return arr.map(normHdr);
  } catch {}
  return null;
}

async function saveSnapshotHeaders(headers) {
  try {
    await fsp.writeFile(SNAPSHOT_PATH, JSON.stringify(headers, null, 2), 'utf8');
  } catch {}
}

// Detect if first row is headers (simple heuristic)
function looksLikeTag(value) {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  if (!v) return false;
  return /^([A-Z]{2}\d{6,}|LT\d+|DE\d+)/i.test(v);
}
function detectHasHeader(firstRow) {
  if (!Array.isArray(firstRow) || !firstRow.length) return false;
  const firstCell = firstRow[0];
  if (looksLikeTag(String(firstCell ?? ''))) return false;
  const cells = firstRow.filter(c => c != null);
  if (!cells.length) return false;
  const strish = cells.filter(c => typeof c === 'string' && /\D/.test(c));
  return (strish.length / cells.length) >= 0.5;
}

function normCell(v) {
  if (v == null) return null;
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof v === 'string') {
    const s = v.trim();
    if (s === '' || s === '-' || s === '—') return null;
    // ISO yyyy-mm-dd
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    // dd.MM.yyyy -> ISO
    const m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    return s;
  }
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return v;
}

function alignRow(row, len) {
  const r = Array.isArray(row) ? [...row] : [];
  if (r.length < len) r.push(...Array(len - r.length).fill(null));
  if (r.length > len) r.length = len;
  return r;
}

// --- Read an XLSX buffer into AOA rows ---
function parseExcelBuffer(buf) {
  const wb = read(buf, { type: 'buffer', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = utils.sheet_to_json(ws, { header: 1, blankrows: false, raw: false, defval: null });
  return rows;
}

// --- Try to get a file buffer from either multipart or raw body ---
async function getUploadBuffer(req) {
  const ct = (req.headers['content-type'] || '').toLowerCase();

  // If multipart/form-data → use formidable
  if (ct.startsWith('multipart/form-data')) {
    const form = formidable({
      multiples: false,
      keepExtensions: true,
      maxFileSize: 100 * 1024 * 1024
    });
    const { buffer, originalFilename } = await new Promise((resolve, reject) => {
      form.parse(req, async (err, fields, files) => {
        if (err) return reject(err);
        const f = files?.file || files?.upload || Object.values(files || {})[0];
        if (!f) return reject(new Error('No file uploaded. Use form field "file".'));
        const fp = f.filepath || f.path;
        if (!fp) return reject(new Error('Uploaded file path missing (formidable).'));
        try {
          const buf = await fsp.readFile(fp);
          resolve({ buffer: buf, originalFilename: f.originalFilename || f.newFilename || 'upload.xlsx' });
        } catch (e) {
          reject(e);
        }
      });
    });
    return { buffer, originalFilename };
  }

  // Otherwise, accept raw binary (e.g., application/octet-stream)
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const buffer = Buffer.concat(chunks);
  if (!buffer.length) throw new Error('Empty body; send multipart "file" or raw XLSX bytes.');
  return { buffer, originalFilename: 'upload.xlsx' };
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Use POST. Send multipart/form-data (file field "file") or raw XLSX binary.' });
      return;
    }

    const { buffer } = await getUploadBuffer(req);
    const rows = parseExcelBuffer(buffer);
    if (!rows || !rows.length) {
      res.status(400).json({ error: 'Excel has no rows.' });
      return;
    }

    // Decide headers
    let headers = null;
    let dataStartIdx = 0;

    if (detectHasHeader(rows[0])) {
      headers = rows[0].map(normHdr);
      dataStartIdx = 1;
      if (headers.some(Boolean)) await saveSnapshotHeaders(headers);
    } else {
      headers =
        loadSnapshotHeaders() ||
        (FALLBACK_FROM_ENV.length ? FALLBACK_FROM_ENV.map(normHdr) : null) ||
        (BUILTIN_FALLBACK.length ? BUILTIN_FALLBACK.map(normHdr) : null);

      if (!headers) {
        const maxLen = Math.max(...rows.map(r => (Array.isArray(r) ? r.length : 0)));
        headers = Array.from({ length: maxLen }, (_, i) => `Col${i + 1}`);
      }
      dataStartIdx = 0;
    }

    const H = headers.length;
    const dataRows = rows.slice(dataStartIdx).map(r => alignRow(r, H));
    const out = dataRows.map(r => {
      const obj = {};
      for (let i = 0; i < H; i++) obj[headers[i]] = normCell(r[i]);
      return obj;
    });

    res.status(200).json({
      columns: headers,
      count: out.length,
      rows: out
    });
  } catch (err) {
    // Common “no parser found” (formidable) → clarify
    const msg = String(err && err.message || err);
    if (/no parser found/i.test(msg)) {
      res.status(400).json({
        error: 'no parser found',
        hint: 'Send multipart/form-data with field "file", or send raw XLSX bytes (application/octet-stream).'
      });
      return;
    }
    res.status(500).json({ error: msg });
  }
}
