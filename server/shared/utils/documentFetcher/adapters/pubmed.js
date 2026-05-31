// PubMed Central (PMC) adapter — NCBI E-utilities, open-access subset only.
// Two-step: esearch (get PMC ids) -> esummary (get metadata).
// Docs: https://www.ncbi.nlm.nih.gov/books/NBK25501/
import logger from "../../logger.js";

const USER_AGENT = `DocsDB-Fetcher/1.0 (contact: ${
  process.env.FETCHER_CONTACT_EMAIL || "unknown"
})`;

const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

// NCBI asks for no more than 3 requests/second without an API key. We make two
// sequential calls here, so a small gap between them keeps us well within that.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, signal) {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal,
  });
  if (!res.ok) throw new Error(`NCBI responded ${res.status}`);
  return res.json();
}

export async function search(query, maxResults) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const term = `${query} AND open access[filter]`;
    const esearchUrl = `${EUTILS}/esearch.fcgi?db=pmc&term=${encodeURIComponent(
      term
    )}&retmax=${maxResults}&retmode=json`;

    const esearch = await getJson(esearchUrl, controller.signal);
    const ids = esearch?.esearchresult?.idlist || [];
    if (ids.length === 0) return [];

    await sleep(400);

    const esummaryUrl = `${EUTILS}/esummary.fcgi?db=pmc&id=${ids.join(
      ","
    )}&retmode=json`;
    const esummary = await getJson(esummaryUrl, controller.signal);

    const result = esummary?.result || {};
    const out = [];

    for (const id of ids) {
      if (out.length >= maxResults) break;
      const item = result[id];
      if (!item) continue;

      const author = item.authors?.[0]?.name || "Unknown";
      const year = item.pubdate ? String(item.pubdate).slice(0, 4) : null;

      out.push({
        id: `PMC${id}`,
        title: item.title || "Untitled",
        author,
        year,
        url: `https://www.ncbi.nlm.nih.gov/pmc/articles/PMC${id}/pdf/`,
        format: "pdf",
        license: "open access",
      });
    }

    return out;
  } catch (error) {
    logger.error(`[fetcher:pubmed] search failed: ${error.message}`);
    return [];
  } finally {
    clearTimeout(timeout);
  }
}
