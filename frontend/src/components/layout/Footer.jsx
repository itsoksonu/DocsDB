"use client";

import Link from "next/link";
import { Logo } from "../../icons";

const Footer = () => {
  return (
    <footer className="bg-dark-950 border-t border-dark-800 py-12">
      <div className="max-w-6xl mx-auto px-6">
        {/* Footer Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Left Section */}
          <div className="md:col-span-2">
            <div className="flex items-center justify-start gap-2 mb-4">
              <Logo />
              <h3 className="text-2xl font-bold bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
                DocsDB
              </h3>
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
                <Link href="/explore" className="hover:text-white transition-colors">
                  Explore Documents
                </Link>
              </li>
              <li>
                <Link href="/upload" className="hover:text-white transition-colors">
                  Upload Document
                </Link>
              </li>
              <li>
                <Link href="/about" className="hover:text-white transition-colors">
                  About Us
                </Link>
              </li>
              <li>
                <Link href="/contact" className="hover:text-white transition-colors">
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
                <Link href="/privacy" className="hover:text-white transition-colors">
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link href="/terms" className="hover:text-white transition-colors">
                  Terms of Service
                </Link>
              </li>
              <li>
                <Link href="/copyright" className="hover:text-white transition-colors">
                  Copyright
                </Link>
              </li>
              <li>
                <Link href="/dmca" className="hover:text-white transition-colors">
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
