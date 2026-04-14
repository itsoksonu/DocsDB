import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import { DesktopNavbar } from "../components/layout/DesktopNavbar";
import { DocumentCard } from "../components/common/DocumentCard";
import { DocumentSkeleton } from "../components/ui/Skeleton";
import { apiService } from "../services/api";
import Footer from "../components/layout/Footer";
import toast from "react-hot-toast";
import { motion, AnimatePresence } from "framer-motion";
import { Search, X, ChevronDown, Menu, SlidersHorizontal, Layers } from "lucide-react";
import debounce from "lodash.debounce";

const CATEGORIES = [
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
  { id: "professional-development", name: "Professional Dev", emoji: "💡" },
  { id: "other", name: "Other", emoji: "📦" },
];

const SORT_OPTIONS = [
  { value: "relevant", label: "Most Relevant" },
  { value: "newest", label: "Newest First" },
  { value: "most_views", label: "Most Viewed" },
  { value: "most_downloads", label: "Most Downloaded" },
];

function SidebarItem({ cat, isActive, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`
        group w-full flex items-center gap-3 py-2 pr-3 text-sm transition-all duration-150 rounded-r-lg
        border-l-2
        ${isActive
          ? "border-l-white/70 bg-white/[0.06] text-white font-medium pl-[calc(0.875rem-2px)]"
          : "border-l-transparent text-dark-400 hover:text-dark-200 hover:bg-white/[0.03] hover:border-l-dark-600 pl-3.5"
        }
      `}
    >
      <span className="text-sm leading-none flex-shrink-0 opacity-80">
        {cat.emoji}
      </span>
      <span className="truncate text-left leading-snug">{cat.name}</span>
      {isActive && (
        <span className="ml-auto w-1 h-1 rounded-full bg-white/60 flex-shrink-0" />
      )}
    </button>
  );
}

