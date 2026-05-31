// Project Gutenberg adapter (via the Gutendex API).
// All Project Gutenberg texts are in the public domain.
// Docs: https://gutendex.com/
import logger from "../../logger.js";

const USER_AGENT = `DocsDB-Fetcher/1.0 (contact: ${
  process.env.FETCHER_CONTACT_EMAIL || "unknown"
})`;

// Gutendex exposes a `topic` filter that matches against subjects + bookshelves.
const BASE_URL = "https://gutendex.com/books/";

/**
 * @param {string} query    topic keyword (a platform category name)
 * @param {number} maxResults
 * @returns {Promise<Array<{id,title,author,year,url,format,license}>>}
 */
export async function search(query, maxResults) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const url = `${BASE_URL}?topic=${encodeURIComponent(
      query
    )}&mime_type=application%2Fpdf`;

    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`Gutendex responded ${res.status}`);
    }

    const data = await res.json();
    const books = Array.isArray(data?.results) ? data.results : [];
    const out = [];

    for (const book of books) {
      if (out.length >= maxResults) break;

      // Find a PDF download link among the available formats.
      const formats = book.formats || {};
      const pdfKey = Object.keys(formats).find((k) =>
        k.toLowerCase().startsWith("application/pdf")
      );
      if (!pdfKey) continue;

      const author = book.authors?.[0]?.name || "Unknown";
      const year = book.authors?.[0]?.death_year || null;

      out.push({
        id: String(book.id),
        title: book.title || "Untitled",
        author,
        year,
        url: formats[pdfKey],
        format: "pdf",
        license: "public domain",
      });
    }

    return out;
  } catch (error) {
    logger.error(`[fetcher:gutenberg] search failed: ${error.message}`);
    return [];
  } finally {
    clearTimeout(timeout);
  }
}
