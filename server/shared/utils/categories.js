import { DOCUMENT_CATEGORIES } from "../models/Document.js";

/**
 * The metadata prompt asks the model to pick a category from a fixed list, and
 * the model does not always comply. Nothing checked the answer, so a category
 * like "computer-science" reached `document.save()`, failed enum validation and
 * threw away the entire processing run - extraction, OCR, AI metadata, the lot.
 *
 * Categories seen in production failures, mapped to the closest real one.
 * Anything unrecognised becomes "other", which is never worse than losing the
 * whole document.
 */
const SYNONYMS = {
  "computer-science": "technology",
  "computer science": "technology",
  computerscience: "technology",
  programming: "technology",
  software: "technology",
  it: "technology",
  ai: "technology",
  "machine-learning": "data-science",
  "data-analysis": "data-science",
  statistics: "mathematics",
  electronics: "engineering",
  electrical: "engineering",
  mechanical: "engineering",
  civil: "engineering",
  "health-medicine": "health",
  medicine: "health",
  medical: "health",
  fitness: "health",
  "home-gardening": "lifestyle",
  gardening: "lifestyle",
  home: "lifestyle",
  cooking: "cooking-food-wine",
  food: "cooking-food-wine",
  general: "other",
  misc: "other",
  miscellaneous: "other",
  unknown: "other",
  uncategorized: "other",
  finance: "finance-money-management",
  money: "finance-money-management",
  economics: "business",
  marketing: "marketing-sales",
  sales: "marketing-sales",
  career: "career-growth",
  biography: "biography-memoir",
  memoir: "biography-memoir",
  religion: "religion-spirituality",
  spirituality: "religion-spirituality",
  environment: "nature-environment",
  nature: "nature-environment",
  news: "news-media",
  media: "news-media",
  kids: "children",
  teen: "young-adult",
  parenting: "parenting-family",
  family: "parenting-family",
  thriller: "thriller-suspense",
  suspense: "thriller-suspense",
  scifi: "science-fiction",
  "sci-fi": "science-fiction",
  literature: "language-arts",
  writing: "language-arts",
  sociology: "social-sciences",
  anthropology: "social-sciences",
  legal: "law",
  math: "mathematics",
  maths: "mathematics",
};

const VALID = new Set(DOCUMENT_CATEGORIES);

export function normalizeCategory(value, fallback = "other") {
  if (!value) return fallback;

  const cleaned = String(value)
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (!cleaned) return fallback;
  if (VALID.has(cleaned)) return cleaned;
  if (SYNONYMS[cleaned] && VALID.has(SYNONYMS[cleaned])) {
    return SYNONYMS[cleaned];
  }

  return fallback;
}

/**
 * Titles and descriptions have maxlength limits and come from the same
 * unpredictable source, so an over-long AI title used to fail validation the
 * same way a bad category did.
 */
export function clampText(value, maxLength) {
  if (value === null || value === undefined) return undefined;

  const text = String(value).trim();
  if (!text) return undefined;
  if (text.length <= maxLength) return text;

  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}
