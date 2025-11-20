import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import { DesktopNavbar } from "../components/layout/DesktopNavbar";
import { SearchBar } from "../components/ui/SearchBar";
import { DocumentCard } from "../components/common/DocumentCard";
import { DocumentSkeleton } from "../components/ui/Skeleton";
import { apiService } from "../services/api";
import toast from "react-hot-toast";
import Link from "next/link";
import Footer from "../components/layout/Footer";

export default function Explore() {
  const router = useRouter();
  const { category } = router.query;
  
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState(category || "all");
  const [sortBy, setSortBy] = useState("newest");

  const categories = [
    { id: "all", name: "All Documents" },
    { id: "technology", name: "Technology" },
    { id: "business", name: "Business" },
    { id: "education", name: "Education" },
    { id: "science", name: "Science" },
    { id: "research", name: "Research Papers" },
    { id: "academic", name: "Academic Journals" },
    { id: "finance", name: "Finance & Money Management" },
    { id: "health", name: "Health" },
    { id: "fiction", name: "Fiction" },
    { id: "non-fiction", name: "Non-Fiction" },
    { id: "politics", name: "Politics" },
    { id: "history", name: "History" },
    { id: "art", name: "Art" },
    { id: "design", name: "Design" },
  ];

  const sortOptions = [
    { id: "newest", name: "Newest First" },
    { id: "popular", name: "Most Popular" },
    { id: "relevant", name: "Most Relevant" },
    { id: "title", name: "Title A-Z" },
  ];

  const loadDocuments = useCallback(async () => {
    try {
      setLoading(true);
      
      const params = {
        limit: 50,
        category: selectedCategory === "all" ? null : selectedCategory,
        sort: sortBy,
      };

      const response = await apiService.getFeed(params);
      setDocuments(response.data.documents);
    } catch (error) {
      toast.error("Failed to load documents");
    } finally {
      setLoading(false);
    }
  }, [selectedCategory, sortBy]);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  useEffect(() => {
    if (category && category !== selectedCategory) {
      setSelectedCategory(category);
    }
  }, [category, selectedCategory]);

  const handleSearch = (query) => {
    const trimmed = query.trim();
    if (trimmed) {
      router.push(`/search?q=${encodeURIComponent(trimmed)}`);
    }
  };

  const handleCategoryChange = (categoryId) => {
    setSelectedCategory(categoryId);
    router.push(`/explore${categoryId !== 'all' ? `?category=${categoryId}` : ''}`, undefined, { shallow: true });
  };

  return (
    <>
      <Head>
        <title>Explore All Documents - DocsDB</title>
        <meta
          name="description"
          content="Explore thousands of documents across all categories on DocsDB."
        />
      </Head>

      <div className="min-h-screen bg-dark-950 text-white">
        <DesktopNavbar onSearch={handleSearch} />

        {/* Header */}
        <section className="pt-32 pb-16 px-6">
          <div className="max-w-6xl mx-auto">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-8">
              <div>
                <h1 className="text-4xl md:text-5xl font-bold mb-4 bg-gradient-to-br from-white to-gray-300 bg-clip-text">
                  Explore All Documents
                </h1>
                <p className="text-xl text-dark-300 max-w-2xl">
                  Discover thousands of documents, research papers, and resources across all categories.
                </p>
              </div>
              
              <Link 
                href="/"
                className="mt-4 md:mt-0 inline-flex items-center px-6 py-3 border border-dark-600 text-dark-300 rounded-lg hover:bg-dark-800 hover:text-white transition-all"
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                Back to Home
              </Link>
            </div>

            {/* Search Bar */}
            <div className="max-w-2xl">
              <SearchBar
                onSearch={handleSearch}
                placeholder="Search specific documents..."
                className="w-full"
              />
            </div>
          </div>
        </section>

        {/* Filters */}
        <section className="pb-12 px-6">
          <div className="max-w-6xl mx-auto">
            <div className="flex flex-col md:flex-row gap-6 justify-between items-start md:items-center">
              {/* Categories */}
              <div className="flex-1">
                <h3 className="text-lg font-semibold mb-3">Categories</h3>
                <div className="flex flex-wrap gap-2">
                  {categories.map((category) => (
                    <button
                      key={category.id}
                      onClick={() => handleCategoryChange(category.id)}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
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

              {/* Sort */}
              <div>
                <h3 className="text-lg font-semibold mb-3">Sort By</h3>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="bg-dark-800 border border-dark-600 text-white rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-white"
                >
                  {sortOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </section>

        {/* Documents Grid */}
        <section className="max-w-7xl mx-auto px-6 pb-32">
          {loading ? (
            <div className="flex flex-wrap gap-6 justify-center">
              {Array.from({ length: 24 }).map((_, i) => (
                <DocumentSkeleton key={i} />
              ))}
            </div>
          ) : (
            <>
              <div className="flex justify-between items-center mb-8">
                <p className="text-dark-300">
                  Showing {documents.length} documents
                  {selectedCategory !== 'all' && ` in ${categories.find(c => c.id === selectedCategory)?.name}`}
                </p>
              </div>

              <div className="flex flex-wrap gap-6 justify-center">
                {documents.map((doc) => (
                  <DocumentCard key={doc._id} document={doc} />
                ))}
              </div>

              {documents.length === 0 && (
                <div className="text-center py-20">
                  <p className="text-dark-400 text-lg">No documents found in this category</p>
                  <button
                    onClick={() => handleCategoryChange('all')}
                    className="mt-4 px-6 py-3 bg-white text-dark-900 rounded-lg font-semibold hover:bg-gray-100 transition-colors"
                  >
                    Browse All Documents
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </div>
         {/* Footer Section */}
        <Footer />
    </>
  );
}