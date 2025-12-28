import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import { useAuth } from "../../contexts/AuthContext";
import { apiService } from "../../services/api";
import { DesktopNavbar } from "../../components/layout/DesktopNavbar";
import Footer from "../../components/layout/Footer";
import toast from "react-hot-toast";
import { ChevronLeft, AlertCircle } from "../../icons";

const ReportPage = () => {
  const router = useRouter();
  const { id } = router.query;
  const { user } = useAuth();

  const [document, setDocument] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [reason, setReason] = useState("");
  const [type, setType] = useState("content");
  const [category, setCategory] = useState("content");

  const reportTypes = [
    { value: "copyright", label: "Copyright Infringement" },
    { value: "spam", label: "Spam or Misleading" },
    { value: "inappropriate", label: "Inappropriate Content" },
    { value: "harassment", label: "Harassment or Hate Speech" },
    { value: "fraud", label: "Fraud or Scam" },
    { value: "other", label: "Other" },
  ];

  const [existingReport, setExistingReport] = useState(null);

  useEffect(() => {
    if (id) {
      loadDocument();
      if (user) {
        checkReportStatus();
      }
    }
  }, [id, user]);

  const checkReportStatus = async () => {
    try {
      const response = await apiService.checkReportStatus(id);
      if (response.data.hasActiveReport) {
        setExistingReport(response.data.report);
      }
    } catch (error) {
      console.error("Error checking report status:", error);
    }
  };

  const loadDocument = async () => {
    try {
      setLoading(true);
      const docResponse = await apiService.client.get(`/documents/${id}`);
      setDocument(docResponse.data.data.document);
    } catch (err) {
      console.error("Error loading document:", err);
      toast.error("Failed to load document details");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!user) {
      toast.error("You must be logged in to report a document");
      router.push("/auth/login");
      return;
    }

    if (!reason.trim()) {
      toast.error("Please provide a reason for the report");
      return;
    }

    try {
      setSubmitting(true);
      await apiService.reportDocument({
        documentId: id,
        reason,
        type,
        category: "content", // Default to content, but could be dynamic based on type
      });
      toast.success("Report submitted successfully");
      setTimeout(() => {
        router.push(`/document/${id}`);
      }, 1500);
    } catch (error) {
      console.error("Error submitting report:", error);
      toast.error(error.response?.data?.message || "Failed to submit report");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-dark-950 text-white flex flex-col">
        <DesktopNavbar />
        <div className="flex-1 flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        </div>
        <Footer />
      </div>
    );
  }

  if (!document) {
    return (
      <div className="min-h-screen bg-dark-950 text-white flex flex-col">
        <DesktopNavbar />
        <div className="flex-1 flex items-center justify-center">
          <p>Document not found</p>
        </div>
        <Footer />
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Report Document - DocsDB</title>
      </Head>

      <div className="min-h-screen bg-dark-950 text-white flex flex-col">
        <DesktopNavbar />

        <div className="flex-1 pt-24 pb-12 px-4">
          <div className="max-w-xl mx-auto">
            <button
              onClick={() => router.back()}
              className="flex items-center gap-2 text-dark-300 hover:text-white transition-colors mb-6"
            >
              <ChevronLeft size={20} />
              Back
            </button>

            <div className="bg-dark-900 border border-dark-800 rounded-xl p-6 md:p-8">
              <div className="flex items-center gap-3 mb-6">
                <AlertCircle className="text-red-500" size={32} />
                <h1 className="text-2xl font-bold">Report Document</h1>
              </div>

              <div className="mb-6 bg-dark-800/50 p-4 rounded-lg">
                <p className="text-sm text-dark-400 mb-1">Reporting:</p>
                <p className="font-medium text-lg truncate">
                  {document.generatedTitle}
                </p>
              </div>

              {existingReport ? (
                <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-6 text-center">
                  <AlertCircle className="w-12 h-12 text-yellow-500 mx-auto mb-3" />
                  <h3 className="text-lg font-semibold text-yellow-500 mb-2">
                    Report Under Review
                  </h3>
                  <p className="text-dark-300 mb-4">
                    You have already reported this document for{" "}
                    <span className="font-medium text-white">
                      {existingReport.type}
                    </span>
                    . We are currently reviewing your report. You cannot submit
                    another report until this issue is resolved.
                  </p>
                  <button
                    onClick={() => router.back()}
                    className="px-6 py-2 bg-dark-800 hover:bg-dark-700 text-white rounded-lg transition-colors"
                  >
                    Go Back
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-6">
                  <div>
                    <label className="block text-sm font-medium text-dark-200 mb-2">
                      Issue Type
                    </label>
                    <select
                      value={type}
                      onChange={(e) => setType(e.target.value)}
                      className="w-full bg-dark-800 border border-dark-700 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 outline-none transition-all"
                    >
                      {reportTypes.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-dark-200 mb-2">
                      Description
                    </label>
                    <textarea
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Please provide details about the issue..."
                      rows={5}
                      className="w-full bg-dark-800 border border-dark-700 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 outline-none transition-all resize-none"
                      maxLength={1000}
                    />
                    <div className="text-right text-xs text-dark-400 mt-1">
                      {reason.length}/1000
                    </div>
                  </div>

                  <div className="flex gap-4 pt-2">
                    <button
                      type="button"
                      onClick={() => router.back()}
                      className="flex-1 px-4 py-3 bg-dark-800 hover:bg-dark-700 text-white rounded-lg transition-colors font-medium"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={submitting}
                      className="flex-1 px-4 py-3 bg-red-500 hover:bg-red-600 disabled:bg-red-500/50 text-white rounded-lg transition-colors font-medium flex items-center justify-center gap-2"
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
              )}
            </div>
          </div>
        </div>
        <Footer />
      </div>
    </>
  );
};

export default ReportPage;
