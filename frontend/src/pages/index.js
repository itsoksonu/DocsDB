// src/pages/index.jsx
import { useState, useEffect, useRef, useCallback } from "react";
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

export default function Home() {
  const { user } = useAuth();
  const { openModal } = useModal();
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [cursor, setCursor] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState("for-you");
  const [searchQuery, setSearchQuery] = useState("");
  const observer = useRef();

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
    { id: "data-science", name: "Data Science"},
    { id: "news-media", name: "News & Media"},
    { id: "nature-environment", name: "Nature and Environment" },
    { id: "travel", name: "Travel" },
    { id: "reference", name: "Reference" },
    { id: "design", name: "Design" },
    { id: "professional-development", name: "Professional Development" },

    { id: "other", name: "Other" },
  ];

  const loadDocuments = useCallback(
    async (reset = false) => {
      try {
        if (reset) {
          setLoading(true);
          setCursor(null);
        } else {
          setLoadingMore(true);
        }

        const params = {
          limit: 20,
          cursor: reset ? null : cursor,
          category: selectedCategory === "for-you" ? null : selectedCategory,
          sort: selectedCategory === "for-you" ? "relevant" : "newest",
        };

        const response = await apiService.getFeed(params);
        const { documents: newDocs, pagination } = response.data;

        if (reset) {
          setDocuments(newDocs);
        } else {
          setDocuments((prev) => [...prev, ...newDocs]);
        }

        setCursor(pagination.nextCursor);
        setHasMore(pagination.hasMore);
      } catch (error) {
        toast.error("Failed to load documents");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [cursor, selectedCategory]
  );

  const lastDocumentRef = useCallback(
    (node) => {
      if (loadingMore) return;
      if (observer.current) observer.current.disconnect();

      observer.current = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && hasMore) {
          loadDocuments();
        }
      });

      if (node) observer.current.observe(node);
    },
    [loadingMore, hasMore, loadDocuments]
  );

  useEffect(() => {
    loadDocuments(true);
  }, [selectedCategory]);

  const handleSearch = (query) => {
    setSearchQuery(query);
    // Implement search functionality
  };

  const handleUploadClick = () => {
    if (!user) {
      openModal("auth_modal");
    } else {
      router.push("/upload");
    }
  };

  const handleMobileSearchClick = () => {
    openModal("search_modal");
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
        <section className="max-w-7xl mx-auto px-2 pb-32">
          {loading ? (
            <div className="flex flex-wrap gap-6 justify-center">
              {Array.from({ length: 21 }).map((_, i) => (
                <DocumentSkeleton key={i} />
              ))}
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-6 justify-center">
                {documents.map((doc, index) => (
                  <div
                    key={doc._id}
                    ref={
                      index === documents.length - 1 ? lastDocumentRef : null
                    }
                  >
                    <DocumentCard document={doc} />
                  </div>
                ))}
              </div>

              {loadingMore && (
                <div className="flex flex-wrap gap-6 justify-center mt-6">
                  {Array.from({ length: 14 }).map((_, i) => (
                    <DocumentSkeleton key={i} />
                  ))}
                </div>
              )}

              {!hasMore && documents.length > 0 && (
                <div className="text-center py-12">
                  <p className="text-dark-400">You've reached the end</p>
                </div>
              )}

              {documents.length === 0 && !loading && (
                <div className="text-center py-20">
                  <p className="text-dark-400 text-lg">No documents found</p>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </>
  );
}
