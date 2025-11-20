import { useState, useRef } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import { useAuth } from "../contexts/AuthContext";
import { DesktopNavbar } from "../components/layout/DesktopNavbar";
import {
  Upload,
  FileText,
  X,
  Check,
  AlertCircle,
  Loader,
  Search,
  Users,
  Code,
} from "../icons";
import { apiService } from "../services/api";
import Footer from "../components/layout/Footer";
import toast from "react-hot-toast";

export default function UploadPage() {
  const { user } = useAuth();
  const router = useRouter();
  const fileInputRef = useRef(null);

  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState("idle"); 
  const [documentId, setDocumentId] = useState(null);
  const [processingStatus, setProcessingStatus] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");

  const ALLOWED_TYPES = {
    "application/pdf": ".pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      ".docx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      ".pptx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      ".xlsx",
    "text/csv": ".csv",
  };

  const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

  const handleFileSelect = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    if (!Object.keys(ALLOWED_TYPES).includes(file.type)) {
      toast.error(
        "Invalid file type. Please upload PDF, DOCX, PPTX, XLSX, or CSV files."
      );
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      toast.error("File size exceeds 100MB limit.");
      return;
    }

    setSelectedFile(file);
    setUploadStatus("idle");
    setErrorMessage("");
  };

  const handleDrop = (event) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) {
      const fakeEvent = { target: { files: [file] } };
      handleFileSelect(fakeEvent);
    }
  };

  const handleDragOver = (event) => {
    event.preventDefault();
  };

  const removeFile = () => {
    setSelectedFile(null);
    setUploadStatus("idle");
    setErrorMessage("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const uploadToS3 = async (presignedUrl, file) => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) {
          const progress = Math.round((event.loaded / event.total) * 100);
          setUploadProgress(progress);
        }
      });

      xhr.addEventListener("load", () => {
        if (xhr.status === 200) {
          resolve();
        } else {
          reject(new Error("Upload failed"));
        }
      });

      xhr.addEventListener("error", () => {
        reject(new Error("Upload failed"));
      });

      xhr.open("PUT", presignedUrl);
      xhr.setRequestHeader("Content-Type", file.type);
      xhr.send(file);
    });
  };

  const checkProcessingStatus = async (docId) => {
    try {
      const response = await apiService.getUploadStatus(docId);
      const status = response.data.status;

      setProcessingStatus(status);

      if (status === "processed") {
        setUploadStatus("processed");
        toast.success("Document processed successfully!");
        setTimeout(() => {
          router.push("/");
        }, 2000);
      } else if (status === "failed") {
        setUploadStatus("error");
        setErrorMessage(response.data.processingError || "Processing failed");
        toast.error("Document processing failed");
      } else if (status === "processing") {
        setTimeout(() => checkProcessingStatus(docId), 3000);
      }
    } catch (error) {
      console.error("Error checking status:", error);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile || !user) return;

    setUploading(true);
    setUploadStatus("uploading");
    setUploadProgress(0);
    setErrorMessage("");

    try {
      const presignResponse = await apiService.getPresignedUrl({
        fileName: selectedFile.name,
        fileType: selectedFile.type,
        fileSize: selectedFile.size,
      });

      const { uploadUrl, documentId: docId, key } = presignResponse.data;
      setDocumentId(docId);

      await uploadToS3(uploadUrl, selectedFile);

      setUploadProgress(100);
      toast.success("File uploaded successfully!");

      setUploadStatus("processing");
      await apiService.completeUpload({
        documentId: docId,
        key: key,
      });

      setTimeout(() => checkProcessingStatus(docId), 2000);
    } catch (error) {
      console.error("Upload error:", error);
      setUploadStatus("error");
      setErrorMessage(
        error.response?.data?.message || "Upload failed. Please try again."
      );
      toast.error(error.response?.data?.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
  };

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
              <h1 className="text-4xl font-bold mb-4">
                Contribute to the Collection
              </h1>
              <p className="text-dark-300 text-lg">
                Someone out there is searching for your document. Share
                knowledge with a global audience of 90M+ and counting.
              </p>
            </div>

            {/* Upload Card */}
            <div className="bg-dark-900 border border-dark-700 rounded-2xl p-8">
              {!selectedFile ? (
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
                        Drop your file here or click to browse
                      </h3>
                      <p className="text-dark-400 mb-4">
                        Supported formats: PDF, DOCX, PPTX, XLSX, CSV
                      </p>
                      <p className="text-sm text-dark-500">
                        Maximum file size: 100MB
                      </p>
                    </div>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    accept=".pdf,.docx,.pptx,.xlsx,.csv"
                    onChange={handleFileSelect}
                  />
                </div>
              ) : (
                // Selected File Display
                <div className="space-y-6">
                  {/* File Info */}
                  <div className="flex items-center gap-4 p-4 bg-dark-800 rounded-xl">
                    <div className="w-12 h-12 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
                      <FileText size={24} className="text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-medium truncate">
                        {selectedFile.name}
                      </h4>
                      <p className="text-sm text-dark-400">
                        {formatFileSize(selectedFile.size)}
                      </p>
                    </div>
                    {uploadStatus === "idle" && (
                      <button
                        onClick={removeFile}
                        className="p-2 hover:bg-dark-700 rounded-lg transition-colors"
                      >
                        <X size={20} className="text-dark-400" />
                      </button>
                    )}
                  </div>

                  {/* Upload Progress */}
                  {(uploadStatus === "uploading" ||
                    uploadStatus === "processing") && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-dark-300">
                          {uploadStatus === "uploading"
                            ? "Uploading..."
                            : "Processing..."}
                        </span>
                        {uploadStatus === "uploading" && (
                          <span className="text-dark-400">
                            {uploadProgress}%
                          </span>
                        )}
                      </div>
                      <div className="h-2 bg-dark-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all duration-300 ${
                            uploadStatus === "processing"
                              ? "bg-blue-500 animate-pulse"
                              : "bg-blue-500"
                          }`}
                          style={{
                            width:
                              uploadStatus === "uploading"
                                ? `${uploadProgress}%`
                                : "100%",
                          }}
                        />
                      </div>
                      {uploadStatus === "processing" && (
                        <div className="flex items-center gap-2 text-sm text-dark-400">
                          <Loader size={16} className="animate-spin" />
                          <span>
                            Processing your document... This may take a moment.
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Success Status */}
                  {uploadStatus === "completed" && (
                    <div className="flex items-center gap-3 p-4 bg-green-900/20 border border-green-700 rounded-xl">
                      <Check size={24} className="text-green-500" />
                      <div>
                        <p className="font-medium text-green-400">
                          Upload successful!
                        </p>
                        <p className="text-sm text-dark-400">
                          Redirecting to home...
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Error Status */}
                  {uploadStatus === "error" && (
                    <div className="flex items-start gap-3 p-4 bg-red-900/20 border border-red-700 rounded-xl">
                      <AlertCircle
                        size={24}
                        className="text-red-500 flex-shrink-0 mt-0.5"
                      />
                      <div>
                        <p className="font-medium text-red-400">
                          Upload failed
                        </p>
                        <p className="text-sm text-dark-400">{errorMessage}</p>
                      </div>
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="flex gap-3">
                    {uploadStatus === "idle" && (
                      <>
                        <button
                          onClick={handleUpload}
                          disabled={uploading}
                          className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Upload Document
                        </button>
                        <button
                          onClick={removeFile}
                          className="px-6 py-3 bg-dark-800 hover:bg-dark-700 text-white rounded-xl font-medium transition-colors"
                        >
                          Cancel
                        </button>
                      </>
                    )}
                    {uploadStatus === "error" && (
                      <>
                        <button
                          onClick={handleUpload}
                          className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium transition-colors"
                        >
                          Try Again
                        </button>
                        <button
                          onClick={removeFile}
                          className="px-6 py-3 bg-dark-800 hover:bg-dark-700 text-white rounded-xl font-medium transition-colors"
                        >
                          Choose Different File
                        </button>
                      </>
                    )}
                  </div>
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
         {/* Footer Section */}
        <Footer />
    </>
  );
}
