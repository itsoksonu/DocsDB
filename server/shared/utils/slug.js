import crypto from "crypto";

const MAX_SLUG_BASE = 80;

/**
 * "Intro to Quantum Physics" -> "intro-to-quantum-physics-a3f9c2"
 *
 * The random suffix is what makes the slug unique. Deriving uniqueness from a
 * suffix rather than from "-2", "-3" retries means generating a slug never
 * needs a read-check-write round trip against the database, and two documents
 * with identical titles can be created concurrently without either failing.
 */
export function generateSlug(title, fallback = "document") {
  const base = slugifyBase(title) || slugifyBase(fallback) || "document";
  const suffix = crypto.randomBytes(3).toString("hex");
  return `${base}-${suffix}`;
}

export function slugifyBase(value) {
  return String(value || "")
    .normalize("NFKD")
    // Strip combining marks so accented titles become readable ASCII.
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_BASE)
    .replace(/-+$/g, "");
}

// A 24-character hex string is a Mongo ObjectId, not a slug. Used to decide
// whether an incoming URL segment should be looked up by slug or by id.
export function looksLikeObjectId(value) {
  return /^[0-9a-f]{24}$/i.test(String(value || ""));
}
