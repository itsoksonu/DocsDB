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
    const response = await axios.get(url, {
      responseType: "stream",
      timeout: 60000,
      // Never follow a redirect out of the allowlist.
      maxRedirects: 0,
      validateStatus: (status) => status === 200,
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.setHeader("X-Content-Type-Options", "nosniff");

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
