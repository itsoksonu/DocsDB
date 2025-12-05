import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import { DesktopNavbar } from "../../components/layout/DesktopNavbar";
import { SearchBar } from "../../components/ui/SearchBar";
import { DocumentCard } from "../../components/common/DocumentCard";
import { DocumentSkeleton } from "../../components/ui/Skeleton";
import { apiService } from "../../services/api";
import toast from "react-hot-toast";
import Link from "next/link";
import Footer from "../../components/layout/Footer";

export default function CategoryPage() {
  const router = useRouter();
  const { category } = router.query;

  // State
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true); 
  const [loadingMore, setLoadingMore] = useState(false); 
  const [hasMore, setHasMore] = useState(true);
  const [totalResults, setTotalResults] = useState(0);

  // Refs
  const cursorRef = useRef(null); 
  const sentinelRef = useRef(null); 
  const isLoadingRef = useRef(false); 

  const categories = {
    "technology": "Technology",
    "business": "Business",
    "education": "Education",
    "health": "Health",
    "entertainment": "Entertainment",
    "sports": "Sports",
    "finance-money-management": "Finance",
    "games-activities": "Games",
    "comics": "Comics",
    "philosophy": "Philosophy",
    "career-growth": "Career",
    "politics": "Politics",
    "biography-memoir": "Biography",
    "study-aids-test-prep": "Study Aids",
    "law": "Law",
    "art": "Art",
    "science": "Science",
    "history": "History",
    "erotica": "Erotica",
    "lifestyle": "Lifestyle",
    "religion-spirituality": "Religion",
    "self-improvement": "Self Improvement",
    "language-arts": "Language Arts",
    "cooking-food-wine": "Cooking",
    "true-crime": "True Crime",
    "sheet-music": "Sheet Music",
    "fiction": "Fiction",
    "non-fiction": "Non-Fiction",
    "science-fiction": "Science Fiction",
    "fantasy": "Fantasy",
    "romance": "Romance",
    "thriller-suspense": "Thriller",
    "horror": "Horror",
    "poetry": "Poetry",
    "graphic-novels": "Graphic Novels",
    "young-adult": "Young Adult",
    "children": "Children",
    "parenting-family": "Parenting",
    "marketing-sales": "Marketing",
    "psychology": "Psychology",
    "social-sciences": "Social Sciences",
    "engineering": "Engineering",
    "mathematics": "Mathematics",
    "data-science": "Data Science",
    "news-media": "News & Media",
    "nature-environment": "Nature",
    "travel": "Travel",
    "reference": "Reference",
    "design": "Design",
    "professional-development": "Professional Dev",
    "other": "Other",
  };

  const categoryName = categories[category] || category;

  const loadDocuments = useCallback(async (reset = false) => {
    if (!category || isLoadingRef.current) return;

    try {
      isLoadingRef.current = true;

      if (reset) {
        setLoading(true);
        cursorRef.current = null; 
      } else {
        setLoadingMore(true);
      }

      const params = {
        category: category,
        limit: 20, 
        sort: "relevent",
      };

      if (cursorRef.current) {
        params.cursor = cursorRef.current;
      }

      const response = await apiService.getFeed(params);
      
      const newDocs = response.data.documents || [];
      const pagination = response.data.pagination || {};

      if (reset) {
        setDocuments(newDocs);
        if (newDocs.length === 0) setHasMore(false);
      } 
      else {
        if (newDocs.length > 0) {
          setDocuments((prev) => {
            const existingIds = new Set(prev.map(d => d._id));
            const unique = newDocs.filter(d => !existingIds.has(d._id));
            return [...prev, ...unique];
          });
        }
      }

      if (pagination.total !== undefined) {
        setTotalResults(pagination.total);
      }

      cursorRef.current = pagination.nextCursor || null;
      setHasMore(pagination.hasMore || false);

    } catch (error) {
      toast.error("Failed to load documents");
      console.error("Load error:", error);
    } finally {
      setLoading(false);
      setLoadingMore(false);
      isLoadingRef.current = false;
    }
  }, [category]);

  useEffect(() => {
    if (category) {
      setDocuments([]);
      setTotalResults(0);
      setHasMore(true);
      cursorRef.current = null;
      loadDocuments(true); 
    }
  }, [category, loadDocuments]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    
    if (loading || loadingMore || !hasMore || !sentinel) return;

    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        loadDocuments(false);
      }
    }, {
      rootMargin: "200px", 
      threshold: 0.1
    });

    observer.observe(sentinel);

    return () => {
      if (sentinel) observer.unobserve(sentinel);
    };
  }, [loading, loadingMore, hasMore, loadDocuments]);

  const handleSearch = (query) => {
    const trimmed = query.trim();
    if (trimmed) {
      router.push(`/search?q=${encodeURIComponent(trimmed)}`);
    }
  };

  return (
    <>
      <Head>
        <title>{categoryName} - DocsDB</title>
        <meta name="description" content={`Browse ${categoryName} documents`} />
      </Head>

      <div className="min-h-screen bg-dark-950 text-white">
        <DesktopNavbar onSearch={handleSearch} />

        {/* Header Section */}
        <section className="pt-32 pb-12 px-6">
          <div className="max-w-7xl mx-auto">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-8">
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <Link href="/explore" className="text-dark-400 hover:text-white transition-colors">
                    Explore
                  </Link>
                  <span className="text-dark-600">/</span>
                  <span className="text-white">{categoryName}</span>
                </div>
                
                <h1 className="text-4xl md:text-5xl font-bold mb-4 bg-gradient-to-br from-white to-gray-300 bg-clip-text">
                  {categoryName}
                </h1>
                
                {/* Total Count Display */}
                {!loading && (
                  <p className="text-xl text-dark-300">
                    {totalResults > 0 
                      ? `${totalResults.toLocaleString()} document${totalResults !== 1 ? 's' : ''}`
                      : 'No documents yet'}
                  </p>
                )}
              </div>
              
              <Link 
                href="/explore"
                className="mt-4 md:mt-0 inline-flex items-center px-6 py-3 border border-dark-600 text-dark-300 rounded-lg hover:bg-dark-800 hover:text-white transition-all"
              >
                Back to Explore
              </Link>
            </div>

            <div className="max-w-2xl">
              <SearchBar onSearch={handleSearch} placeholder="Search in category..." className="w-full" />
            </div>
          </div>
        </section>

        {/* Documents Grid */}
        <section className="max-w-7xl mx-auto px-6 pb-32">
          {loading ? (
            // Initial Loading Skeletons
            <div className="flex flex-wrap gap-6 justify-center">
              {Array.from({ length: 12 }).map((_, i) => (
                <DocumentSkeleton key={i} />
              ))}
            </div>
          ) : (
            <>
              {documents.length > 0 ? (
                <>
                  <div className="flex flex-wrap gap-6 justify-center">
                    {documents.map((doc) => (
                      <DocumentCard key={doc._id} document={doc} />
                    ))}
                  </div>

                  {/* Sentinel Element - Invisible Trigger for Infinite Scroll */}
                  {hasMore && !loadingMore && (
                    <div ref={sentinelRef} className="w-full h-10 -mt-20 opacity-0 pointer-events-none" />
                  )}

                  {/* Pagination Loading Skeletons */}
                  {loadingMore && (
                    <div className="flex flex-wrap gap-6 justify-center mt-6">
                      {Array.from({ length: 6 }).map((_, i) => (
                        <DocumentSkeleton key={`more-${i}`} />
                      ))}
                    </div>
                  )}

                  {/* End of List Message */}
                  {!hasMore && documents.length > 0 && (
                    <div className="text-center py-12 w-full">
                      <p className="text-dark-400">You've reached the end</p>
                    </div>
                  )}
                </>
              ) : (
                // Empty State
                <div className="text-center py-20">
                  <div className="text-dark-700 mb-6">
                    <svg className="w-24 h-24 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                    </svg>
                  </div>
                  <h2 className="text-2xl font-semibold mb-2">No documents found</h2>
                  <p className="text-dark-400">This category is currently empty.</p>
                </div>
              )}
            </>
          )}
        </section>

        <Footer />
      </div>
    </>
  );
}