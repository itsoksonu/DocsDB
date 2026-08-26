import axios from "axios";
import { isAllowedS3Url } from "../../lib/s3Allowlist";

// Only real image types may be echoed back. Reflecting the upstream
// Content-Type verbatim meant any URL returning text/html was served as HTML
// from our own origin - stored XSS with same-origin privileges, cached for a
// year by the Cache-Control header below.
const ALLOWED_CONTENT_TYPES = /^image\/(png|jpeg|jpg|gif|webp|avif|svg\+xml)$/;

const MAX_BYTES = 10 * 1024 * 1024;

export default async function handler(req, res) {
  const { url } = req.query;

  if (!url || Array.isArray(url)) {
    return res.status(400).json({ error: "Missing URL" });
  }

  if (!isAllowedS3Url(url)) {
    return res.status(400).json({ error: "Invalid URL" });
  }

  try {
    const response = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 15000,
      // Never follow a redirect out of the allowlist.
      maxRedirects: 0,
      maxContentLength: MAX_BYTES,
      maxBodyLength: MAX_BYTES,
    });

    const contentType = String(response.headers["content-type"] || "")
      .split(";")[0]
      .trim()
      .toLowerCase();

    if (!ALLOWED_CONTENT_TYPES.test(contentType)) {
      return res.status(415).json({ error: "Unsupported content type" });
    }

    // SVG can carry script, so it is served as a download rather than inline.
    res.setHeader(
      "Content-Type",
      contentType === "image/svg+xml" ? "application/octet-stream" : contentType
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.send(response.data);
  } catch (error) {
    console.error("Error proxying image:", error.message);
    res.status(502).json({ error: "Failed to fetch image" });
  }
}
