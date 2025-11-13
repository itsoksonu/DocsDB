// src/components/layout/DesktopNavbar.jsx
import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { useAuth } from "../../contexts/AuthContext";
import { Dropdown, DropdownItem } from "../ui/Dropdown";
import { SearchBar } from "../ui/SearchBar";
import { Upload, User, LogOut, HelpCircle, Flag, Bookmark } from "../../icons";
import toast from "react-hot-toast";
import { useGoogleAuth } from "../../hooks/useGoogleAuth";

export const DesktopNavbar = ({
  showSearch = false,
  onSearch,
  onUploadClick,
}) => {
  const { user, logout, handleGoogleOAuth } = useAuth();
  const router = useRouter();
  const {
    isGoogleLoaded,
    initializeGoogleOneTap,
    promptGoogleOneTap,
    triggerGoogleOAuthPopup,
  } = useGoogleAuth();
  const [scrolled, setScrolled] = useState(false);
  const [showNavSearch, setShowNavSearch] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [isProfileDropdownOpen, setIsProfileDropdownOpen] = useState(false);

  useEffect(() => {
    // Check if screen is desktop size
    const checkScreenSize = () => {
      setIsDesktop(window.innerWidth >= 768); // md breakpoint
    };

    checkScreenSize();
    window.addEventListener("resize", checkScreenSize);

    return () => window.removeEventListener("resize", checkScreenSize);
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      const scrollPosition = window.scrollY;
      setScrolled(scrollPosition > 20);

      // Show search bar in navbar only on desktop when scrolled past hero section (roughly 400px)
      if (isDesktop) {
        setShowNavSearch(scrollPosition > 400);
      } else {
        setShowNavSearch(false);
      }
    };

    handleScroll(); // Call once on mount
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, [isDesktop]);

  // Default search handler
  const defaultSearchHandler = (query) => {
    const trimmed = query.trim();
    if (trimmed && trimmed !== router.query.q) {
      router.push(`/search?q=${encodeURIComponent(trimmed)}`);
    }
  };

  // Use provided onSearch or default handler
  const handleSearch = onSearch || defaultSearchHandler;

  const handleLogout = async () => {
    try {
      await logout();
      router.push("/");
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  const handleUpload = () => {
    if (!user) {
      handleSignIn();
    } else {
      onUploadClick();
    }
  };

  useEffect(() => {
    if (!user && isGoogleLoaded) {
      const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
      if (clientId) {
        initializeGoogleOneTap(clientId, handleGoogleResponse);
      }
    }
  }, [user, isGoogleLoaded]);

  const handleGoogleResponse = async (response) => {
    setSigningIn(true);
    try {
      await handleGoogleOAuth(response);
      toast.success("Signed in successfully!");
    } catch (error) {
      console.error("Google sign-in failed:", error);
      toast.error("Sign-in failed. Please try again.");
    } finally {
      setSigningIn(false);
    }
  };

  const handleSignIn = async () => {
    if (signingIn) return;

    setSigningIn(true);

    try {
      if (isGoogleLoaded) {
        promptGoogleOneTap(handleGoogleResponse);
      } else {
        toast.error("Sign-in service not ready. Please try again.");
        setSigningIn(false);
      }
    } catch (error) {
      console.error("Sign-in error:", error);
      toast.error("Failed to initialize sign-in");
      setSigningIn(false);
    }
  };

  const navigateToProfile = () => {
    router.push("/profile");
    setIsProfileDropdownOpen(false);
  };

  const navigateToSavedDocs = () => {
    router.push("/profile?tab=saved");
    setIsProfileDropdownOpen(false);
  };

  const navigateToUploadedDocs = () => {
    router.push("/profile?tab=uploaded");
    setIsProfileDropdownOpen(false);
  };

  const navigateToHelpCenter = () => {
    router.push("/help");
    setIsProfileDropdownOpen(false);
  };

  const navigateToReport = () => {
    router.push("/report");
    setIsProfileDropdownOpen(false);
  };

  const handleProfileDropdownToggle = () => {
    setIsProfileDropdownOpen(!isProfileDropdownOpen);
  };

  const handleProfileDropdownClose = () => {
    setIsProfileDropdownOpen(false);
  };

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled
          ? "bg-dark-900/80 backdrop-blur-xl border-b border-dark-700"
          : "bg-transparent"
      }`}
    >
      <div className="max-w-7xl mx-auto px-2 py-4">
        <div className="flex items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 group">
            <svg
              width="40"
              height="40"
              viewBox="0 0 256 256"
              xmlns="http://www.w3.org/2000/svg"
            >
              <circle
                cx="128"
                cy="128"
                r="88"
                stroke="white"
                strokeWidth="20"
                fill="none"
              />
              <line
                x1="88"
                y1="168"
                x2="168"
                y2="88"
                stroke="white"
                strokeWidth="20"
                strokeLinecap="round"
              />
            </svg>
            <span className="text-xl text-white font-bold">DocsDB</span>
          </Link>

          {/* Search Bar - Only shown on desktop when scrolled past hero search */}
          {showNavSearch && (
            <div className="hidden md:flex flex-1 max-w-2xl mx-8 animate-fadeIn">
              <SearchBar onSearch={handleSearch} />
            </div>
          )}

          {/* Right Side Actions */}
          <div className="flex items-center gap-4">
            {/* Upload Button */}
            <button
              onClick={handleUpload}
              className="flex items-center gap-2 px-4 py-2 bg-white hover:bg-dark-200 text-black rounded-xl transition-all duration-200 font-medium"
            >
              <Upload size={18} />
              <span className="inline">Upload</span>
            </button>

            {/* Profile Picture with Dropdown */}
            {user ? (
              <Dropdown
                trigger={
                  <button
                    onClick={handleProfileDropdownToggle}
                    className="flex items-center gap-2 p-1 hover:bg-dark-800 rounded-full border border-dark-700 transition-all duration-200"
                  >
                    {user.avatar ? (
                      <img
                        src={user.avatar}
                        alt={user.name}
                        className="w-9 h-9 rounded-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-pink-600 rounded-full flex items-center justify-center text-white text-sm font-medium">
                        {user.name?.charAt(0).toUpperCase()}
                      </div>
                    )}
                  </button>
                }
                align="right"
                isOpen={isProfileDropdownOpen}
                onClose={handleProfileDropdownClose}
              >
                {/* User Info Section */}
                <div className="px-4 py-3 border-b border-dark-600">
                  <div className="text-white font-semibold truncate max-w-[200px]">
                    {user.name}
                  </div>
                  <div className="text-dark-300 text-sm truncate max-w-[200px]">
                    {user.email}
                  </div>
                </div>

                {/* Profile Section */}
                <DropdownItem
                  onClick={navigateToProfile}
                  icon={User}
                  label="Profile"
                  className="mt-2"
                />
                <DropdownItem
                  icon={Bookmark}
                  label="Saved Docs"
                  onClick={navigateToSavedDocs}
                />
                <DropdownItem
                  icon={Upload}
                  label="Uploaded Docs"
                  onClick={navigateToUploadedDocs}
                />

                <div className="h-px bg-dark-600 my-2" />

                {/* Support Section */}
                <DropdownItem
                  icon={HelpCircle}
                  label="Help Center"
                  onClick={navigateToHelpCenter}
                />
                <DropdownItem
                  icon={Flag}
                  label="Report"
                  onClick={navigateToReport}
                />

                <div className="h-px bg-dark-600 my-2" />

                {/* Logout */}
                <DropdownItem
                  onClick={() => {
                    handleLogout();
                    handleProfileDropdownClose();
                  }}
                  icon={LogOut}
                  label="Logout"
                  className="text-red-400 hover:text-red-300 hover:bg-red-900/20 mb-2"
                />
              </Dropdown>
            ) : (
              <button
                onClick={handleSignIn}
                disabled={signingIn}
                className={`px-4 py-2 border border-dark-600 hover:border-dark-400 text-white rounded-xl transition-all duration-200 font-medium ${
                  signingIn ? "opacity-50 cursor-not-allowed" : ""
                }`}
              >
                {signingIn ? "Signing in..." : "Sign In"}
              </button>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
};
