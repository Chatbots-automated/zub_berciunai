import fs from 'fs';
import fsp from 'fs/promises';
import formidable from 'formidable';
import { read, utils } from 'xlsx';

export const config = {
  api: { bodyParser: false, sizeLimit: '100mb' }
};

const SNAPSHOT_PATH = '/tmp/gea_headers.json';

// Your permanent header map (exactly as provided)
const BUILTIN_FALLBACK = [
  'karves nr','kaklo nr','statusas','grupe','pieno vidurkis',
  'melzimo data','melzimo laikas','pieno kiekis',
  'melzimo data','melzimo laikas','pieno kiekis',
  'melzimo data','melzimo laikas','pieno kiekis',
  'melzimo data','melzimo laikas','pieno kiekis',
  'melzimo data','melzimo laikas','pieno kiekis',
  'dalyvauja pieno gamyboje','apsiversiavo','laktacijos dienos','apseklinimo diena'
];

const FALLBACK_FROM_ENV = (process.env.GEA_HEADERS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

const normHdr = s => String(s ?? '').trim();

function loadSnapshotHeaders() {
  try {
    const raw = fs.readFileSync(SNAPSHOT_PATH, 'utf8');
    const arr = JSON.parse(raw);
    if (Array.isArray(arr) && arr.length) return arr.map(normHdr);
  } catch {}
  return null;
}
async function saveSnapshotHeaders(headers) {
  try { await fsp.writeFile(SNAPSHOT_PATH, JSON.stringify(headers, null, 2), 'utf8'); } catch {}
}

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

// ---------- NEW: header de-duplication so repeated names don’t overwrite ----------
function dedupeHeaders(headers) {
  const seen = Object.create(null);
  return headers.map(h => {
    const base = normHdr(h) || 'Col';
    if (!seen[base]) { seen[base] = 1; return base; }
    const idx = ++seen[base];
    // First occurrence keeps plain name, repeats get suffixes _2, _3...
    return `${base}_${idx}`;
  });
}

// ---------- Normalizers ----------
function toISODate(val) {
  if (val == null) return null;
  if (val instanceof Date) {
    const y = val.getFullYear();
    const m = String(val.getMonth()+1).padStart(2,'0');
    const d = String(val.getDate()).padStart(2,'0');
    return `${y}-${m}-${d}`;
  }
  const s = String(val).trim();
  if (!s) return null;
  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // dd.MM.yyyy
  let m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  // M/D/YY or M/D/YYYY → assume US style from Excel text
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const mm = String(m[1]).padStart(2,'0');
    const dd = String(m[2]).padStart(2,'0');
    const yy = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${yy}-${mm}-${dd}`;
  }
  return s; // leave as-is if unknown
}
function toTime(val) {
  if (val == null) return null;
  const s = String(val).trim();
  if (!s) return null;
  // H:mm or HH:mm
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m) {
    const hh = String(m[1]).padStart(2,'0');
    return `${hh}:${m[2]}`;
  }
  return s;
}
function toNum(val) {
  if (val == null) return null;
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  const s = String(val).trim().replace(/\s/g,'').replace(',','.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function toBoolLT(val) {
  if (val == null) return null;
  const s = String(val).trim().toLowerCase();
  if (s === 'taip') return true;
  if (s === 'ne') return false;
  return null;
}

// Apply normalization per column name
function normalizeRow(obj) {
  const out = { ...obj };

  // tag alias
  if (out['karves nr']) out.tag_no = String(out['karves nr']).trim() || null;

  // dates
  for (const k of Object.keys(out)) {
    const lk = k.toLowerCase();
    if (lk.includes('data') || lk === 'apsiversiavo' || lk === 'apseklinimo diena') {
      out[k] = toISODate(out[k]);
    }
    if (lk.includes('laikas')) {
      out[k] = toTime(out[k]);
    }
  }

  // booleans
  if ('dalyvauja pieno gamyboje' in out) {
    out['dalyvauja pieno gamyboje'] = toBoolLT(out['dalyvauja pieno gamyboje']);
  }

  // numbers
  const numericKeys = [
    'pieno vidurkis',
    'pieno kiekis','pieno kiekis_2','pieno kiekis_3','pieno kiekis_4','pieno kiekis_5',
    'laktacijos dienos','kaklo nr','grupe'
  ];
  for (const k of numericKeys) if (k in out) out[k] = toNum(out[k]);

  return out;
}

// Excel → rows (AOA)
function parseExcelBuffer(buf) {
  const wb = read(buf, { type: 'buffer', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return utils.sheet_to_json(ws, { header: 1, blankrows: false, raw: false, defval: null });
}

// Accept multipart (field "file") or raw binary
async function getUploadBuffer(req) {
  const ct = (req.headers['content-type'] || '').toLowerCase();
  if (ct.startsWith('multipart/form-data')) {
    const form = formidable({ multiples: false, keepExtensions: true, maxFileSize: 100 * 1024 * 1024 });
    const { buffer } = await new Promise((resolve, reject) => {
      form.parse(req, async (err, fields, files) => {
        if (err) return reject(err);
        const f = files?.file || files?.upload || Object.values(files || {})[0];
        if (!f) return reject(new Error('No file uploaded. Use form field "file".'));
        const fp = f.filepath || f.path;
        if (!fp) return reject(new Error('Uploaded file path missing.'));
        try { resolve({ buffer: await fsp.readFile(fp) }); } catch (e) { reject(e); }
      });
    });
    return { buffer };
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const buffer = Buffer.concat(chunks);
  if (!buffer.length) throw new Error('Empty body; send multipart "file" or raw XLSX bytes.');
  return { buffer };
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Use POST. Send multipart/form-data (field "file") or raw XLSX binary.' });
      return;
    }

    const { buffer } = await getUploadBuffer(req);
    const rows = parseExcelBuffer(buffer);
    if (!rows?.length) {
      res.status(400).json({ error: 'Excel has no rows.' });
      return;
    }

    // Decide headers
    let headers = null;
    let dataStartIdx = 0;

    if (detectHasHeader(rows[0])) {
      headers = rows[0].map(normHdr);
      headers = dedupeHeaders(headers);          // <<=== prevent overwrite of repeated names
      dataStartIdx = 1;
      if (headers.some(Boolean)) await saveSnapshotHeaders(headers);
    } else {
      headers =
        loadSnapshotHeaders() ||
        (FALLBACK_FROM_ENV.length ? FALLBACK_FROM_ENV.map(normHdr) : null) ||
        (BUILTIN_FALLBACK.length ? dedupeHeaders(BUILTIN_FALLBACK) : null);

      if (!headers) {
        const maxLen = Math.max(...rows.map(r => (Array.isArray(r) ? r.length : 0)));
        headers = Array.from({ length: maxLen }, (_, i) => `Col_${i+1}`);
      }
      // If the fallback contains repeats, also dedupe
      headers = dedupeHeaders(headers);
      dataStartIdx = 0;
    }

    // Build row objects
    const H = headers.length;
    const dataRows = rows.slice(dataStartIdx).map(r => {
      const rr = Array.isArray(r) ? r.slice(0, H) : Array(H).fill(null);
      if (rr.length < H) rr.push(...Array(H - rr.length).fill(null));
      const obj = {};
      for (let i = 0; i < H; i++) obj[headers[i]] = rr[i];
      return normalizeRow(obj);                  // <<=== normalize here
    });

    res.status(200).json({
      columns: headers,
      count: dataRows.length,
      rows: dataRows
    });
  } catch (err) {
    const msg = String(err?.message || err);
    if (/no parser found/i.test(msg)) {
      res.status(400).json({
        error: 'no parser found',
        hint: 'Send multipart/form-data with field "file" OR raw XLSX bytes (application/octet-stream).'
      });
      return;
    }
    res.status(500).json({ error: msg });
  }
}
