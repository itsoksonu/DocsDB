import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import { useAuth } from "../contexts/AuthContext";
import { DesktopNavbar } from "../components/layout/DesktopNavbar";
import { SearchBar } from "../components/ui/SearchBar";
import { DocumentCard } from "../components/common/DocumentCard";
import { DocumentSkeleton } from "../components/ui/Skeleton";
import { apiService } from "../services/api";
import toast from "react-hot-toast";
import debounce from "lodash.debounce";
import Footer from "../components/layout/Footer";
import { motion, AnimatePresence } from "framer-motion";
import { SlidersHorizontal, ChevronDown, Sparkles, Clock, Eye, Download } from "lucide-react";

const CATEGORIES = [
  { id: "", name: "All Categories", emoji: "🌐" },
  { id: "technology", name: "Technology", emoji: "💻" },
  { id: "business", name: "Business", emoji: "💼" },
  { id: "education", name: "Education", emoji: "🎓" },
  { id: "health", name: "Health", emoji: "❤️" },
  { id: "entertainment", name: "Entertainment", emoji: "🎬" },
  { id: "sports", name: "Sports", emoji: "⚽" },
  { id: "finance-money-management", name: "Finance & Money", emoji: "💰" },
  { id: "games-activities", name: "Games & Activities", emoji: "🎮" },
  { id: "comics", name: "Comics", emoji: "💬" },
  { id: "philosophy", name: "Philosophy", emoji: "🤔" },
  { id: "career-growth", name: "Career & Growth", emoji: "📈" },
  { id: "politics", name: "Politics", emoji: "🏛️" },
  { id: "biography-memoir", name: "Biography & Memoir", emoji: "📖" },
  { id: "study-aids-test-prep", name: "Study Aids & Test Prep", emoji: "📚" },
  { id: "law", name: "Law", emoji: "⚖️" },
  { id: "art", name: "Art", emoji: "🎨" },
  { id: "science", name: "Science", emoji: "🔬" },
  { id: "history", name: "History", emoji: "🏺" },
  { id: "erotica", name: "Erotica", emoji: "🌹" },
  { id: "lifestyle", name: "Lifestyle", emoji: "✨" },
  { id: "religion-spirituality", name: "Religion & Spirituality", emoji: "🙏" },
  { id: "self-improvement", name: "Self-Improvement", emoji: "🌱" },
  { id: "language-arts", name: "Language Arts", emoji: "📝" },
  { id: "cooking-food-wine", name: "Cooking, Food & Wine", emoji: "🍳" },
  { id: "true-crime", name: "True Crime", emoji: "🔍" },
  { id: "sheet-music", name: "Sheet Music", emoji: "🎵" },
  { id: "fiction", name: "Fiction", emoji: "📕" },
  { id: "non-fiction", name: "Non-Fiction", emoji: "📘" },
  { id: "science-fiction", name: "Science Fiction", emoji: "🚀" },
  { id: "fantasy", name: "Fantasy", emoji: "🐉" },
  { id: "romance", name: "Romance", emoji: "💕" },
  { id: "thriller-suspense", name: "Thriller & Suspense", emoji: "🔪" },
  { id: "horror", name: "Horror", emoji: "👻" },
  { id: "poetry", name: "Poetry", emoji: "🌙" },
  { id: "graphic-novels", name: "Graphic Novels", emoji: "🦸" },
  { id: "young-adult", name: "Young Adult", emoji: "🌟" },
  { id: "children", name: "Children", emoji: "🧒" },
  { id: "parenting-family", name: "Parenting & Family", emoji: "👨‍👩‍👧" },
  { id: "marketing-sales", name: "Marketing & Sales", emoji: "📊" },
  { id: "psychology", name: "Psychology", emoji: "🧠" },
  { id: "social-sciences", name: "Social Sciences", emoji: "👥" },
  { id: "engineering", name: "Engineering", emoji: "⚙️" },
  { id: "mathematics", name: "Mathematics", emoji: "📐" },
  { id: "data-science", name: "Data Science", emoji: "📉" },
  { id: "news-media", name: "News & Media", emoji: "📰" },
  { id: "nature-environment", name: "Nature & Environment", emoji: "🌿" },
  { id: "travel", name: "Travel", emoji: "✈️" },
  { id: "reference", name: "Reference", emoji: "📋" },
  { id: "design", name: "Design", emoji: "🎯" },
  { id: "professional-development", name: "Professional Devlopment", emoji: "💡" },
  { id: "other", name: "Other", emoji: "📦" },
];

const SORT_OPTIONS = [
  { value: "relevant", label: "Most Relevant", icon: Sparkles },
  { value: "newest", label: "Newest First", icon: Clock },
  { value: "most_views", label: "Most Viewed", icon: Eye },
  { value: "most_downloads", label: "Most Downloaded", icon: Download },
];

