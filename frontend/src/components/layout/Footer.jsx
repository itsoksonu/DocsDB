"use client";

import Link from "next/link";
import { useRouter } from "next/router";
import { useState, useEffect } from "react";
import toast from "react-hot-toast";
import { useAuth } from "../../contexts/AuthContext";
import { useGoogleAuth } from "../../hooks/useGoogleAuth";
import { Logo } from "../../icons";

const Footer = () => {
  const { user, handleGoogleOAuth } = useAuth();
  const router = useRouter();
  const { isGoogleLoaded, initializeGoogleOneTap, promptGoogleOneTap } =
    useGoogleAuth();
  const [signingIn, setSigningIn] = useState(false);

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
      // After successful sign-in, redirect to upload if that was the intent
      router.push("/upload");
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

  const handleUpload = (e) => {
    e.preventDefault();
    if (!user) {
      handleSignIn();
    } else {
      router.push("/upload");
    }
  };

  return (
    <footer className="bg-dark-950 border-t border-dark-800 py-12">
      <div className="max-w-6xl mx-auto px-6">
        {/* Footer Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Left Section */}
          <div className="md:col-span-2">
            <div className="flex items-center justify-start gap-2 mb-4">
              <Logo />
              <h3 className="text-2xl font-bold">DocsDB</h3>
            </div>

            <p className="text-dark-300 max-w-md">
              The premier platform for discovering, sharing, and organizing
              knowledge documents. Join our community of researchers, students,
              and professionals.
            </p>
          </div>

          {/* Quick Links */}
          <div>
            <h4 className="font-semibold mb-4 text-white">Quick Links</h4>
            <ul className="space-y-2 text-dark-300">
              <li>
                <Link
                  href="/explore"
                  className="hover:text-white transition-colors"
                >
                  Explore Documents
                </Link>
              </li>
              <li>
                <button
                  onClick={handleUpload}
                  className="hover:text-white transition-colors text-left"
                >
                  Upload Document
                </button>
              </li>
              <li>
                <Link
                  href="/about"
                  className="hover:text-white transition-colors"
                >
                  About Us
                </Link>
              </li>
              <li>
                <Link
                  href="/help-center"
                  className="hover:text-white transition-colors"
                >
                  Help Center
                </Link>
              </li>
              <li>
                <Link
                  href="/report"
                  className="hover:text-white transition-colors"
                >
                  Report Issue
                </Link>
              </li>
              <li>
                <Link
                  href="/contact"
                  className="hover:text-white transition-colors"
                >
                  Contact
                </Link>
              </li>
            </ul>
          </div>

          {/* Legal Links */}
          <div>
            <h4 className="font-semibold mb-4 text-white">Legal</h4>
            <ul className="space-y-2 text-dark-300">
              <li>
                <Link
                  href="/privacy"
                  className="hover:text-white transition-colors"
                >
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link
                  href="/terms"
                  className="hover:text-white transition-colors"
                >
                  Terms of Service
                </Link>
              </li>
              <li>
                <Link
                  href="/copyright"
                  className="hover:text-white transition-colors"
                >
                  Copyright
                </Link>
              </li>
              <li>
                <Link
                  href="/dmca"
                  className="hover:text-white transition-colors"
                >
                  DMCA
                </Link>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom Section */}
        <div className="border-t border-dark-800 mt-8 pt-8 text-center text-dark-400">
          <p>&copy; {new Date().getFullYear()} DocsDB. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
