import { useState, useRef, useEffect } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import { useAuth } from "../contexts/AuthContext";
import { useUpload } from "../contexts/UploadContext";
import { DesktopNavbar } from "../components/layout/DesktopNavbar";
import {
  Upload,
  FileText,
  X,
  Check,
  AlertCircle,
  Search,
  Users,
  Code,
  Minimize2,
  RefreshCw,
} from "../icons";
import Footer from "../components/layout/Footer";
import toast from "react-hot-toast";

export default function UploadPage() {
  const { user } = useAuth();
  const router = useRouter();
  const fileInputRef = useRef(null);
  const {
    uploads,
    isMinimized,
    setIsMinimized,
    addFiles,
    removeUpload,
    resetUploads,
    uploadFile,
    retryUpload,
    retryAllFailed,
  } = useUpload();

  const [isUploading, setIsUploading] = useState(false);

  const ALLOWED_TYPES = {
    "application/pdf": ".pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "text/csv": ".csv",
  };

  const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

  const validateAndAddFiles = (files) => {
    const valid = [];
    for (const file of Array.from(files)) {
      if (!Object.keys(ALLOWED_TYPES).includes(file.type)) {
        toast.error(`${file.name}: Invalid file type. Use PDF, DOCX, PPTX, XLSX, or CSV.`);
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        toast.error(`${file.name}: Exceeds 100MB limit.`);
        continue;
      }
      valid.push(file);
    }
    if (valid.length > 0) addFiles(valid);
  };

  const handleFileSelect = (event) => {
    if (!event.target.files?.length) return;
    validateAndAddFiles(event.target.files);
    event.target.value = "";
  };

  const handleDrop = (event) => {
    event.preventDefault();
    if (event.dataTransfer.files?.length) {
      validateAndAddFiles(event.dataTransfer.files);
    }
  };

  const handleDragOver = (event) => {
    event.preventDefault();
  };

  const handleUploadAll = async () => {
    const idleUploads = uploads.filter((u) => u.status === "idle");
    if (idleUploads.length === 0) return;
    setIsUploading(true);
    await Promise.all(idleUploads.map(uploadFile));
    setIsUploading(false);
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
  };

  const hasActiveUploads = uploads.some(
    (u) => u.status === "uploading" || u.status === "processing"
  );
  const allIdle = uploads.every((u) => u.status === "idle");
  const showFileList = uploads.length > 0 && !isMinimized;

  return (
    <>
      <Head>
        <title>Upload Document - DocsDB</title>
        <meta name="description" content="Upload and share your documents" />
      </Head>

      <div className="min-h-screen bg-dark-950 text-white">
        <DesktopNavbar
          onSearch={(query) => {
            const trimmed = query.trim();
            if (trimmed && trimmed !== router.query.q) {
              router.push(`/search?q=${encodeURIComponent(trimmed)}`);
            }
          }}
          onUploadClick={() => {}}
        />

        <div className="pt-32 pb-20 px-6">
          <div className="max-w-3xl mx-auto">
            {/* Header */}
            <div className="text-center mb-12">
              <h1 className="font-literature text-3xl md:text-5xl font-bold mb-4">
                Contribute to the Collection.
              </h1>
              <p className="text-dark-300 text-base md:text-xl">
                Someone out there is searching for your document. Share
                knowledge with a global audience of 90M+ and counting.
              </p>
            </div>

            {/* Upload Card */}
            <div className="bg-dark-900 border border-dark-700 rounded-2xl p-8">
              {!showFileList ? (
                // File Drop Zone
                <div
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  className="border-2 border-dashed border-dark-600 rounded-xl p-12 text-center hover:border-blue-500 transition-all duration-300 cursor-pointer"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <div className="flex flex-col items-center gap-4">
                    <div className="w-16 h-16 bg-dark-800 rounded-full flex items-center justify-center">
                      <Upload size={32} className="text-blue-500" />
                    </div>
                    <div>
                      <h3 className="text-xl font-semibold mb-2">
                        Drop your files here or click to browse
                      </h3>
                      <p className="text-dark-400 mb-4">
                        Supported formats: PDF, DOCX, PPTX, XLSX, CSV
                      </p>
                      <p className="text-sm text-dark-500">
                        Multiple files supported · Maximum 100MB per file
                      </p>
                    </div>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    accept=".pdf,.docx,.pptx,.xlsx,.csv"
                    multiple
                    onChange={handleFileSelect}
                  />
                </div>
              ) : (
                // File List
                <div className="space-y-4">
                  {/* File Items */}
                  <div className="space-y-2">
                    {uploads.map((u) => (
                      <div
                        key={u.id}
                        className="flex flex-col gap-2 p-4 bg-dark-800 rounded-xl"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
                            <FileText size={20} className="text-white" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4 className="font-medium truncate text-sm">
                              {u.file.name}
                            </h4>
                            <p className="text-xs text-dark-400">
                              {formatFileSize(u.file.size)}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {u.status === "processed" && (
                              <Check size={18} className="text-green-500" />
                            )}
                            {u.status === "duplicate" && (
                              <Check size={18} className="text-purple-400" />
                            )}
                            {u.status === "error" && (
                              <AlertCircle size={18} className="text-red-500" />
                            )}
                            {u.status === "idle" && (
                              <button
                                onClick={() => removeUpload(u.id)}
                                className="p-1.5 hover:bg-dark-700 rounded-lg transition-colors"
                              >
                                <X size={16} className="text-dark-400" />
                              </button>
                            )}
                            {(u.status === "uploading" || u.status === "processing") && (
                              <span className="text-xs text-blue-400 font-medium w-8 text-right">
                                {u.progress}%
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Per-file progress bar */}
                        {(u.status === "uploading" || u.status === "processing") && (
                          <div className="h-1.5 bg-dark-700 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-blue-500 transition-all duration-300"
                              style={{ width: `${u.progress}%` }}
                            />
                          </div>
                        )}

                        {u.status === "duplicate" && (
                          <p className="text-xs text-purple-300">
                            You already uploaded this file — nothing new was
                            added.
                          </p>
                        )}
                        {u.status === "error" && (
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-xs text-red-400 flex-1">
                              {u.errorMessage}
                            </p>
                            <button
                              onClick={() => retryUpload(u.id)}
                              disabled={u.retrying}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-dark-700 hover:bg-dark-600 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                            >
                              <RefreshCw
                                size={12}
                                className={u.retrying ? "animate-spin" : ""}
                              />
                              {u.retrying ? "Retrying" : "Retry"}
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Add more files button (idle state only) */}
                  {allIdle && (
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full py-2.5 border border-dashed border-dark-600 hover:border-blue-500 text-dark-400 hover:text-blue-400 rounded-xl text-sm transition-colors"
                    >
                      + Add more files
                    </button>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    accept=".pdf,.docx,.pptx,.xlsx,.csv"
                    multiple
                    onChange={handleFileSelect}
                  />

                  {/* Minimize button (during active uploads) */}
                  {hasActiveUploads && (
                    <button
                      onClick={() => setIsMinimized(true)}
                      className="w-full py-3 bg-dark-800 hover:bg-dark-700 text-white rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
                    >
                      <Minimize2 size={18} />
                      Minimize and continue browsing
                    </button>
                  )}

                  {/* Action buttons (idle state) */}
                  {allIdle && (
                    <div className="flex gap-3">
                      <button
                        onClick={handleUploadAll}
                        disabled={isUploading}
                        className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Upload {uploads.length > 1 ? `${uploads.length} Files` : "Document"}
                      </button>
                      <button
                        onClick={resetUploads}
                        className="px-6 py-3 bg-dark-800 hover:bg-dark-700 text-white rounded-xl font-medium transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  )}

                  {/* Retry errored files */}
                  {!hasActiveUploads && uploads.some((u) => u.status === "error") && (
                    <div className="flex gap-3">
                      <button
                        onClick={retryAllFailed}
                        disabled={uploads.some((u) => u.retrying)}
                        className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Retry Failed
                      </button>
                      <button
                        onClick={resetUploads}
                        className="px-6 py-3 bg-dark-800 hover:bg-dark-700 text-white rounded-xl font-medium transition-colors"
                      >
                        Clear All
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Terms Agreement */}
            <p className="mt-4 text-center text-sm text-dark-400">
              By uploading, you agree to our{" "}
              <a
                href="/terms"
                className="text-blue-500 hover:text-blue-400 underline"
              >
                DocsDB Upload Terms and Agreement
              </a>
              .
            </p>

            {/* Copyright Notice */}
            <div className="mt-8 p-6 bg-yellow-900/10 border border-yellow-700/30 rounded-xl">
              <p className="text-sm text-dark-300 leading-relaxed">
                <strong className="text-yellow-500">Important:</strong> We take
                intellectual property rights very seriously. DocsDB is fully
                compliant with the DMCA and all applicable laws. If you did not
                create a work yourself and are unsure whether it is copyrighted,
                please do not upload it. DocsDB expeditiously removes infringing
                material and terminates repeat infringers pursuant to our
                "three-strikes" policy.
              </p>
            </div>

            {/* Benefits Section */}
            <div className="mt-12 grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="p-6 bg-dark-900/50 border border-dark-700 rounded-xl">
                <div className="w-12 h-12 bg-blue-600/20 rounded-lg flex items-center justify-center mb-4">
                  <Upload size={24} className="text-blue-500" />
                </div>
                <h3 className="font-semibold mb-2">
                  Upload documents easily, for free
                </h3>
                <p className="text-sm text-dark-400">
                  Simple drag-and-drop interface with support for multiple file
                  formats
                </p>
              </div>

              <div className="p-6 bg-dark-900/50 border border-dark-700 rounded-xl">
                <div className="w-12 h-12 bg-green-600/20 rounded-lg flex items-center justify-center mb-4">
                  <Search size={24} className="text-green-500" />
                </div>
                <h3 className="font-semibold mb-2">
                  Amplify reach with search engine indexing
                </h3>
                <p className="text-sm text-dark-400">
                  Your documents get indexed and discovered by search engines
                  worldwide
                </p>
              </div>

              <div className="p-6 bg-dark-900/50 border border-dark-700 rounded-xl">
                <div className="w-12 h-12 bg-purple-600/20 rounded-lg flex items-center justify-center mb-4">
                  <Users size={24} className="text-purple-500" />
                </div>
                <h3 className="font-semibold mb-2">
                  Share with 90M+ people around the world
                </h3>
                <p className="text-sm text-dark-400">
                  Connect with a massive global audience actively seeking
                  knowledge
                </p>
              </div>

              <div className="p-6 bg-dark-900/50 border border-dark-700 rounded-xl">
                <div className="w-12 h-12 bg-orange-600/20 rounded-lg flex items-center justify-center mb-4">
                  <Code size={24} className="text-orange-500" />
                </div>
                <h3 className="font-semibold mb-2">
                  Embed content directly on your website
                </h3>
                <p className="text-sm text-dark-400">
                  Easy embed codes to showcase your documents anywhere online
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
      <Footer />
    </>
  );
}
