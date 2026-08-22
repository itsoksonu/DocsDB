import axios from "axios";

// Streaming a PDF through this route is only safe because the destination is
// pinned to our own S3 bucket. The previous check was
// `url.includes("amazonaws.com")`, which any attacker-controlled URL satisfies
// (https://evil.example/?x=amazonaws.com), turning this into an open proxy
// running inside our network.
const ALLOWED_HOST_SUFFIXES = [".amazonaws.com"];

function isAllowedUrl(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }

  if (parsed.protocol !== "https:") return false;

  const host = parsed.hostname.toLowerCase();
  const bucket = process.env.S3_BUCKET_NAME || process.env.NEXT_PUBLIC_S3_BUCKET;

  // When the bucket name is configured, require it - a signed URL for someone
  // else's bucket has no business being proxied by us either.
  if (bucket && !host.startsWith(`${bucket.toLowerCase()}.`)) {
    return false;
  }

  return ALLOWED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

export default async function handler(req, res) {
  const { url } = req.query;

  if (!url || Array.isArray(url)) {
    return res.status(400).json({ error: "Missing URL" });
  }

  if (!isAllowedUrl(url)) {
    return res.status(400).json({ error: "Invalid URL" });
  }

  try {
    // Pass the browser's Range header through to S3. Without this the proxy can
    // only ever answer with the whole file, so pdf.js has to download every byte
    // of a document before it can draw page one - which on a large scanned PDF
    // is indistinguishable from a hang. With it, pdf.js fetches the cross
    // reference table and the first page and renders almost immediately.
    const range = req.headers.range;

    const response = await axios.get(url, {
      responseType: "stream",
      timeout: 60000,
      // Never follow a redirect out of the allowlist.
      maxRedirects: 0,
      headers: range ? { Range: range } : undefined,
      // 206 is the expected answer to a ranged request, so it has to be as
      // acceptable as 200 or every range fetch would throw.
      validateStatus: (status) => status === 200 || status === 206,
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.setHeader("X-Content-Type-Options", "nosniff");

    // Advertising range support and the total size is what makes pdf.js issue
    // ranged requests in the first place; it will not try without them.
    res.setHeader("Accept-Ranges", "bytes");
    for (const header of ["content-length", "content-range"]) {
      const value = response.headers[header];
      if (value) res.setHeader(header, value);
    }

    res.status(response.status);
    response.data.pipe(res);

    response.data.on("error", (error) => {
      console.error("Error streaming PDF:", error.message);
      res.destroy();
    });
  } catch (error) {
    console.error("Error proxying PDF:", error.message);
    res.status(502).json({ error: "Failed to fetch PDF" });
  }
}
