// OpenStax adapter — a curated, hardcoded list of openly-licensed (CC BY)
// textbooks. No HTTP search is performed.
//
// The `url` for each entry must be a direct PDF download link. OpenStax hosts
// these on its CDN (assets.openstax.org); those asset URLs are occasionally
// re-published, so if a download starts failing, refresh the URL from the
// book's page at https://openstax.org/subjects (see README: "Adding an
// OpenStax book").
//
// Each book is tagged with one or more platform category names in `subjects`
// so that a category-routed search returns only the relevant titles.
import logger from "../../logger.js";

const BOOKS = [
  {
    id: "openstax-biology-2e",
    title: "Biology 2e",
    author: "OpenStax",
    year: "2018",
    url: "https://assets.openstax.org/oscms-prodcms/media/documents/Biology2e-WEB.pdf",
    subjects: ["science", "education", "health"],
  },
  {
    id: "openstax-chemistry-2e",
    title: "Chemistry 2e",
    author: "OpenStax",
    year: "2019",
    url: "https://assets.openstax.org/oscms-prodcms/media/documents/Chemistry2e-WEB.pdf",
    subjects: ["science", "education"],
  },
  {
    id: "openstax-university-physics-v1",
    title: "University Physics Volume 1",
    author: "OpenStax",
    year: "2016",
    url: "https://assets.openstax.org/oscms-prodcms/media/documents/UniversityPhysicsVolume1-WEB.pdf",
    subjects: ["science", "education", "engineering"],
  },
  {
    id: "openstax-university-physics-v2",
    title: "University Physics Volume 2",
    author: "OpenStax",
    year: "2016",
    url: "https://assets.openstax.org/oscms-prodcms/media/documents/UniversityPhysicsVolume2-WEB.pdf",
    subjects: ["science", "education", "engineering"],
  },
  {
    id: "openstax-university-physics-v3",
    title: "University Physics Volume 3",
    author: "OpenStax",
    year: "2016",
    url: "https://assets.openstax.org/oscms-prodcms/media/documents/UniversityPhysicsVolume3-WEB.pdf",
    subjects: ["science", "education", "engineering"],
  },
  {
    id: "openstax-calculus-v1",
    title: "Calculus Volume 1",
    author: "OpenStax",
    year: "2016",
    url: "https://assets.openstax.org/oscms-prodcms/media/documents/CalculusVolume1-WEB.pdf",
    subjects: ["mathematics", "education"],
  },
  {
    id: "openstax-calculus-v2",
    title: "Calculus Volume 2",
    author: "OpenStax",
    year: "2016",
    url: "https://assets.openstax.org/oscms-prodcms/media/documents/CalculusVolume2-WEB.pdf",
    subjects: ["mathematics", "education"],
  },
  {
    id: "openstax-calculus-v3",
    title: "Calculus Volume 3",
    author: "OpenStax",
    year: "2016",
    url: "https://assets.openstax.org/oscms-prodcms/media/documents/CalculusVolume3-WEB.pdf",
    subjects: ["mathematics", "education"],
  },
  {
    id: "openstax-intro-sociology-3e",
    title: "Introduction to Sociology 3e",
    author: "OpenStax",
    year: "2021",
    url: "https://assets.openstax.org/oscms-prodcms/media/documents/IntroductionToSociology3e-WEB.pdf",
    subjects: ["social-sciences", "education"],
  },
  {
    id: "openstax-macroeconomics-3e",
    title: "Principles of Macroeconomics 3e",
    author: "OpenStax",
    year: "2022",
    url: "https://assets.openstax.org/oscms-prodcms/media/documents/PrinciplesofMacroeconomics3e-WEB.pdf",
    subjects: ["economics", "business", "education"],
  },
  {
    id: "openstax-microeconomics-3e",
    title: "Principles of Microeconomics 3e",
    author: "OpenStax",
    year: "2022",
    url: "https://assets.openstax.org/oscms-prodcms/media/documents/PrinciplesofMicroeconomics3e-WEB.pdf",
    subjects: ["economics", "business", "education"],
  },
  {
    id: "openstax-us-history",
    title: "U.S. History",
    author: "OpenStax",
    year: "2014",
    url: "https://assets.openstax.org/oscms-prodcms/media/documents/USHistory-WEB.pdf",
    subjects: ["history", "education"],
  },
  {
    id: "openstax-psychology-2e",
    title: "Psychology 2e",
    author: "OpenStax",
    year: "2020",
    url: "https://assets.openstax.org/oscms-prodcms/media/documents/Psychology2e-WEB.pdf",
    subjects: ["psychology", "social-sciences", "education"],
  },
  {
    id: "openstax-intro-business-statistics",
    title: "Introductory Business Statistics",
    author: "OpenStax",
    year: "2018",
    url: "https://assets.openstax.org/oscms-prodcms/media/documents/IntroductoryBusinessStatistics-WEB.pdf",
    subjects: ["business", "mathematics", "data-science", "education"],
  },
];

/**
 * Returns curated OpenStax books. If `query` (a platform category) matches a
 * book's subject tags, only matching books are returned; otherwise the full
 * curated list is returned. Capped at `maxResults`.
 */
export async function search(query, maxResults) {
  try {
    const matches = BOOKS.filter((b) => b.subjects.includes(query));
    const pool = matches.length > 0 ? matches : BOOKS;

    return pool.slice(0, maxResults).map((b) => ({
      id: b.id,
      title: b.title,
      author: b.author,
      year: b.year,
      url: b.url,
      format: "pdf",
      license: "CC BY 4.0",
    }));
  } catch (error) {
    logger.error(`[fetcher:openstax] search failed: ${error.message}`);
    return [];
  }
}
