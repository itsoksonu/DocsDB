// Internet Archive adapter — restricted to texts under Creative Commons or
// public-domain licenses. Docs: https://archive.org/advancedsearch.php
import logger from "../../logger.js";

const USER_AGENT = `DocsDB-Fetcher/1.0 (contact: ${
  process.env.FETCHER_CONTACT_EMAIL || "unknown"
})`;

const BASE_URL = "https://archive.org/advancedsearch.php";

export async function search(query, maxResults) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const q = `subject:${query} AND mediatype:texts AND (licenseurl:*creativecommons* OR licenseurl:*publicdomain*)`;
    const url =
      `${BASE_URL}?q=${encodeURIComponent(q)}` +
      `&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=year&fl[]=licenseurl` +
      `&rows=${maxResults}&page=1&output=json`;

    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`archive.org responded ${res.status}`);
    }

    const data = await res.json();
    const docs = data?.response?.docs || [];
    const out = [];

    for (const doc of docs) {
      if (out.length >= maxResults) break;
      if (!doc.identifier) continue;

      const author = Array.isArray(doc.creator)
        ? doc.creator[0]
        : doc.creator || "Unknown";

      const licenseUrl = doc.licenseurl || "";
      const license = /publicdomain/i.test(licenseUrl)
        ? "public domain"
        : licenseUrl
        ? "Creative Commons"
        : "unknown";

      out.push({
        id: doc.identifier,
        title: doc.title || doc.identifier,
        author,
        year: doc.year || null,
        url: `https://archive.org/download/${doc.identifier}/${doc.identifier}.pdf`,
        format: "pdf",
        license,
      });
    }

    return out;
  } catch (error) {
    logger.error(`[fetcher:archive] search failed: ${error.message}`);
    return [];
  } finally {
    clearTimeout(timeout);
  }
}
