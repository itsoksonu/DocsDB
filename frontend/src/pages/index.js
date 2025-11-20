import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import { useAuth } from "../contexts/AuthContext";
import { useModal } from "../hooks/useModal";
import { DesktopNavbar } from "../components/layout/DesktopNavbar";
import { SearchBar } from "../components/ui/SearchBar";
import { DocumentCard } from "../components/common/DocumentCard";
import { DocumentSkeleton } from "../components/ui/Skeleton";
import { apiService } from "../services/api";
import toast from "react-hot-toast";
import Link from "next/link";
import Footer from "../components/layout/Footer";

export default function Home() {
  const { user } = useAuth();
  const { openModal } = useModal();
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState("for-you");

  const router = useRouter();

  const categories = [
    { id: "for-you", name: "For You" },
    { id: "technology", name: "Technology" },
    { id: "business", name: "Business" },
    { id: "education", name: "Education" },
    { id: "health", name: "Health" },
    { id: "entertainment", name: "Entertainment" },
    { id: "sports", name: "Sports" },
    { id: "finance-money-management", name: "Finance and Money Management" },
    { id: "games-activities", name: "Games and Activities" },
    { id: "comics", name: "Comics" },
    { id: "philosophy", name: "Philosophy" },
    { id: "career-growth", name: "Career and Professional Growth" },
    { id: "politics", name: "Politics" },
    { id: "biography-memoir", name: "Biography and Memoir" },
    { id: "study-aids-test-prep", name: "Study Aids and Test Preparation" },
    { id: "law", name: "Law" },
    { id: "art", name: "Art" },
    { id: "science", name: "Science" },
    { id: "history", name: "History" },
    { id: "erotica", name: "Erotica" },
    { id: "lifestyle", name: "Lifestyle" },
    { id: "religion-spirituality", name: "Religion and Spirituality" },
    { id: "self-improvement", name: "Self-Improvement and Personal Growth" },
    { id: "language-arts", name: "Language Arts" },
    { id: "cooking-food-wine", name: "Cooking, Food, and Wine" },
    { id: "true-crime", name: "True Crime" },
    { id: "sheet-music", name: "Sheet Music" },
    { id: "fiction", name: "Fiction" },
    { id: "non-fiction", name: "Non-Fiction" },
    { id: "science-fiction", name: "Science Fiction" },
    { id: "fantasy", name: "Fantasy" },
    { id: "romance", name: "Romance" },
    { id: "thriller-suspense", name: "Thriller and Suspense" },
    { id: "horror", name: "Horror" },
    { id: "poetry", name: "Poetry" },
    { id: "graphic-novels", name: "Graphic Novels" },
    { id: "young-adult", name: "Young Adult" },
    { id: "children", name: "Children" },
    { id: "parenting-family", name: "Parenting and Family" },
    { id: "marketing-sales", name: "Marketing and Sales" },
    { id: "psychology", name: "Psychology" },
    { id: "social-sciences", name: "Social Sciences" },
    { id: "engineering", name: "Engineering" },
    { id: "mathematics", name: "Mathematics" },
    { id: "data-science", name: "Data Science" },
    { id: "news-media", name: "News & Media" },
    { id: "nature-environment", name: "Nature and Environment" },
    { id: "travel", name: "Travel" },
    { id: "reference", name: "Reference" },
    { id: "design", name: "Design" },
    { id: "professional-development", name: "Professional Development" },
    { id: "other", name: "Other" },
  ];

  const loadDocuments = async () => {
    const storageKey = `docs_cache_${selectedCategory}`;

    try {
      const cachedData = sessionStorage.getItem(storageKey);

      if(cachedData) {
        const parsedData = JSON.parse(cachedData);
        setDocuments(parsedData);
        setLoading(false);
      } else {
        setLoading(true);
      }

      const params = {
        limit: 42, 
        category: selectedCategory === "for-you" ? null : selectedCategory,
        sort: selectedCategory === "for-you" ? "relevant" : "newest",
      };

      const response = await apiService.getFeed(params);
      const { documents: newDocs } = response.data;

      if (JSON.stringify(newDocs) !== cachedData) {
        setDocuments(newDocs);
        sessionStorage.setItem(storageKey, JSON.stringify(newDocs));
      }

    } catch (error) {
      const currentCache = sessionStorage.getItem(storageKey);
      if (!currentCache) {
        toast.error("Failed to load documents");
      } else {
        console.warn("Background fetch failed, using cached data");
      }
      
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDocuments();
  }, [selectedCategory]);

  const handleSearch = (query) => {
    const trimmed = query.trim();
    if (trimmed && trimmed !== router.query.q) {
      router.push(`/search?q=${encodeURIComponent(trimmed)}`);
    }
  };

  const handleUploadClick = () => {
    if (!user) {
      openModal("auth_modal");
    } else {
      router.push("/upload");
    }
  };

  return (
    <>
      <Head>
        <title>DocsDB - Discover & Share Knowledge</title>
        <meta
          name="description"
          content="DocsDB is a platform for discovering, sharing, and organizing documents and knowledge resources."
        />
        <meta
          name="keywords"
          content="documents, knowledge, sharing, research, pdf, docs"
        />
        <meta
          property="og:title"
          content="DocsDB - Discover & Share Knowledge"
        />
        <meta
          property="og:description"
          content="Platform for discovering and sharing knowledge documents"
        />
        <meta property="og:type" content="website" />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="true"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </Head>

      <div className="min-h-screen bg-dark-950 text-white">
        {/* Desktop Navbar */}
        <DesktopNavbar
          onSearch={handleSearch}
          onUploadClick={handleUploadClick}
        />

        {/* Hero Section */}
        <section className="pt-32 px-6">
          <div className="max-w-4xl mx-auto text-center">
            <h1 className="font-literature text-3xl md:text-5xl font-bold mb-6 bg-gradient-to-br from-white to-gray-300 bg-clip-text">
              Find the required document.
            </h1>
            <p className="text-base md:text-xl text-dark-300 mb-12 max-w-2xl mx-auto leading-relaxed">
              Explore millions of documents, research papers, and resources.
              Share your knowledge with the world.
            </p>

            {/* Search Bar */}
            <div className="max-w-2xl mx-auto mb-16">
              <SearchBar
                onSearch={handleSearch}
                placeholder="Search documents, research, topics..."
                className="w-full"
                autoFocus={false}
              />
            </div>
          </div>
        </section>

        {/* Categories Slider */}
        <div className="flex items-center gap-2 max-w-6xl mx-auto text-center pb-10 px-2">
          {/* Left Arrow */}
          <button
            onClick={() => {
              const container = document.getElementById("categories-slider");
              if (container) {
                container.scrollBy({ left: -200, behavior: "smooth" });
              }
            }}
            className="flex-shrink-0 w-8 h-8 flex items-center justify-center bg-dark-800 hover:bg-dark-700 text-white rounded-full border border-dark-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            id="scroll-left-btn"
            aria-label="Scroll left"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>

          {/* Categories */}
          <div
            id="categories-slider"
            className="overflow-x-auto scrollbar-hide flex-1"
            style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
            onScroll={(e) => {
              const container = e.currentTarget;
              const leftBtn = document.getElementById("scroll-left-btn");
              const rightBtn = document.getElementById("scroll-right-btn");

              if (leftBtn) {
                leftBtn.disabled = container.scrollLeft <= 0;
              }

              if (rightBtn) {
                const isAtEnd =
                  Math.abs(
                    container.scrollWidth -
                      container.clientWidth -
                      container.scrollLeft
                  ) < 1;
                rightBtn.disabled = isAtEnd;
              }
            }}
          >
            <style jsx>{`
              .scrollbar-hide::-webkit-scrollbar {
                display: none;
              }
            `}</style>
            <div className="flex gap-2 min-w-max">
              {categories.map((category) => (
                <button
                  key={category.id}
                  onClick={() => setSelectedCategory(category.id)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-300 whitespace-nowrap ${
                    selectedCategory === category.id
                      ? "bg-white text-dark-900 shadow-lg"
                      : "bg-dark-800 text-dark-300 hover:bg-dark-700 hover:text-white border border-dark-600"
                  }`}
                >
                  {category.name}
                </button>
              ))}
            </div>
          </div>

          {/* Right Arrow */}
          <button
            onClick={() => {
              const container = document.getElementById("categories-slider");
              if (container) {
                container.scrollBy({ left: 200, behavior: "smooth" });
              }
            }}
            className="flex-shrink-0 w-8 h-8 flex items-center justify-center bg-dark-800 hover:bg-dark-700 text-white rounded-full border border-dark-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            id="scroll-right-btn"
            aria-label="Scroll right"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5l7 7-7 7"
              />
            </svg>
          </button>
        </div>

        {/* Documents Grid */}
        <section className="max-w-7xl mx-auto px-2 pb-8">
          {loading ? (
            <div className="flex flex-wrap gap-6 justify-center">
              {Array.from({ length: 21 }).map((_, i) => (
                <DocumentSkeleton key={i} />
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap gap-6 justify-center">
              {documents.map((doc, index) => (
                <div key={doc._id}>
                  <DocumentCard document={doc} />
                </div>
              ))}
            </div>
          )}

          {documents.length === 0 && !loading && (
            <div className="text-center py-20">
              <p className="text-dark-400 text-lg">No documents found</p>
            </div>
          )}
        </section>

        {/* Explore All Documents Section with Gradient Background */}
        <section className="relative bg-gradient-to-t from-dark-950 via-dark-950/80 to-transparent -mt-48 pt-20 pb-16">
          <div className="max-w-7xl mx-auto px-2 text-center">
            <div className="flex justify-center">
              <Link
                href="/explore"
                className="inline-flex items-center gap-2 px-6 py-3 bg-dark-800/80 backdrop-blur-md rounded-full border border-dark-600 hover:bg-dark-700/80 transition-all duration-300"
              >
                <svg
                  className="w-5 h-5 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
                <span className="text-white font-semibold text-sm">
                  Explore 1M+ Documents
                </span>
                <svg
                  className="w-5 h-5 ml-2"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M17 8l4 4m0 0l-4 4m4-4H3"
                  />
                </svg>
              </Link>
            </div>
          </div>
        </section>

        {/* Main tagline */}
        <section className="py-16 bg-dark-950">
          <div className="max-w-4xl mx-auto px-6 text-center">
            <p className="text-sm text-dark-400 uppercase tracking-wider mb-4">
              IT'S A DOCUMENT REPOSITORY, BUT BETTER
            </p>
            <h2
              className="text-4xl md:text-5xl lg:text-6xl font-bold mb-6 text-white"
              style={{ fontFamily: "serif" }}
            >
              The DocsDB difference
            </h2>
            <p className="text-lg text-dark-200 mb-8 leading-relaxed">
              DocsDB is different because we combine the comprehensive
              collection of a digital library with the intuitive discovery of
              modern platforms. Your required document is just a few clicks away.
            </p>
          </div>

          <div className="max-w-6xl mx-auto px-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="text-center p-6">
                <div className="w-16 h-16 mx-auto mb-4 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center">
                  <svg
                    className="w-8 h-8 text-white"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                    />
                  </svg>
                </div>
                <h3 className="text-xl font-semibold mb-4">Advanced Search</h3>
                <p className="text-dark-300">
                  Powerful search capabilities with filters, categories, and
                  AI-powered recommendations.
                </p>
              </div>

              <div className="text-center p-6">
                <div className="w-16 h-16 mx-auto mb-4 bg-gradient-to-br from-green-500 to-teal-600 rounded-xl flex items-center justify-center">
                  <svg
                    className="w-8 h-8 text-white"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                    />
                  </svg>
                </div>
                <h3 className="text-xl font-semibold mb-4">Verified Content</h3>
                <p className="text-dark-300">
                  All documents are verified for quality and authenticity by our
                  expert team.
                </p>
              </div>

              <div className="text-center p-6">
                <div className="w-16 h-16 mx-auto mb-4 bg-gradient-to-br from-orange-500 to-red-600 rounded-xl flex items-center justify-center">
                  <svg
                    className="w-8 h-8 text-white"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13 10V3L4 14h7v7l9-11h-7z"
                    />
                  </svg>
                </div>
                <h3 className="text-xl font-semibold mb-4">Fast Access</h3>
                <p className="text-dark-300">
                  Instant access to millions of documents with our optimized
                  delivery system.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Footer Section */}
        <Footer />
      </div>
    </>
  );
}