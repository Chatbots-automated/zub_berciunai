import type { NextRequest } from "next/server";
import pdfParse from "pdf-parse";

// --- Helpers ---------------------------------------------------------------

function toISO(d: string | null) {
  if (!d) return null;
  // Accept 2025-10-25, 25-10-2025, 2018-05-21, etc.
  const m =
    d.match(/^(\d{4})[-\.\/](\d{2})[-\.\/](\d{2})$/) ||
    d.match(/^(\d{2})[-\.\/](\d{2})[-\.\/](\d{4})$/);
  if (!m) return null;
  const [_, a, b, c] = m;
  return m[1].length === 4 ? `${a}-${b}-${c}` : `${c}-${b}-${a}`;
}

type Row = {
  tag_no: string | null;
  species: string | null;
  name: string | null;
  sex: string | null;
  breed: string | null;
  birth_date: string | null;
  age_months: number | null;
  passport: string | null;
};

function parseAnimalsFromText(text: string): Row[] {
  // Keep only the table area lines; drop header paragraphs
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/\s+/g, " "))
    .filter(Boolean);

  const out: Row[] = [];
  // Regex tuned for VIC table rows:
  // idx species tag name sex breed ... date age [passport?]
  const rowRe =
    /^(\d+)\s+(\S+)\s+([A-Z]{2}\d+|LT\d+|DE\d+)\s+(\S+)\s+(\S+)\s+(.+?)\s+(\d{4}[-\.\/]\d{2}[-\.\/]\d{2}|\d{2}[-\.\/]\d{2}[-\.\/]\d{4})\s+(\d+)(?:\s+([A-Z0-9\-\/]+))?$/;

  for (const l of lines) {
    const m = l.match(rowRe);
    if (!m) continue;
    const [, , species, tag, name, sex, breedPlus, date, age, pass] = m;

    // `breedPlus` sometimes contains exactly breed; keep as-is
    const breed = breedPlus;

    out.push({
      tag_no: tag || null,
      species: (species || "").toLowerCase() || null,
      name: name || null,
      sex: sex ? sex.charAt(0).toUpperCase() + sex.slice(1).toLowerCase() : null,
      breed: breed || null,
      birth_date: toISO(date),
      age_months: age ? Number(age) : null,
      passport: pass || null,
    });
  }
  // Defensive de-dup & sanity
  const seen = new Set<string>();
  return out.filter((r) => {
    if (!r.tag_no) return false;
    const key = r.tag_no;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// --- Multipart parsing for Edge-unfriendly bodyParser ----------------------
// In App Router, for multipart we can use native formData() when the request
// is sent as multipart from fetch/XHR, but many tools send big binaries better
// via raw body. To support both, we accept:
// 1) multipart/form-data with "file"
// 2) application/json { url: "https://..." }

export async function POST(req: NextRequest) {
  try {
    let pdfBuffer: Buffer | null = null;

    const ct = req.headers.get("content-type") || "";
    if (ct.includes("multipart/form-data")) {
      // NextRequest.formData() works on App Router (Node runtime)
      const form = await req.formData();
      const file = form.get("file") as unknown as File | null;
      if (!file) return Response.json({ error: "file missing" }, { status: 400 });
      const arrBuf = await file.arrayBuffer();
      pdfBuffer = Buffer.from(arrBuf);
    } else {
      // Expect JSON with { url }
      const body = await req.json().catch(() => ({}));
      if (!body?.url) {
        return Response.json(
          { error: "Provide multipart 'file' or JSON { url }" },
          { status: 400 }
        );
      }
      const res = await fetch(body.url);
      if (!res.ok) return Response.json({ error: "Cannot fetch URL" }, { status: 400 });
      const arrBuf = await res.arrayBuffer();
      pdfBuffer = Buffer.from(arrBuf);
    }

    const parsed = await pdfParse(pdfBuffer!);
    const animals = parseAnimalsFromText(parsed.text);

    return Response.json(
      { count: animals.length, animals },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: any) {
    return Response.json(
      { error: err?.message || "parse_error" },
      { status: 500 }
    );
  }
}

export const runtime = "nodejs"; // (not 'edge') because pdf-parse uses Node APIs
