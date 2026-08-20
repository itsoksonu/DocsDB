// Internet Archive adapter — restricted to texts under Creative Commons or
// public-domain licenses. Docs: https://archive.org/advancedsearch.php
//
// Two steps: (1) advancedsearch for candidate identifiers, then (2) per item,
// the metadata API (https://archive.org/metadata/{id}) to find the REAL PDF
// file. We do NOT guess "download/{id}/{id}.pdf" — that convention only holds
// for a minority of items, so guessing made most downloads 404.
import logger from "../../logger.js";

const USER_AGENT = `DocsDB-Fetcher/1.0 (contact: ${
  process.env.FETCHER_CONTACT_EMAIL || "unknown"
})`;

const SEARCH_URL = "https://archive.org/advancedsearch.php";
const MAX_PDF_BYTES = 50 * 1024 * 1024; // skip oversized scans before downloading

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`archive.org responded ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// Pick the best PDF file from an item's file list. Prefer the canonical
// "Text PDF" derivative; fall back to any *.pdf. Skip oversized files.
function pickPdfFile(files) {
  if (!Array.isArray(files)) return null;
  const pdfs = files.filter(
    (f) => f && (f.format === "Text PDF" || /\.pdf$/i.test(f.name || ""))
  );
  if (pdfs.length === 0) return null;

  const withinSize = pdfs.filter(
    (f) => !f.size || Number(f.size) <= MAX_PDF_BYTES
  );
  const pool = withinSize.length ? withinSize : pdfs;

  // Prefer the explicit "Text PDF" derivative when present.
  return pool.find((f) => f.format === "Text PDF") || pool[0];
}

export async function search(query, maxResults) {
  try {
    // Over-fetch identifiers so items without a usable PDF don't starve the
    // batch (most of the slack is consumed by 404-prone / non-PDF items).
    const rows = Math.min(maxResults * 4, 200);
    const q = `subject:${query} AND mediatype:texts AND (licenseurl:*creativecommons* OR licenseurl:*publicdomain*)`;
    const searchUrl =
      `${SEARCH_URL}?q=${encodeURIComponent(q)}` +
      `&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=year&fl[]=licenseurl` +
      `&rows=${rows}&page=1&output=json`;

    const data = await getJson(searchUrl, 30000);
    const docs = data?.response?.docs || [];
    const out = [];

    for (const doc of docs) {
      if (out.length >= maxResults) break;
      if (!doc.identifier) continue;

      let meta;
      try {
        meta = await getJson(`https://archive.org/metadata/${doc.identifier}`);
      } catch (err) {
        logger.warn(
          `[fetcher:archive] metadata lookup failed for ${doc.identifier}: ${err.message}`
        );
        await sleep(250);
        continue;
      }

      const pdf = pickPdfFile(meta?.files);
      if (!pdf?.name) {
        // No real PDF in this item — skip instead of emitting a doomed download.
        await sleep(250);
        continue;
      }

      const licenseUrl = doc.licenseurl || "";
      const license = /publicdomain/i.test(licenseUrl)
        ? "public domain"
        : licenseUrl
        ? "Creative Commons"
        : "unknown";

      out.push({
        id: doc.identifier,
        title: doc.title || doc.identifier,
        author: Array.isArray(doc.creator)
          ? doc.creator[0]
          : doc.creator || "Unknown",
        year: doc.year || null,
        url: `https://archive.org/download/${doc.identifier}/${encodeURIComponent(
          pdf.name
        )}`,
        format: "pdf",
        license,
      });

      // Be polite to the metadata API between lookups.
      await sleep(250);
    }

    logger.info(
      `[fetcher:archive] resolved ${out.length}/${maxResults} PDFs from ${docs.length} candidates for "${query}"`
    );
    return out;
  } catch (error) {
    logger.error(`[fetcher:archive] search failed: ${error.message}`);
    return [];
  }
}
