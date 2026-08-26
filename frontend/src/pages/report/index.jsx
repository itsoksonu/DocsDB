import { useState } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import Link from "next/link";
import { DesktopNavbar } from "../../components/layout/DesktopNavbar";
import Footer from "../../components/layout/Footer";
import { useAuth } from "../../contexts/AuthContext";
import { apiService } from "../../services/api";
import toast from "react-hot-toast";
import {
  AlertCircle,
  ChevronRight,
  MessageSquare,
  Flag,
  Shield,
} from "../../icons";

const ReportCenter = () => {
  const router = useRouter();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState("overview"); // overview, bug

  // Bug Report State
  const [bugForm, setBugForm] = useState({
    subject: "",
    description: "",
    type: "bug", // or feature_request -> mapped to 'other' in backend
  });
  const [submitting, setSubmitting] = useState(false);

  const handleBugSubmit = async (e) => {
    e.preventDefault();
    if (!user) {
      toast.error("Please login to submit a report");
      router.push("/auth/login?redirect=/report");
      return;
    }

    if (!bugForm.subject.trim() || !bugForm.description.trim()) {
      toast.error("Please fill in all fields");
      return;
    }

    try {
      setSubmitting(true);
      await apiService.submitReport({
        reason: `[${bugForm.type.toUpperCase()}] ${bugForm.subject}\n\n${
          bugForm.description
        }`,
        type: "other",
        category: "system",
      });
      toast.success("Report submitted successfully!");
      setBugForm({ subject: "", description: "", type: "bug" });
      setActiveTab("overview");
    } catch (error) {
      console.error("Error submitting report:", error);
      toast.error(error.response?.data?.message || "Failed to submit report");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Head>
        <title>Report Center - DocsDB</title>
      </Head>

      <div className="min-h-screen bg-dark-950 text-white flex flex-col">
        <DesktopNavbar />

        <div className="flex-1 pt-24 pb-12 px-4">
          <div className="max-w-4xl mx-auto">
            <h1 className="font-literature text-4xl font-bold mb-4">Report Center</h1>
            <p className="text-dark-300 mb-8">
              Keep DocsDB safe and working smoothly. What would you like to
              report?
            </p>

            <div className="grid md:grid-cols-3 gap-8">
              {/* Sidebar / Navigation */}
              <div className="space-y-2">
                <button
                  onClick={() => setActiveTab("overview")}
                  className={`w-full text-left px-4 py-3 rounded-lg flex items-center justify-between transition-colors ${
                    activeTab === "overview"
                      ? "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                      : "hover:bg-dark-800 text-dark-300"
                  }`}
                >
                  <span className="font-medium">Overview</span>
                  <ChevronRight size={16} />
                </button>
                <button
                  onClick={() => setActiveTab("bug")}
                  className={`w-full text-left px-4 py-3 rounded-lg flex items-center justify-between transition-colors ${
                    activeTab === "bug"
                      ? "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                      : "hover:bg-dark-800 text-dark-300"
                  }`}
                >
                  <span className="font-medium">Report a Bug / Issue</span>
                  <ChevronRight size={16} />
                </button>
                <Link
                  href="/dmca"
                  className="w-full text-left px-4 py-3 rounded-lg flex items-center justify-between transition-colors hover:bg-dark-800 text-dark-300"
                >
                  <span className="font-medium">Copyright / DMCA</span>
                  <ChevronRight size={16} />
                </Link>
              </div>

              {/* Main Content */}
              <div className="md:col-span-2">
                {activeTab === "overview" && (
                  <div className="space-y-6">
                    <div className="bg-dark-900 border border-dark-800 rounded-xl p-6">
                      <div className="flex items-start gap-4">
                        <div className="p-3 bg-red-500/10 rounded-lg">
                          <Flag className="text-red-500" size={24} />
                        </div>
                        <div>
                          <h3 className="text-lg font-semibold mb-2">
                            Report Content
                          </h3>
                          <p className="text-dark-300 mb-4 text-sm">
                            Found a document that violates our guidelines? You
                            can report specific documents directly from their
                            page.
                          </p>
                          <div className="text-sm text-dark-400 bg-dark-800/50 p-3 rounded">
                            Go to any document page &rarr; Click the{" "}
                            <span className="inline-block px-1.5 py-0.5 bg-dark-700 rounded text-xs mx-1">
                              ...
                            </span>{" "}
                            menu &rarr; Select &ldquo;Report&rdquo;
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="bg-dark-900 border border-dark-800 rounded-xl p-6">
                      <div className="flex items-start gap-4">
                        <div className="p-3 bg-blue-500/10 rounded-lg">
                          <Shield className="text-blue-500" size={24} />
                        </div>
                        <div>
                          <h3 className="text-lg font-semibold mb-2">
                            Copyright Infringement
                          </h3>
                          <p className="text-dark-300 mb-4 text-sm">
                            If you believe your intellectual property rights
                            have been infringed, please submit a DMCA takedown
                            notice.
                          </p>
                          <button
                            onClick={() => router.push("/dmca")}
                            className="text-sm text-blue-400 hover:text-blue-300 font-medium"
                          >
                            Go to DMCA Form &rarr;
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="bg-dark-900 border border-dark-800 rounded-xl p-6">
                      <div className="flex items-start gap-4">
                        <div className="p-3 bg-green-500/10 rounded-lg">
                          <MessageSquare className="text-green-500" size={24} />
                        </div>
                        <div>
                          <h3 className="text-lg font-semibold mb-2">
                            System Issues
                          </h3>
                          <p className="text-dark-300 mb-4 text-sm">
                            Found a bug or have a suggestion? Let our technical
                            team know.
                          </p>
                          <button
                            onClick={() => setActiveTab("bug")}
                            className="text-sm text-green-400 hover:text-green-300 font-medium"
                          >
                            Report a Bug &rarr;
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === "bug" && (
                  <div className="bg-dark-900 border border-dark-800 rounded-xl p-6">
                    <h2 className="text-xl font-bold mb-6">
                      Report a Bug or Issue
                    </h2>
                    <form onSubmit={handleBugSubmit} className="space-y-6">
                      <div>
                        <label className="block text-sm font-medium text-dark-200 mb-2">
                          Type
                        </label>
                        <select
                          value={bugForm.type}
                          onChange={(e) =>
                            setBugForm({ ...bugForm, type: e.target.value })
                          }
                          className="w-full bg-dark-800 border border-dark-700 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 outline-none transition-all"
                        >
                          <option value="bug">Bug Report</option>
                          <option value="feature">Feature Request</option>
                          <option value="other">Other</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-dark-200 mb-2">
                          Subject
                        </label>
                        <input
                          type="text"
                          value={bugForm.subject}
                          onChange={(e) =>
                            setBugForm({ ...bugForm, subject: e.target.value })
                          }
                          placeholder="Brief summary of the issue"
                          className="w-full bg-dark-800 border border-dark-700 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 outline-none transition-all"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-dark-200 mb-2">
                          Description
                        </label>
                        <textarea
                          value={bugForm.description}
                          onChange={(e) =>
                            setBugForm({
                              ...bugForm,
                              description: e.target.value,
                            })
                          }
                          placeholder="Steps to reproduce, expected behavior, browser/device details..."
                          rows={6}
                          className="w-full bg-dark-800 border border-dark-700 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 outline-none transition-all resize-none"
                        />
                      </div>

                      <div className="pt-2">
                        <button
                          type="submit"
                          disabled={submitting}
                          className="w-full px-4 py-3 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-500/50 text-white rounded-lg transition-colors font-medium flex items-center justify-center gap-2"
                        >
                          {submitting ? (
                            <>
                              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                              Submitting...
                            </>
                          ) : (
                            "Submit Report"
                          )}
                        </button>
                      </div>
                    </form>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        <Footer />
      </div>
    </>
  );
};

export default ReportCenter;