export default function Explore() {
  const router = useRouter();

  const [selectedCategory, setSelectedCategory] = useState(null);
  const [sort, setSort] = useState("relevant");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchType, setSearchType] = useState("keyword");
  const [inputValue, setInputValue] = useState("");
  const [isSortOpen, setIsSortOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [totalResults, setTotalResults] = useState(0);
  const [searchPage, setSearchPage] = useState(1);

  const browsePageRef = useRef(1);
  const sentinelRef = useRef(null);
  const isLoadingRef = useRef(false);
  const sortRef = useRef(null);
  const loadedCountRef = useRef(0);

  useEffect(() => {
    if (!router.isReady) return;
    setSelectedCategory(router.query.category || null);
    setSort(router.query.sort || "relevant");
    setSearchQuery(router.query.q || "");
    setInputValue(router.query.q || "");
    setSearchType(router.query.type || "keyword");
  }, [router.isReady, router.query.category, router.query.sort, router.query.q, router.query.type]);

  const pushRoute = useCallback(
    (cat, s, q, t) => {
      const query = {};
      if (cat) query.category = cat;
      if (s && s !== "relevant") query.sort = s;
      if (q) query.q = q;
      if (q && t && t !== "keyword") query.type = t;
      router.push({ pathname: "/explore", query }, undefined, { shallow: true });
    },
    [router]
  );

  const handleCategorySelect = (catId) => {
    setIsSidebarOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
    pushRoute(catId, sort, "");
  };

  const handleSortChange = (value) => {
    setIsSortOpen(false);
    pushRoute(selectedCategory, value, searchQuery, searchType);
  };

  const handleSearchTypeChange = (type) => {
    pushRoute(selectedCategory, sort, searchQuery, type);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const debouncedSearch = useCallback(
    debounce((val) => {
      pushRoute(selectedCategory, sort, val, searchType);
    }, 500),
    [selectedCategory, sort, searchType]
  );

  const handleInputChange = (e) => {
    const val = e.target.value;
    setInputValue(val);
    debouncedSearch(val);
  };

  const clearSearch = () => {
    setInputValue("");
    pushRoute(selectedCategory, sort, "");
  };

  const isSearchMode = !!(searchQuery && searchQuery.trim().length >= 2);

  const loadDocuments = useCallback(
    async (reset = false) => {
      if (isLoadingRef.current) return;
      isLoadingRef.current = true;

      try {
        if (reset) {
          setLoading(true);
          browsePageRef.current = 1;
          setSearchPage(1);
          setDocuments([]);
          setHasMore(true);
          setTotalResults(0);
          loadedCountRef.current = 0;
        } else {
          setLoadingMore(true);
        }

        let response;
        if (isSearchMode) {
          // Use same searchDocuments logic as search.jsx
          const currentPage = reset ? 1 : searchPage;
          const params = {
            q: searchQuery.trim(),
            type: searchType,
            limit: 20,
            page: currentPage,
          };
          if (selectedCategory) params.category = selectedCategory;
          response = await apiService.searchDocuments(params);

          const newDocs = (response.data?.documents || []).filter(
            (d) => d.status === "processed"
          );
          const pagination = response.data?.pagination || {};

          if (reset) {
            loadedCountRef.current = newDocs.length;
            setDocuments(newDocs);
          } else {
            loadedCountRef.current += newDocs.length;
            setDocuments((prev) => [...prev, ...newDocs]);
          }

          const searchTotal = pagination.total;
          if (searchTotal !== undefined) setTotalResults(searchTotal);
          // Stop when we get an empty page or the API says no more
          const searchHasMore = newDocs.length > 0 && pagination.hasMore !== false;
          setHasMore(searchHasMore);
          setSearchPage(reset ? 2 : (p) => p + 1);
        } else {
          // Browse mode — page-based via getFeed
          const currentBrowsePage = reset ? 1 : browsePageRef.current;
          const params = { sort, limit: 20, page: currentBrowsePage };
          if (selectedCategory) params.category = selectedCategory;
          response = await apiService.getFeed(params);

          const newDocs = (response.data?.documents || response.documents || []).filter(
            (d) => d.status === "processed"
          );
          const pagination = response.data?.pagination || response.pagination || {};

          if (reset) {
            loadedCountRef.current = newDocs.length;
            setDocuments(newDocs);
          } else {
            setDocuments((prev) => {
              const ids = new Set(prev.map((d) => d._id));
              const unique = newDocs.filter((d) => !ids.has(d._id));
              loadedCountRef.current += unique.length;
              return [...prev, ...unique];
            });
          }

          const browseTotal = pagination.total;
          if (browseTotal !== undefined) setTotalResults(browseTotal);
          browsePageRef.current = reset ? 2 : browsePageRef.current + 1;
          const browseHasMore = pagination.hasMore !== false && newDocs.length > 0;
          setHasMore(browseHasMore);
        }
      } catch (err) {
        toast.error("Failed to load documents");
        console.error(err);
      } finally {
        setLoading(false);
        setLoadingMore(false);
        isLoadingRef.current = false;
      }
    },
    [selectedCategory, sort, searchQuery, searchType, isSearchMode, searchPage]
  );

  useEffect(() => {
    if (!router.isReady) return;
    loadDocuments(true);
  }, [selectedCategory, sort, searchQuery, searchType, router.isReady]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore && !loading) {
          loadDocuments(false);
        }
      },
      { rootMargin: "300px", threshold: 0 }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loading, loadingMore, loadDocuments]);

  useEffect(() => {
    const handleClick = (e) => {
      if (sortRef.current && !sortRef.current.contains(e.target)) setIsSortOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Lock body scroll when mobile sidebar is open
  useEffect(() => {
    if (isSidebarOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [isSidebarOpen]);

  const activeCat = CATEGORIES.find((c) => c.id === selectedCategory);
  const activeSortLabel = SORT_OPTIONS.find((s) => s.value === sort)?.label || "Most Relevant";

  return (
    <>
      <Head>
        <title>{activeCat ? `${activeCat.name} — Explore` : "Explore"} - DocsDB</title>
        <meta
          name="description"
          content={
            activeCat
              ? `Browse ${activeCat.name} documents on DocsDB`
              : "Explore thousands of documents across all categories on DocsDB"
          }
        />
      </Head>

      {/* Fixed Navbar */}
      <DesktopNavbar />

      {/* Mobile sidebar overlay */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40 lg:hidden"
          />
        )}
      </AnimatePresence>

      {/* Mobile sidebar drawer */}
      <div
        className={`
          fixed top-0 left-0 h-screen w-64 z-50 bg-dark-900 border-r border-dark-700/80 flex flex-col
          transform transition-transform duration-300 ease-in-out
          lg:hidden
          ${isSidebarOpen ? "translate-x-0" : "-translate-x-full"}
        `}
      >
        {/* Mobile sidebar top — below navbar */}
        <div className="flex items-center justify-between px-5 pt-20 pb-4">
          <div className="flex items-center gap-2">
            <Layers size={14} className="text-dark-500" />
            <span className="text-xs font-semibold uppercase tracking-widest text-dark-500">
              Categories
            </span>
          </div>
          <button
            onClick={() => setIsSidebarOpen(false)}
            className="p-1.5 rounded-lg hover:bg-dark-800 text-dark-500 hover:text-white transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto pl-5 pr-3 pb-8 space-y-0.5 scrollbar-hide">
          <MobileCategoryList
            selectedCategory={selectedCategory}
            onSelect={handleCategorySelect}
          />
        </nav>

        <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-dark-900 to-transparent" />
      </div>

      {/* Page body — below fixed navbar */}
      <div className="flex bg-dark-950 min-h-screen" style={{ paddingTop: "80px" }}>

        {/* ── Desktop sidebar ── */}
        <aside
          className="hidden lg:flex flex-col flex-shrink-0 bg-dark-950 border-r border-dark-700/60"
          style={{
            width: "240px",
            position: "sticky",
            top: "80px",
            height: "calc(100vh - 72px)",
            overflowY: "auto",
          }}
        >
          {/* Sidebar header */}
          <div className="flex items-center gap-2 px-5 pt-6 pb-3">
            <Layers size={13} className="text-dark-400" />
            <span className="text-xs font-semibold uppercase tracking-widest text-dark-400">
              Categories
            </span>
          </div>

          {/* All Documents */}
          <div className="px-5 mb-1">
            <button
              onClick={() => handleCategorySelect(null)}
              className={`
                group w-full flex items-center gap-3 py-2 pr-3 text-sm transition-all duration-150 rounded-r-lg
                border-l-2
                ${!selectedCategory
                  ? "border-l-white/70 bg-white/[0.06] text-white font-medium pl-[calc(0.875rem-2px)]"
                  : "border-l-transparent text-dark-400 hover:text-dark-200 hover:bg-white/[0.03] hover:border-l-dark-600 pl-3.5"
                }
              `}
            >
              <span className="text-sm leading-none flex-shrink-0 opacity-80">🌐</span>
              <span className="truncate text-left leading-snug ">All Documents</span>
              {!selectedCategory && (
                <span className="ml-auto w-1 h-1 rounded-full bg-white/60 flex-shrink-0" />
              )}
            </button>
          </div>

          {/* Divider */}
          <div className="mx-5 my-3 h-px bg-dark-800" />

          {/* Category list */}
          <nav className="flex-1 px-5 pb-8 space-y-0.5 overflow-y-auto scrollbar-hide">
            {CATEGORIES.map((cat) => (
              <SidebarItem
                key={cat.id}
                cat={cat}
                isActive={selectedCategory === cat.id}
                onClick={() => handleCategorySelect(cat.id)}
              />
            ))}
          </nav>

          {/* Bottom fade */}
          <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-14 bg-gradient-to-t from-dark-900 to-transparent" />
        </aside>

        {/* ── Main content ── */}
        <main className="flex-1 min-w-0 flex flex-col min-h-[calc(100vh-72px)]">

          {/* Page header */}
          <div className="px-6 md:px-8 pt-8 pb-6 border-b border-dark-800/80">

            {/* Mobile: category picker button */}
            <button
              onClick={() => setIsSidebarOpen(true)}
              className="lg:hidden mb-5 flex items-center gap-2 px-3 py-1.5 rounded-lg border border-dark-700 bg-dark-800/60 text-sm text-dark-300 hover:text-white hover:border-dark-600 transition-all"
            >
              <Menu size={14} />
              <span>{activeCat ? activeCat.name : "All Documents"}</span>
              <ChevronDown size={13} className="ml-1 text-dark-500" />
            </button>

            {/* Breadcrumb */}
            {activeCat && (
              <div className="flex items-center gap-1.5 mb-3">
                <button
                  onClick={() => handleCategorySelect(null)}
                  className="text-sm text-dark-400 hover:text-dark-100 transition-colors"
                >
                  All Documents
                </button>
                <span className="text-dark-400 text-sm">/</span>
                <span className="text-sm text-dark-400">{activeCat.name}</span>
              </div>
            )}

            {/* Title row */}
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl md:text-3xl font-bold font-literature leading-tight">
                  {activeCat
                    ? `${activeCat.emoji}  ${activeCat.name}`
                    : "Explore Documents"}
                </h1>
                <div className="mt-1.5 h-5">
                  {loading ? (
                    <div className="h-3.5 w-32 bg-dark-800 rounded animate-pulse" />
                  ) : (
                    <p className="text-sm text-dark-400">
                      {totalResults > 0
                        ? `${totalResults.toLocaleString()} document${totalResults !== 1 ? "s" : ""}`
                        : documents.length > 0
                        ? `${documents.length} document${documents.length !== 1 ? "s" : ""} loaded`
                        : activeCat
                        ? `Browsing ${activeCat.name}`
                        : "Browse all documents"}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Search + Sort */}
            <div className="mt-5 flex flex-col gap-2.5">
              {/* Row 1: search input + sort */}
              <div className="flex items-center gap-2.5">
                {/* Search input */}
                <div className="flex-1 relative">
                  <Search
                    size={14}
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 text-dark-600 pointer-events-none"
                  />
                  <input
                    type="text"
                    value={inputValue}
                    onChange={handleInputChange}
                    placeholder={
                      activeCat ? `Search in ${activeCat.name}…` : "Search all documents…"
                    }
                    className="w-full pl-9 pr-9 py-2.5 bg-dark-900 border border-dark-700/80 hover:border-dark-600 focus:border-dark-500 focus:ring-1 focus:ring-dark-500 rounded-xl text-sm text-white placeholder-dark-700 outline-none transition-all"
                  />
                  {inputValue && (
                    <button
                      onClick={clearSearch}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-dark-700 transition-colors"
                    >
                      <X size={12} className="text-dark-500" />
                    </button>
                  )}
                </div>

                {/* Sort dropdown */}
                <div ref={sortRef} className="relative flex-shrink-0">
                  <button
                    onClick={() => setIsSortOpen((v) => !v)}
                    className="flex items-center gap-2 px-3.5 py-2.5 bg-dark-900 border border-dark-700/80 hover:border-dark-600 rounded-xl text-sm text-dark-400 hover:text-white transition-all"
                  >
                    <SlidersHorizontal size={13} className="flex-shrink-0" />
                    <span className="hidden sm:inline whitespace-nowrap text-xs">
                      {activeSortLabel}
                    </span>
                    <ChevronDown
                      size={12}
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
                          {SORT_OPTIONS.map((opt) => (
                            <button
                              key={opt.value}
                              onClick={() => handleSortChange(opt.value)}
                              className={`w-full text-left px-3 py-2 text-xs rounded-lg transition-colors ${
                                sort === opt.value
                                  ? "bg-dark-700 text-white font-medium"
                                  : "text-dark-400 hover:bg-dark-800 hover:text-white"
                              }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>

              {/* Row 2: keyword / semantic toggle — only visible when searching */}
              <AnimatePresence>
                {isSearchMode && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.15 }}
                    className="flex items-center gap-3"
                  >
                    <div className="flex gap-1 bg-dark-800 rounded-lg p-1 border border-dark-700">
                      {["keyword", "semantic"].map((t) => (
                        <button
                          key={t}
                          onClick={() => handleSearchTypeChange(t)}
                          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all capitalize ${
                            searchType === t
                              ? "bg-white text-dark-900"
                              : "text-dark-400 hover:text-white"
                          }`}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                    {!loading && totalResults > 0 && (
                      <span className="text-xs text-dark-600">
                        {totalResults.toLocaleString()} result{totalResults !== 1 ? "s" : ""} for &ldquo;{searchQuery}&rdquo;
                      </span>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Documents grid */}
          <div className="flex-1 px-6 md:px-8 py-7">
            {loading ? (
              <div className="flex flex-wrap justify-center gap-5">
                {Array.from({ length: 20 }).map((_, i) => (
                  <DocumentSkeleton key={i} />
                ))}
              </div>
            ) : documents.length > 0 ? (
              <>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.25 }}
                  className="flex flex-wrap justify-center gap-5"
                >
                  {documents.map((doc) => (
                    <DocumentCard key={doc._id} document={doc} />
                  ))}
                </motion.div>

                {/* Load-more skeletons */}
                {loadingMore && (
                  <div className="flex flex-wrap justify-center gap-5 mt-6">
                    {Array.from({ length: 8 }).map((_, i) => (
                      <DocumentSkeleton key={`more-${i}`} />
                    ))}
                  </div>
                )}

                {/* Sentinel — always rendered below grid, observed only when hasMore */}
                <div ref={sentinelRef} className="w-full h-4 mt-2" />

                {/* End of list */}
                {!hasMore && documents.length > 0 && (
                  <div className="w-full py-16 flex items-center justify-center relative">
                    <div className="absolute inset-0 flex items-center" aria-hidden="true">
                      <div className="w-full border-t border-dark-800" />
                    </div>
                    <div className="relative">
                      <span className="px-4 bg-dark-950 text-xs text-dark-700 uppercase tracking-widest font-medium">
                        You&apos;ve reached the end
                      </span>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className="flex flex-col items-center justify-center py-28 text-center"
              >
                <div className="w-14 h-14 rounded-2xl bg-dark-800 border border-dark-700 flex items-center justify-center mb-4 text-2xl">
                  {activeCat ? activeCat.emoji : "🔍"}
                </div>
                <h3 className="text-base font-semibold text-white mb-1">
                  {searchQuery ? "No results found" : "Nothing here yet"}
                </h3>
                <p className="text-dark-600 text-sm max-w-xs">
                  {searchQuery
                    ? "Try different keywords or clear your search."
                    : "This category doesn't have documents yet."}
                </p>
                {searchQuery && (
                  <button
                    onClick={clearSearch}
                    className="mt-4 px-4 py-1.5 text-xs border border-dark-700 hover:border-dark-600 rounded-lg text-dark-400 hover:text-white transition-all"
                  >
                    Clear search
                  </button>
                )}
              </motion.div>
            )}
          </div>

          <Footer />
        </main>
      </div>

      <style jsx>{`
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .scrollbar-hide { scrollbar-width: none; -ms-overflow-style: none; }
      `}</style>
    </>
  );
}

// Extracted for mobile drawer (same logic, slightly different container)
function MobileCategoryList({ selectedCategory, onSelect }) {
  const isActiveAll = !selectedCategory;
  return (
    <>
      <button
        onClick={() => onSelect(null)}
        className={`
          group w-full flex items-center gap-3 py-2 pr-3 text-sm transition-all duration-150 rounded-r-lg border-l-2
          ${isActiveAll
            ? "border-l-white/70 bg-white/[0.06] text-white font-medium pl-[calc(0.875rem-2px)]"
            : "border-l-transparent text-dark-400 hover:text-dark-200 hover:bg-white/[0.03] hover:border-l-dark-600 pl-3.5"
          }
        `}
      >
        <span className="text-sm leading-none opacity-80">🌐</span>
        <span className="truncate">All Documents</span>
        {isActiveAll && (
          <span className="ml-auto w-1 h-1 rounded-full bg-white/60 flex-shrink-0" />
        )}
      </button>

      <div className="my-3 h-px bg-dark-800" />

      {CATEGORIES.map((cat) => {
        const isActive = selectedCategory === cat.id;
        return (
          <button
            key={cat.id}
            onClick={() => onSelect(cat.id)}
            className={`
              group w-full flex items-center gap-3 py-2 pr-3 text-sm transition-all duration-150 rounded-r-lg border-l-2
              ${isActive
                ? "border-l-white/70 bg-white/[0.06] text-white font-medium pl-[calc(0.875rem-2px)]"
                : "border-l-transparent text-dark-400 hover:text-dark-200 hover:bg-white/[0.03] hover:border-l-dark-600 pl-3.5"
              }
            `}
          >
            <span className="text-sm leading-none flex-shrink-0 opacity-80">{cat.emoji}</span>
            <span className="truncate text-left leading-snug">{cat.name}</span>
            {isActive && (
              <span className="ml-auto w-1 h-1 rounded-full bg-white/60 flex-shrink-0" />
            )}
          </button>
        );
      })}
    </>
  );
}