export default function SearchPage() {
  const { user } = useAuth();
  const router = useRouter();
  const { q, category, type, sort: sortQuery } = router.query;

  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [searchQuery, setSearchQuery] = useState(q || "");
  const [selectedCategory, setSelectedCategory] = useState(category || "");
  const [searchType, setSearchType] = useState(type || "keyword");
  const [sort, setSort] = useState(sortQuery || "relevant");
  const [totalResults, setTotalResults] = useState(0);
  const [isSortOpen, setIsSortOpen] = useState(false);
  const [isCategoryOpen, setIsCategoryOpen] = useState(false);
  const observer = useRef();
  const sortRef = useRef(null);
  const categoryRef = useRef(null);
  const searchSeqRef = useRef(0);
  // Which page to request next. A ref rather than state because nothing renders
  // it - it was only ever read back by the next request, and as state it forced
  // three extra re-renders per search.
  const pageRef = useRef(1);

  const activeSortLabel =
    SORT_OPTIONS.find((s) => s.value === sort)?.label || "Most Relevant";
  const activeCat = CATEGORIES.find((c) => c.id === selectedCategory);

  const performSearch = useCallback(
    async (reset = false) => {
      if (!searchQuery.trim()) {
        setDocuments([]);
        setLoading(false);
        return;
      }

      // Typing and filter changes fire overlapping requests. Without this guard
      // a slow earlier response lands after a newer one and overwrites it, so
      // the results shown do not match the query in the box.
      const seq = ++searchSeqRef.current;
      const isCurrent = () => seq === searchSeqRef.current;

      try {
        if (reset) {
          setLoading(true);
          pageRef.current = 1;
        } else {
          setLoadingMore(true);
        }

        const params = {
          q: searchQuery,
          type: searchType,
          sort,
          category: selectedCategory || undefined,
          page: reset ? 1 : pageRef.current,
          limit: 20,
        };

        const response = await apiService.searchDocuments(params);
        if (!isCurrent()) return;

        const { documents: newDocs, pagination } = response.data;

        if (reset) {
          setDocuments(newDocs);
        } else {
          setDocuments((prev) => [...prev, ...newDocs]);
        }

        setTotalResults(pagination.total);
        setHasMore(pagination.hasMore);
        pageRef.current = reset ? 2 : pageRef.current + 1;
      } catch (error) {
        if (!isCurrent()) return;
        toast.error("Failed to search documents");
        console.error("Search error:", error);
      } finally {
        if (isCurrent()) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    // page is deliberately absent: it lives in pageRef, not state. Keeping it
    // as a dependency here while the body also advanced it meant this callback
    // changed identity on every search, so the effect below could not depend on
    // it without looping (effect -> setPage -> new identity -> effect -> ...).
    [searchQuery, searchType, selectedCategory, sort],
  );

  const lastDocumentRef = useCallback(
    (node) => {
      if (loadingMore) return;
      if (observer.current) observer.current.disconnect();

      observer.current = new IntersectionObserver(
        debounce((entries) => {
          if (entries[0].isIntersecting && hasMore) performSearch(false);
        }, 300),
      );

      if (node) observer.current.observe(node);
    },
    [loadingMore, hasMore, performSearch],
  );

  // The observer was only ever disconnected when the ref callback ran again, so
  // the last one outlived the page and could call performSearch after unmount.
  useEffect(() => () => observer.current?.disconnect(), []);

  useEffect(() => {
    if (q) setSearchQuery(q);
  }, [q]);

  useEffect(() => {
    if (category !== undefined) setSelectedCategory(category || "");
  }, [category]);

  useEffect(() => {
    if (type) setSearchType(type);
  }, [type]);

  useEffect(() => {
    if (sortQuery) setSort(sortQuery);
  }, [sortQuery]);

  // performSearch's own deps are exactly the four values this effect used to
  // list, so depending on the callback is equivalent - and stays correct if
  // those inputs ever change.
  useEffect(() => {
    performSearch(true);
  }, [performSearch]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClick = (e) => {
      if (sortRef.current && !sortRef.current.contains(e.target))
        setIsSortOpen(false);
      if (categoryRef.current && !categoryRef.current.contains(e.target))
        setIsCategoryOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const buildQuery = (overrides = {}) => ({
    q: searchQuery,
    ...(selectedCategory && { category: selectedCategory }),
    type: searchType,
    ...(sort !== "relevant" && { sort }),
    ...overrides,
  });

  const handleSearch = (query) => {
    const trimmed = query.trim();
    if (trimmed && trimmed !== router.query.q) {
      // No encodeURIComponent: next/router already encodes values in a query
      // object, so encoding here produced %2520 in the URL and a literal "%20"
      // in the search term sent to the API.
      router.push({
        pathname: "/search",
        query: buildQuery({ q: trimmed }),
      });
    }
  };

  const handleCategoryChange = (categoryId) => {
    setSelectedCategory(categoryId);
    router.push({
      pathname: "/search",
      query: buildQuery({
        ...(categoryId ? { category: categoryId } : { category: undefined }),
      }),
    });
  };

  const handleTypeChange = (newType) => {
    setSearchType(newType);
    router.push({
      pathname: "/search",
      query: buildQuery({ type: newType }),
    });
  };

  const handleSortChange = (newSort) => {
    setIsSortOpen(false);
    setSort(newSort);
    router.push({
      pathname: "/search",
      query: buildQuery({
        ...(newSort !== "relevant" ? { sort: newSort } : { sort: undefined }),
      }),
    });
  };

  const handleUploadClick = () => {
    if (!user) {
      router.push("/?auth=true");
    } else {
      router.push("/upload");
    }
  };

  return (
    <>
      <Head>
        {/* One expression, not {expr} + " - DocsDB": a title with two children
            is an array of text nodes, which React warns about and which makes
            hydration fall back to client rendering. */}
        <title>{`${
          searchQuery ? `Search: ${searchQuery}` : "Search"
        } - DocsDB`}</title>
        <meta
          name="description"
          content={`Search results for "${searchQuery}" on DocsDB`}
        />
      </Head>

      <div className="min-h-screen bg-dark-950 text-white">
        {/* Desktop Navbar */}
        <DesktopNavbar
          onSearch={handleSearch}
          onUploadClick={handleUploadClick}
        />

        {/* Search Header */}
        <section className="pt-32 px-6 pb-8">
          <div className="max-w-7xl mx-auto">
            {/* Search Bar */}
            <div className="max-w-3xl mx-auto mb-8">
              <SearchBar
                onSearch={handleSearch}
                placeholder="Search documents, research, topics..."
                className="w-full"
                defaultValue={searchQuery}
                autoFocus={true}
              />
            </div>

            {/* Search Info */}
            {searchQuery && (
              <div className="text-center mb-6">
                <h1 className="text-2xl font-semibold mb-2">
                  Search Results for &ldquo;{searchQuery}&rdquo;
                </h1>
                {!loading && (
                  <p className="text-dark-300">
                    Found {totalResults.toLocaleString()} results
                  </p>
                )}
              </div>
            )}

            {/* Filters */}
            <div className="max-w-5xl mx-auto">
              <div className="flex items-center gap-2 flex-wrap justify-center">

                {/* Search Type Toggle */}
                <div className="flex items-center gap-0.5 bg-dark-900 border border-dark-700 rounded-full p-1">
                  {["keyword", "semantic"].map((t) => (
                    <button
                      key={t}
                      onClick={() => handleTypeChange(t)}
                      className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all capitalize ${
                        searchType === t
                          ? "bg-white text-dark-900 shadow-sm"
                          : "text-dark-400 hover:text-white"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>

                {/* Divider */}
                <div className="h-5 w-px bg-dark-700 mx-1 flex-shrink-0" />

                {/* Category Dropdown */}
                <div ref={categoryRef} className="relative flex-shrink-0">
                  <button
                    onClick={() => {
                      setIsCategoryOpen((v) => !v);
                      setIsSortOpen(false);
                    }}
                    className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-medium border transition-all ${
                      selectedCategory
                        ? "bg-white/10 border-white/20 text-white"
                        : "bg-dark-900 border-dark-700 text-dark-400 hover:text-white hover:border-dark-500"
                    }`}
                  >
                    <span className="text-sm leading-none flex-shrink-0">
                      {activeCat ? activeCat.emoji : "🌐"}
                    </span>
                    <span className="whitespace-nowrap">
                      {activeCat ? activeCat.name : "All Categories"}
                    </span>
                    <ChevronDown
                      size={11}
                      className={`flex-shrink-0 transition-transform duration-200 ${isCategoryOpen ? "rotate-180" : ""}`}
                    />
                  </button>

                  <AnimatePresence>
                    {isCategoryOpen && (
                      <motion.div
                        initial={{ opacity: 0, y: 6, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 4, scale: 0.97 }}
                        transition={{ duration: 0.12 }}
                        className="absolute left-0 top-full mt-2 w-56 bg-dark-900 border border-dark-700 rounded-xl shadow-2xl shadow-black/60 z-50 overflow-hidden"
                      >
                        <div className="p-1.5 max-h-72 overflow-y-auto scrollbar-hide">
                          {CATEGORIES.map((cat) => (
                            <button
                              key={cat.id}
                              onClick={() => {
                                handleCategoryChange(cat.id);
                                setIsCategoryOpen(false);
                              }}
                              className={`w-full text-left flex items-center gap-2.5 px-3 py-2 text-xs rounded-lg transition-colors ${
                                selectedCategory === cat.id
                                  ? "bg-dark-700 text-white font-medium"
                                  : "text-dark-400 hover:bg-dark-800 hover:text-white"
                              }`}
                            >
                              <span className="text-sm leading-none flex-shrink-0">
                                {cat.emoji}
                              </span>
                              {cat.name}
                            </button>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Sort Dropdown */}
                <div ref={sortRef} className="relative flex-shrink-0">
                  <button
                    onClick={() => {
                      setIsSortOpen((v) => !v);
                      setIsCategoryOpen(false);
                    }}
                    className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-medium border transition-all ${
                      sort !== "relevant"
                        ? "bg-white/10 border-white/20 text-white"
                        : "bg-dark-900 border-dark-700 text-dark-400 hover:text-white hover:border-dark-500"
                    }`}
                  >
                    <SlidersHorizontal size={11} className="flex-shrink-0" />
                    <span className="whitespace-nowrap">{activeSortLabel}</span>
                    <ChevronDown
                      size={11}
                      className={`flex-shrink-0 transition-transform duration-200 ${isSortOpen ? "rotate-180" : ""}`}
                    />
                  </button>

                  <AnimatePresence>
                    {isSortOpen && (
                      <motion.div
                        initial={{ opacity: 0, y: 6, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 4, scale: 0.97 }}
                        transition={{ duration: 0.12 }}
                        className="absolute right-0 top-full mt-2 w-48 bg-dark-900 border border-dark-700 rounded-xl shadow-2xl shadow-black/60 z-50 overflow-hidden"
                      >
                        <div className="p-1.5">
                          {SORT_OPTIONS.map((opt) => {
                            const Icon = opt.icon;
                            return (
                              <button
                                key={opt.value}
                                onClick={() => handleSortChange(opt.value)}
                                className={`w-full text-left flex items-center gap-2.5 px-3 py-2 text-xs rounded-lg transition-colors ${
                                  sort === opt.value
                                    ? "bg-dark-700 text-white font-medium"
                                    : "text-dark-400 hover:bg-dark-800 hover:text-white"
                                }`}
                              >
                                <Icon size={12} className="flex-shrink-0" />
                                {opt.label}
                              </button>
                            );
                          })}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

              </div>
            </div>
          </div>
        </section>

        {/* Results Grid */}
        <section className="max-w-7xl mx-auto px-6 pb-32">
          {loading ? (
            <div className="flex flex-wrap gap-6 justify-center">
              {Array.from({ length: 20 }).map((_, i) => (
                <DocumentSkeleton key={i} />
              ))}
            </div>
          ) : (
            <>
              {documents.length > 0 ? (
                <>
                  <div className="flex flex-wrap gap-6 justify-center">
                    {documents.map((doc, index) => (
                      <div
                        key={doc._id}
                        ref={
                          index === documents.length - 1
                            ? lastDocumentRef
                            : null
                        }
                      >
                        <DocumentCard document={doc} />
                      </div>
                    ))}
                  </div>

                  {loadingMore && (
                    <div className="flex flex-wrap gap-6 justify-center mt-6">
                      {Array.from({ length: 10 }).map((_, i) => (
                        <DocumentSkeleton key={i} />
                      ))}
                    </div>
                  )}

                  {!hasMore && documents.length > 0 && (
                    <div className="w-full py-12 flex items-center justify-center relative">
                      <div
                        className="absolute inset-0 flex items-center"
                        aria-hidden="true"
                      >
                        <div className="w-full border-t border-dark-800"></div>
                      </div>
                      <div className="relative flex justify-center">
                        <span className="px-4 bg-dark-950 text-sm text-dark-400 uppercase tracking-widest font-medium">
                          You&apos;ve reached the end
                        </span>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-20">
                  <svg
                    className="w-24 h-24 mx-auto mb-6 text-dark-700"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                    />
                  </svg>
                  <h2 className="text-2xl font-semibold mb-2">
                    No results found
                  </h2>
                  <p className="text-dark-400 mb-8">
                    Try adjusting your search terms or filters
                  </p>
                  <button
                    onClick={() => router.push("/")}
                    className="px-6 py-3 bg-white text-dark-900 rounded-lg font-medium hover:bg-gray-100 transition-colors"
                  >
                    Back to Home
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </div>
      {/* Footer Section */}
      <Footer />

      <style jsx>{`
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .scrollbar-hide { scrollbar-width: none; -ms-overflow-style: none; }
      `}</style>
    </>
  );
}
