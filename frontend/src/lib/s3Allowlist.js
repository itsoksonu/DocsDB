// Shared destination allowlist for the server-side proxy routes in pages/api.
//
// Both proxies fetch a URL supplied by the browser from inside our own network,
// so without a pinned destination they are SSRF primitives: an attacker can
// reach cloud metadata endpoints (169.254.169.254), the internal API, or any
// other host the deployment can route to, and read the response body back.
//
// A substring check like `url.includes("amazonaws.com")` is not enough - any
// attacker-controlled URL satisfies it (https://evil.example/?x=amazonaws.com).
// The host has to be parsed and matched.
const ALLOWED_HOST_SUFFIXES = [".amazonaws.com"];

export function isAllowedS3Url(raw) {
  if (!raw || typeof raw !== "string") return false;

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }

  if (parsed.protocol !== "https:") return false;

  const host = parsed.hostname.toLowerCase();
  const bucket =
    process.env.S3_BUCKET_NAME || process.env.NEXT_PUBLIC_S3_BUCKET;

  // Fail closed. If the bucket is not configured we cannot tell our own signed
  // URLs from anyone else's, and "any *.amazonaws.com host" is far too wide.
  if (!bucket) return false;
  if (!host.startsWith(`${bucket.toLowerCase()}.`)) return false;

  return ALLOWED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}
