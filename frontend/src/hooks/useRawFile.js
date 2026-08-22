import { useEffect, useState } from "react";

/**
 * Fetches the original file bytes so the viewer can render the real document
 * rather than a text extraction of it.
 *
 * This is what makes DOCX keep its fonts and page breaks, PPTX keep its theme
 * and backgrounds, and XLSX keep its cell formatting - all of which are thrown
 * away by the server-side text extraction in documentPreview.js. That path is
 * still there as a fallback for when this fetch cannot work.
 *
 * Requires a CORS policy on the S3 bucket allowing GET from the site origin.
 * See docs/s3-cors.md.
 */

// Parsing happens on the main thread, so a very large workbook or deck would
// lock up a phone for tens of seconds. Past this we hand back to the server's
// lightweight text preview instead of freezing the tab.
export const MAX_CLIENT_PARSE_BYTES = 25 * 1024 * 1024;

export function useRawFile(url, sizeBytes) {
  const [buffer, setBuffer] = useState(null);
  const [loading, setLoading] = useState(Boolean(url));
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!url) {
      setLoading(false);
      return undefined;
    }

    if (sizeBytes && sizeBytes > MAX_CLIENT_PARSE_BYTES) {
      setBuffer(null);
      setError(new Error("File is too large to render in the browser"));
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    const controller = new AbortController();

    setLoading(true);
    setError(null);
    setBuffer(null);

    fetch(url, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Fetching the file failed (${response.status})`);
        }
        return response.arrayBuffer();
      })
      .then((bytes) => {
        if (!cancelled) setBuffer(bytes);
      })
      .catch((fetchError) => {
        // An abort is our own cleanup, not a failure worth reporting.
        if (!cancelled && fetchError.name !== "AbortError") {
          setError(fetchError);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [url, sizeBytes]);

  return { buffer, loading, error };
}
