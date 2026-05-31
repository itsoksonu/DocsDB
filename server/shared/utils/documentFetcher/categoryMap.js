// Routing table: each platform `category` (from the Document schema enum) maps
// to an ordered list of source adapters to try, most-relevant first.
//
// Any category not present here falls back to ["archive"] (see
// resolveAdapters), since the Internet Archive has the broadest coverage.
//
// Valid adapter names: "gutenberg", "arxiv", "pubmed", "archive", "openstax".
export const categoryMap = {
  // Literature & general reading — public-domain books dominate.
  fiction: ["gutenberg", "archive"],
  "non-fiction": ["gutenberg", "archive"],
  "science-fiction": ["gutenberg", "archive"],
  fantasy: ["gutenberg", "archive"],
  romance: ["gutenberg", "archive"],
  "thriller-suspense": ["gutenberg", "archive"],
  horror: ["gutenberg", "archive"],
  poetry: ["gutenberg", "archive"],
  "graphic-novels": ["archive"],
  comics: ["archive"],
  "young-adult": ["gutenberg", "archive"],
  children: ["gutenberg", "archive"],
  "true-crime": ["gutenberg", "archive"],
  erotica: ["gutenberg", "archive"],
  "sheet-music": ["archive"],

  // Academic & research — preprints + open-access journals.
  science: ["arxiv", "pubmed", "archive"],
  technology: ["arxiv", "archive"],
  engineering: ["arxiv", "archive"],
  mathematics: ["arxiv", "openstax", "archive"],
  "data-science": ["arxiv", "archive"],
  health: ["pubmed", "arxiv", "archive"],
  psychology: ["openstax", "pubmed", "archive"],
  "social-sciences": ["openstax", "archive"],
  "nature-environment": ["arxiv", "pubmed", "archive"],

  // Education & reference — curated textbooks first.
  education: ["openstax", "gutenberg", "archive"],
  "study-aids-test-prep": ["openstax", "archive"],
  reference: ["gutenberg", "archive"],
  "language-arts": ["gutenberg", "archive"],

  // Humanities.
  history: ["gutenberg", "archive"],
  philosophy: ["gutenberg", "archive"],
  "religion-spirituality": ["gutenberg", "archive"],
  art: ["archive", "gutenberg"],
  law: ["archive", "gutenberg"],
  politics: ["gutenberg", "archive"],
  "biography-memoir": ["gutenberg", "archive"],

  // Business & professional.
  business: ["openstax", "archive"],
  economics: ["openstax", "arxiv", "archive"],
  "finance-money-management": ["archive", "arxiv"],
  "marketing-sales": ["archive"],
  "career-growth": ["archive"],
  "professional-development": ["archive"],
  design: ["archive"],

  // Lifestyle & general interest.
  lifestyle: ["archive", "gutenberg"],
  "self-improvement": ["gutenberg", "archive"],
  "cooking-food-wine": ["gutenberg", "archive"],
  travel: ["gutenberg", "archive"],
  "parenting-family": ["archive", "gutenberg"],
  entertainment: ["archive"],
  sports: ["archive"],
  "games-activities": ["archive"],
  "news-media": ["archive"],

  // Aggregate / catch-all buckets.
  "for-you": ["archive"],
  other: ["archive"],
};

const DEFAULT_ADAPTERS = ["archive"];

/**
 * Returns the ordered adapter list for a category, falling back to ["archive"].
 * @param {string} category
 * @returns {string[]}
 */
export function resolveAdapters(category) {
  return categoryMap[category] || DEFAULT_ADAPTERS;
}
