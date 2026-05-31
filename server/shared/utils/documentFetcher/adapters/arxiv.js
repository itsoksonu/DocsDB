// arXiv adapter (Atom XML API).
// arXiv articles are freely available; license varies per submission but the
// PDFs are openly distributable. Docs: https://info.arxiv.org/help/api/
import { XMLParser } from "fast-xml-parser";
import logger from "../../logger.js";

const USER_AGENT = `DocsDB-Fetcher/1.0 (contact: ${
  process.env.FETCHER_CONTACT_EMAIL || "unknown"
})`;

const BASE_URL = "http://export.arxiv.org/api/query";

// Map our platform category names to arXiv top-level archive codes so the
// `cat:` query returns relevant results. Anything not mapped falls back to a
// free-text `all:` search on the raw query.
const ARXIV_CATEGORY = {
  science: "physics",
  technology: "cs",
  engineering: "eess",
  mathematics: "math",
  "data-science": "stat",
  economics: "econ",
  finance: "q-fin",
  health: "q-bio",
  psychology: "q-bio",
};

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

export async function search(query, maxResults) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const archive = ARXIV_CATEGORY[query];
    const searchQuery = archive
      ? `cat:${archive}.*`
      : `all:${query}`;

    const url = `${BASE_URL}?search_query=${encodeURIComponent(
      searchQuery
    )}&start=0&max_results=${maxResults}&sortBy=submittedDate&sortOrder=descending`;

    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`arXiv responded ${res.status}`);
    }

    const xml = await res.text();
    const parsed = parser.parse(xml);

    let entries = parsed?.feed?.entry || [];
    if (!Array.isArray(entries)) entries = [entries];

    const out = [];
    for (const entry of entries) {
      if (!entry) continue;
      if (out.length >= maxResults) break;

      // The PDF link has title="pdf" (or type application/pdf).
      let links = entry.link || [];
      if (!Array.isArray(links)) links = [links];
      const pdfLink = links.find(
        (l) => l?.["@_title"] === "pdf" || l?.["@_type"] === "application/pdf"
      );
      if (!pdfLink?.["@_href"]) continue;

      let authors = entry.author || [];
      if (!Array.isArray(authors)) authors = [authors];
      const author = authors[0]?.name || "Unknown";

      const published = entry.published || "";
      const year = published ? published.slice(0, 4) : null;

      // arXiv id looks like http://arxiv.org/abs/2401.01234v1 -> 2401.01234
      const rawId = entry.id || pdfLink["@_href"];
      const id = rawId.replace(/^https?:\/\/arxiv\.org\/(abs|pdf)\//, "").replace(/v\d+$/, "");

      out.push({
        id,
        title: (entry.title || "Untitled").replace(/\s+/g, " ").trim(),
        author,
        year,
        // Ensure a .pdf extension so the downloader picks the right type.
        url: pdfLink["@_href"].endsWith(".pdf")
          ? pdfLink["@_href"]
          : `${pdfLink["@_href"]}.pdf`,
        format: "pdf",
        license: "arXiv (open access)",
      });
    }

    return out;
  } catch (error) {
    logger.error(`[fetcher:arxiv] search failed: ${error.message}`);
    return [];
  } finally {
    clearTimeout(timeout);
  }
}
