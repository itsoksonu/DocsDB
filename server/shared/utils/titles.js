/**
 * Title selection for the local metadata fallback.
 *
 * Lives apart from documentProcessor so it can be reasoned about and tested
 * without loading Tesseract, pdf.js and three AI SDKs.
 *
 * This matters more than it looks: the title becomes the permanent URL slug, so
 * a bad pick is not cosmetic. With every AI provider down, the old heuristic
 * took the first line of an OCR'd scan with 2-12 words and produced the title
 * "Website: [www.easymcgs.com](https://www.easymcgs.com) , E-mail: …".
 */

// The top of a scanned page is usually a watermark, a site banner or a contact
// block - never the title.
const TITLE_REJECT_PATTERNS = [
  /https?:\/\//i,
  /www\./i,
  /\S+@\S+\.\S+/, // email address
  /^\s*(page|chapter|section)\b/i,
  /\d{1,2}\/\d{1,2}\/\d{2,4}/, // dates
  /^\s*[\d\s.,:;|/\\-]+\s*$/, // digits and punctuation only
  /(copyright|all rights reserved|confidential|scanned by|downloaded from)/i,
  /^\s*(table of contents|contents|index|abstract|introduction)\s*$/i,
  /\bE-?mail\b/i,
  /\b(tel|phone|mobile|contact us)\b\s*[:.]?/i,
];

/**
 * Strips the delimiter debris a spreadsheet header drags along. A CSV first row
 * arrives as "Sales Summary By Customer-Product/Category,,,,,,,,,,,,,,,," and
 * that whole string became a title, and then a slug.
 */
export function tidyTitle(line) {
  return String(line || "")
    .trim()
    // Runs of separators anywhere: ",,,," or " | | | " or "\t\t".
    .replace(/([,;|\t])\s*(?=\1)/g, "")
    .replace(/[\s,;|\t]*[,;|\t][\s,;|\t]*$/g, "")
    .replace(/^[\s,;|\t]+/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function isUsableTitle(line) {
  const trimmed = tidyTitle(line);

  if (trimmed.length < 4 || trimmed.length > 200) return false;

  // Mostly separators with a few words wedged in is a table row, not a title.
  const separators = (trimmed.match(/[,;|\t]/g) || []).length;
  if (separators > 0 && separators >= trimmed.split(/\s+/).length) return false;
  if (TITLE_REJECT_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return false;
  }

  // Needs enough letters to be words rather than a scan artefact.
  const letters = (trimmed.match(/[a-z]/gi) || []).length;
  if (letters < trimmed.length * 0.5) return false;

  const words = trimmed.split(/\s+/);
  return words.length >= 2 && words.length <= 20;
}

export function cleanFilenameTitle(filename) {
  const base = String(filename || "")
    .replace(/\.[^/.]+$/, "")
    .replace(/[-_]+/g, " ")
    // Strip the uuid/timestamp noise the upload path adds to keys.
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      ""
    )
    .replace(/\b\d{10,}\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return base || "Untitled Document";
}

export function generateUniversalTitle(content, filename, fileType) {
  const fallback = cleanFilenameTitle(filename);
  const text = String(content || "");

  if (fileType === "pdf" || fileType === "docx") {
    const candidate = text
      .split("\n")
      .slice(0, 15)
      .map((line) => line.trim())
      .find(isUsableTitle);
    if (candidate) return tidyTitle(candidate).substring(0, 120);
  }

  const titleCandidates = text
    .split("\n")
    .map((line) => line.trim())
    .filter(isUsableTitle)
    .map((line) => {
      const words = line.split(/\s+/);
      const capitalRatio =
        words.filter((word) => word[0] === word[0].toUpperCase()).length /
        words.length;
      return { line, score: capitalRatio };
    })
    .filter((candidate) => candidate.score > 0.6)
    .sort((a, b) => b.score - a.score);

  if (titleCandidates.length > 0) {
    return tidyTitle(titleCandidates[0].line).substring(0, 120);
  }

  const firstMeaningful = text
    .split(/[.!?]+/)
    .map((sentence) => sentence.trim())
    .find((sentence) => sentence.length > 15 && isUsableTitle(sentence));

  // Falling back to the filename is not a great title, but it is honest and it
  // makes a sane slug. Junk scraped off a scan is neither.
  return firstMeaningful ? tidyTitle(firstMeaningful).substring(0, 120) : fallback;
}
