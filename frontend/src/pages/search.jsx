// src/pages/search.jsx
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

export default function SearchPage() {
  const { user } = useAuth();
  const router = useRouter();
  const { q, category, type } = router.query;

  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState(q || "");
  const [selectedCategory, setSelectedCategory] = useState(category || "");
  const [searchType, setSearchType] = useState(type || "keyword");
  const [totalResults, setTotalResults] = useState(0);
  const observer = useRef();

  const categories = [
    { id: "", name: "All Categories" },
    { id: "technology", name: "Technology" },
    { id: "business", name: "Business" },
    { id: "education", name: "Education" },
    { id: "health", name: "Health" },
    { id: "entertainment", name: "Entertainment" },
    { id: "sports", name: "Sports" },
    { id: "finance-money-management", name: "Finance" },
    { id: "science", name: "Science" },
    { id: "art", name: "Art" },
    { id: "history", name: "History" },
    { id: "other", name: "Other" },
  ];

  const performSearch = useCallback(
    async (reset = false) => {
      if (!searchQuery.trim()) {
        setDocuments([]);
        setLoading(false);
        return;
      }

      try {
        if (reset) {
          setLoading(true);
          setPage(1);
        } else {
          setLoadingMore(true);
        }

        const params = {
          q: searchQuery,
          type: searchType,
          category: selectedCategory || undefined,
          page: reset ? 1 : page,
          limit: 20,
        };

        const response = await apiService.searchDocuments(params);
        const { documents: newDocs, pagination } = response.data;

        if (reset) {
          setDocuments(newDocs);
        } else {
          setDocuments((prev) => [...prev, ...newDocs]);
        }

        setTotalResults(pagination.total);
        setHasMore(pagination.hasMore);
        setPage((prev) => (reset ? 2 : prev + 1));
      } catch (error) {
        toast.error("Failed to search documents");
        console.error("Search error:", error);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [searchQuery, searchType, selectedCategory, page]
  );

  const lastDocumentRef = useCallback(
    (node) => {
      if (loadingMore) return;
      if (observer.current) observer.current.disconnect();

      observer.current = new IntersectionObserver(
        debounce((entries) => {
          if (entries[0].isIntersecting && hasMore) performSearch(false);
        }, 300)
      );

      if (node) observer.current.observe(node);
    },
    [loadingMore, hasMore, performSearch]
  );

  useEffect(() => {
    if (q) {
      setSearchQuery(q);
    }
  }, [q]);

  useEffect(() => {
    if (category) {
      setSelectedCategory(category);
    }
  }, [category]);

  useEffect(() => {
    if (type) {
      setSearchType(type);
    }
  }, [type]);

  useEffect(() => {
    performSearch(true);
  }, [searchQuery, selectedCategory, searchType]);

  const handleSearch = (query) => {
    const trimmed = query.trim();
    if (trimmed && trimmed !== router.query.q) {
      router.push({
        pathname: "/search",
        query: {
          q: encodeURIComponent(trimmed),
          ...(selectedCategory && { category: selectedCategory }),
          type: searchType,
        },
      });
    }
  };

  const handleCategoryChange = (categoryId) => {
    setSelectedCategory(categoryId);
    router.push({
      pathname: "/search",
      query: {
        q: searchQuery,
        ...(categoryId && { category: categoryId }),
        type: searchType,
      },
    });
  };

  const handleTypeChange = (newType) => {
    setSearchType(newType);
    router.push({
      pathname: "/search",
      query: {
        q: searchQuery,
        ...(selectedCategory && { category: selectedCategory }),
        type: newType,
      },
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
        <title>
          {searchQuery ? `Search: ${searchQuery}` : "Search"} - DocsDB
        </title>
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
                  Search Results for "{searchQuery}"
                </h1>
                {!loading && (
                  <p className="text-dark-300">
                    Found {totalResults.toLocaleString()} results
                  </p>
                )}
              </div>
            )}

            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-4 items-center justify-between max-w-5xl mx-auto">
              {/* Search Type Toggle */}
              <div className="flex gap-2 bg-dark-800 rounded-lg p-1 border border-dark-600">
                <button
                  onClick={() => handleTypeChange("keyword")}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                    searchType === "keyword"
                      ? "bg-white text-dark-900"
                      : "text-dark-300 hover:text-white"
                  }`}
                >
                  Keyword
                </button>
                <button
                  onClick={() => handleTypeChange("semantic")}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                    searchType === "semantic"
                      ? "bg-white text-dark-900"
                      : "text-dark-300 hover:text-white"
                  }`}
                >
                  Semantic
                </button>
              </div>

              {/* Category Filter */}
              <div className="flex items-center gap-2">
                <label className="text-sm text-dark-300">Category:</label>
                <select
                  value={selectedCategory}
                  onChange={(e) => handleCategoryChange(e.target.value)}
                  className="bg-dark-800 border border-dark-600 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-white/20"
                >
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
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
                    <div className="text-center py-12">
                      <p className="text-dark-400">You've reached the end</p>
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
    </>
  );
}
