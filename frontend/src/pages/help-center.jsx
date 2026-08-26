import Head from "next/head";
import { useState } from "react";
import { DesktopNavbar } from "../components/layout/DesktopNavbar";
import Footer from "../components/layout/Footer";
import Link from "next/link";
import { Search } from "../icons";

// FAQ Data
const faqData = [
  {
    category: "General",
    items: [
      {
        question: "What is DocsDB?",
        answer:
          "DocsDB is a platform for discovering, sharing, and organizing knowledge documents. We aim to connect researchers, students, and professionals with the high-quality resources they need.",
      },
      {
        question: "Is DocsDB free to use?",
        answer:
          "Yes, DocsDB is free to use for searching into documents. However, you need to sign in to access advanced features like uploading and saving documents.",
      },
    ],
  },
  {
    category: "Account & Profile",
    items: [
      {
        question: "How do I create an account?",
        answer:
          "You can create an account by clicking the 'Sign In' button in the top right corner. We support authentication via Google for a seamless experience.",
      },
      {
        question: "Can I edit my profile?",
        answer:
          "Yes, you can edit your profile by navigating to your Profile page and clicking on the 'Edit Profile' button. You can update your display name and bio.",
      },
    ],
  },
  {
    category: "Documents & Uploads",
    items: [
      {
        question: "How do I upload a document?",
        answer:
          "To upload a document, click the 'Upload' button in the navigation bar. You can then drag and drop your file or select it from your device. Please ensure your document follows our content guidelines.",
      },
      {
        question: "What file formats are supported?",
        answer:
          "We currently support PDF, DOCX, PPTX, XLSX, and CSV files. We are working on adding support for more formats in the future.",
      },
      {
        question: "How do I delete my document?",
        answer:
          "You can delete your documents from your Profile page. Find the document you want to remove in your 'Uploaded' tab and click the delete icon.",
      },
    ],
  },
  {
    category: "Privacy & Safety",
    items: [
      {
        question: "Is my data secure?",
        answer:
          "We take data security seriously. We use industry-standard encryption and security measures to protect your personal information and documents.",
      },
      {
        question: "How can I report a policy violation?",
        answer:
          "If you find content that violates our terms or policies, please contact us immediately via the 'Contact Us' page or the 'Report' button on the document page.",
      },
    ],
  },
];

const AccordionItem = ({ question, answer, isOpen, onClick }) => {
  return (
    <div className="border border-dark-800 rounded-xl overflow-hidden bg-dark-900 mb-4 transition-all duration-200">
      <button
        className="w-full px-6 py-4 text-left flex items-center justify-between focus:outline-none hover:bg-dark-800 transition-colors"
        onClick={onClick}
      >
        <span className="font-semibold text-white">{question}</span>
        <span
          className={`transform transition-transform duration-200 text-dark-400 ${
            isOpen ? "rotate-180" : ""
          }`}
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </span>
      </button>
      <div
        className={`transition-all duration-300 ease-in-out ${
          isOpen ? "max-h-96 opacity-100" : "max-h-0 opacity-0"
        } overflow-hidden`}
      >
        <div className="px-6 pb-4 text-dark-300 leading-relaxed">{answer}</div>
      </div>
    </div>
  );
};

export default function HelpCenter() {
  const [searchQuery, setSearchQuery] = useState("");
  const [openItems, setOpenItems] = useState({});

  const toggleItem = (categoryIndex, itemIndex) => {
    const key = `${categoryIndex}-${itemIndex}`;
    setOpenItems((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const filteredData = faqData
    .map((category) => ({
      ...category,
      items: category.items.filter(
        (item) =>
          item.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
          item.answer.toLowerCase().includes(searchQuery.toLowerCase())
      ),
    }))
    .filter((category) => category.items.length > 0);

  return (
    <>
      <Head>
        <title>Help Center - DocsDB</title>
        <meta
          name="description"
          content="Find answers to common questions about DocsDB in our Help Center."
        />
      </Head>

      <div className="min-h-screen bg-dark-950 text-white flex flex-col">
        <DesktopNavbar />

        <main className="flex-grow pt-32 pb-16 px-6">
          {/* Hero Section */}
          <section className="text-center mb-16 max-w-4xl mx-auto">
            <h1 className="font-literature text-4xl md:text-5xl font-bold mb-6">
              How can we help you?
            </h1>
            <p className="text-dark-200 text-lg mb-8">
              Search our knowledge base or browse frequently asked questions.
            </p>

            <div className="relative max-w-xl mx-auto">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <svg
                  className="w-5 h-5 text-dark-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
              </div>
              <input
                type="text"
                placeholder="Search for answers..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-12 pr-4 py-4 bg-dark-900 border border-dark-700 rounded-xl text-white placeholder-dark-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all shadow-lg"
              />
            </div>
          </section>

          {/* FAQ Sections */}
          <div className="max-w-3xl mx-auto space-y-12">
            {filteredData.length > 0 ? (
              filteredData.map((category, catIndex) => (
                <div key={catIndex} className="animate-fade-in">
                  <h2 className="text-2xl font-semibold mb-6 flex items-center gap-3 text-white">
                    {category.category}
                  </h2>
                  <div className="space-y-2">
                    {category.items.map((item, itemIndex) => (
                      <AccordionItem
                        key={itemIndex}
                        question={item.question}
                        answer={item.answer}
                        isOpen={!!openItems[`${catIndex}-${itemIndex}`]}
                        onClick={() => toggleItem(catIndex, itemIndex)}
                      />
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-12">
                <p className="text-dark-300 text-lg">
                  No results found for &ldquo;{searchQuery}&rdquo;.
                </p>
                <p className="text-dark-400 mt-2">
                  Try searching for something else or browse categories.
                </p>
              </div>
            )}
          </div>

          {/* Contact Support */}
          <section className="mt-20 text-center max-w-2xl mx-auto animate-fade-in-up">
            <div className="bg-dark-900 border border-dark-800 rounded-2xl p-8 md:p-12">
              <h3 className="text-2xl font-bold text-white mb-4">
                Still need help?
              </h3>
              <p className="text-dark-300 mb-8">
                Can&apos;t find what you&apos;re looking for? Our support team is here to
                assist you.
              </p>
              <Link
                href="/contact"
                className="inline-flex items-center justify-center px-8 py-3 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white font-semibold rounded-xl transition-all duration-200 transform hover:scale-[1.02] shadow-lg shadow-blue-500/20"
              >
                Contact Support
              </Link>
            </div>
          </section>
        </main>

        <Footer />
      </div>
    </>
  );
}
