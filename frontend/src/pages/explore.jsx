import { useState, useEffect, useRef, useCallback } from "react";
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
import { ChevronLeft, ChevronRight } from "lucide-react";

const DOCS_PER_PAGE = 10;
const CATEGORIES_PER_LOAD = 3;
const MAX_DOCS = 30;

export default function Explore() {
  const router = useRouter();
  
  const [categoriesData, setCategoriesData] = useState({});
  const [loadedCategories, setLoadedCategories] = useState(0);
  const [loading, setLoading] = useState(true);
  const [categoryLoading, setCategoryLoading] = useState({});
  const scrollRefs = useRef({});
  const observerRef = useRef(null);
  const categoryObserverRef = useRef(null);

  const categories = [
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

  // Load initial categories
  useEffect(() => {
    loadNextCategories();
  }, []);

  // Setup intersection observer for loading more categories
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && loadedCategories < categories.length) {
          loadNextCategories();
        }
      },
      { threshold: 0.5 }
    );

    if (categoryObserverRef.current) {
      observer.observe(categoryObserverRef.current);
    }

    return () => observer.disconnect();
  }, [loadedCategories]);

  const loadNextCategories = async () => {
    if (loadedCategories >= categories.length) return;

    const nextCategories = categories.slice(
      loadedCategories,
      loadedCategories + CATEGORIES_PER_LOAD
    );

    setLoading(loadedCategories === 0);

    try {
      await Promise.all(
        nextCategories.map((category) => loadCategoryDocuments(category.id, 0))
      );
      setLoadedCategories((prev) => prev + nextCategories.length);
    } catch (error) {
      toast.error("Failed to load categories");
    } finally {
      setLoading(false);
    }
  };

  const loadCategoryDocuments = async (categoryId, offset) => {
    try {
      const response = await apiService.getFeed({
        limit: DOCS_PER_PAGE,
        offset: offset,
        category: categoryId,
        sort: "relevant",
      });

      const newDocs = response.data.documents || [];

      setCategoriesData((prev) => {
        const existingDocs = prev[categoryId]?.documents || [];
        const existingIds = new Set(existingDocs.map(doc => doc._id));
        
        const uniqueNewDocs = newDocs.filter(doc => !existingIds.has(doc._id));
        const allDocs = [...existingDocs, ...uniqueNewDocs];

        return {
          ...prev,
          [categoryId]: {
            documents: allDocs,
            hasMore: newDocs.length === DOCS_PER_PAGE && allDocs.length < MAX_DOCS,
            offset: offset + DOCS_PER_PAGE,
          },
        };
      });
    } catch (error) {
      console.error(`Failed to load documents for ${categoryId}:`, error);
      setCategoriesData((prev) => ({
        ...prev,
        [categoryId]: {
          documents: prev[categoryId]?.documents || [],
          hasMore: false,
          offset: offset,
        },
      }));
    }
  };

  const handleScroll = useCallback((categoryId) => {
    const container = scrollRefs.current[categoryId];
    if (!container) return;

    const { scrollLeft, scrollWidth, clientWidth } = container;
    const isNearEnd = scrollLeft + clientWidth >= scrollWidth - 200;

    const categoryData = categoriesData[categoryId];
    if (
      isNearEnd &&
      categoryData?.hasMore &&
      !categoryLoading[categoryId]
    ) {
      setCategoryLoading((prev) => ({ ...prev, [categoryId]: true }));
      loadCategoryDocuments(categoryId, categoryData.offset).finally(() => {
        setCategoryLoading((prev) => ({ ...prev, [categoryId]: false }));
      });
    }
  }, [categoriesData, categoryLoading]);

  const handleSearch = (query) => {
    const trimmed = query.trim();
    if (trimmed) {
      router.push(`/search?q=${encodeURIComponent(trimmed)}`);
    }
  };

  const scroll = (categoryId, direction) => {
    const container = scrollRefs.current[categoryId];
    if (container) {
      const scrollAmount = 800;
      container.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth'
      });
    }
  };

  const visibleCategories = categories.slice(0, loadedCategories);

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
          <div className="max-w-7xl mx-auto">
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

        {/* Categories Section */}
        <section className="pb-32 px-6">
          <div className="max-w-7xl mx-auto space-y-12">
            {loading && loadedCategories === 0 ? (
              // Initial loading state
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="space-y-4">
                  <div className="h-8 w-48 bg-dark-800 rounded animate-pulse"></div>
                  <div className="flex gap-6 overflow-hidden">
                    {Array.from({ length: 6 }).map((_, j) => (
                      <DocumentSkeleton key={j} />
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <>
                {visibleCategories.map((category) => {
                  const categoryData = categoriesData[category.id] || { documents: [], hasMore: false };
                  const documents = categoryData.documents;
                  
                  return (
                    <div key={category.id} className="space-y-4">
                      {/* Category Header */}
                      <div className="flex items-center justify-between">
                        <h2 className="text-2xl font-bold">{category.name}</h2>
                        {documents.length > 0 && (
                          <Link
                            href={`/category/${category.id}`}
                            className="text-sm text-dark-300 hover:text-white transition-colors flex items-center gap-1"
                          >
                            View All
                            <ChevronRight className="w-4 h-4" />
                          </Link>
                        )}
                      </div>

                      {/* Documents Carousel */}
                      {documents.length > 0 ? (
                        <div className="relative group">
                          {/* Scroll Buttons */}
                          <button
                            onClick={() => scroll(category.id, 'left')}
                            className="absolute left-0 top-1/2 -translate-y-1/2 z-10 bg-dark-900/90 hover:bg-dark-800 p-3 rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
                            aria-label="Scroll left"
                          >
                            <ChevronLeft className="w-5 h-5" />
                          </button>
                          
                          <button
                            onClick={() => scroll(category.id, 'right')}
                            className="absolute right-0 top-1/2 -translate-y-1/2 z-10 bg-dark-900/90 hover:bg-dark-800 p-3 rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
                            aria-label="Scroll right"
                          >
                            <ChevronRight className="w-5 h-5" />
                          </button>

                          {/* Scrollable Container */}
                          <div
                            ref={(el) => (scrollRefs.current[category.id] = el)}
                            className="flex gap-6 overflow-x-auto scrollbar-hide scroll-smooth pb-4"
                            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                            onScroll={() => handleScroll(category.id)}
                          >
                            {documents.map((doc) => (
                              <div key={doc._id} className="flex-shrink-0">
                                <DocumentCard document={doc} />
                              </div>
                            ))}
                            
                            {/* Loading indicator for more documents */}
                            {categoryLoading[category.id] && (
                              <>
                                {Array.from({ length: 3 }).map((_, i) => (
                                  <div key={`loading-${i}`} className="flex-shrink-0">
                                    <DocumentSkeleton />
                                  </div>
                                ))}
                              </>
                            )}
                          </div>
                        </div>
                      ) : (
                        // Empty state
                        <div className="border-2 border-dashed border-dark-700 rounded-lg p-12 text-center">
                          <svg
                            className="w-16 h-16 mx-auto mb-4 text-dark-600"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={1.5}
                              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                            />
                          </svg>
                          <p className="text-dark-400 text-lg">
                            No documents available in this category yet
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Observer target for loading more categories */}
                {loadedCategories < categories.length && (
                  <div
                    ref={categoryObserverRef}
                    className="space-y-4 py-8"
                  >
                    {Array.from({ length: 2 }).map((_, i) => (
                      <div key={i} className="space-y-4">
                        <div className="h-8 w-48 bg-dark-800 rounded animate-pulse"></div>
                        <div className="flex gap-6 overflow-hidden">
                          {Array.from({ length: 6 }).map((_, j) => (
                            <DocumentSkeleton key={j} />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </section>

        <Footer />
      </div>

      <style jsx>{`
        .scrollbar-hide::-webkit-scrollbar {
          display: none;
        }
      `}</style>
    </>
  );
}