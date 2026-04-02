import { io } from "socket.io-client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/router";
import {
  FileText,
  X,
  Check,
  AlertCircle,
  Maximize2,
  Minimize2,
} from "../icons";
import { useUpload } from "../contexts/UploadContext";
import { apiService } from "../services/api";
import toast from "react-hot-toast";

export default function GlobalUploadWidget() {
  const router = useRouter();
  const { uploadState, updateUploadState, resetUploadState } = useUpload();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const socketRef = useRef(null);

  const formatFileSize = (bytes) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
  };

  // Socket.io integration + Polling Fallback
  useEffect(() => {
    let pollInterval;

    if (uploadState.status === "processing" && uploadState.documentId) {
      // 1. Setup Socket Connection
      const socket = io(
        process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001",
        {
          withCredentials: true,
          transports: ["websocket", "polling"], // Allow both
        }
      );
      socketRef.current = socket;

      socket.on("connect", () => {
        console.log("Connected to progress socket");
        socket.emit("join-document", uploadState.documentId);
      });

      socket.on("processing-progress", (data) => {
        console.log("Progress event:", data);
        handleProgressUpdate(data);
      });

      socket.on("error", (err) => {
        console.error("Socket error:", err);
      });

      // 2. Setup Polling Fallback (every 2 seconds)
      // This catches cases where we miss events (e.g. job finishes before socket connects)
      const checkStatus = async () => {
        try {
          const response = await apiService.getUploadStatus(
            uploadState.documentId
          );
          const { status, processingError, generatedTitle } =
            response.data.data || response.data;

          if (status === "processed") {
            handleProgressUpdate({ completed: true });
          } else if (status === "failed") {
            updateUploadState({
              status: "error",
              errorMessage: processingError || "Processing failed",
            });
          }
        } catch (error) {
          console.error("Status check failed:", error);
        }
      };

      // Check immediately and then interval
      checkStatus();
      pollInterval = setInterval(checkStatus, 2000);
    }

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
      if (pollInterval) {
        clearInterval(pollInterval);
      }
    };
  }, [uploadState.status, uploadState.documentId]);

  const handleProgressUpdate = (data) => {
    if (data.completed || data.step === "completed") {
      updateUploadState({
        status: "processed",
        processingStep: "finalizing",
        progress: 100,
      });
      toast.success("Document Uploaded Successfully");

      setTimeout(() => {
        resetUploadState();
        router.push("/profile?tab=uploaded");
      }, 2000);
    } else if (data.step) {
      updateUploadState({ processingStep: data.step });
    }
  };

  // Don't render if not minimized (shown on page) or no active upload
  if (!uploadState.isMinimized || !uploadState.file) {
    return null;
  }

  const handleExpand = () => {
    updateUploadState({ isMinimized: false });
    router.push("/upload");
  };

  const handleClose = () => {
    if (uploadState.status === "processing") {
      const confirm = window.confirm(
        "Upload is still processing. Are you sure you want to close? Processing will continue in the background."
      );
      if (!confirm) return;
    }
    resetUploadState();
  };

  // Render Circle View
  if (isCollapsed) {
    return (
      <button
        onClick={() => setIsCollapsed(false)}
        className="fixed bottom-6 right-6 w-14 h-14 bg-dark-800 border border-dark-700 rounded-full shadow-2xl z-[9999] flex items-center justify-center hover:scale-105 transition-all duration-200 animate-slide-in group"
        title="Show Upload Progress"
      >
        {/* Status Indicator Ring */}
        <div className="absolute inset-0 rounded-full border-2 border-transparent group-hover:border-blue-500/50 transition-colors" />

        {/* Progress Ring (SVG) */}
        {uploadState.status === "uploading" && (
          <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 56 56">
            <circle
              cx="28"
              cy="28"
              r="25"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              className="text-dark-700"
            />
            <circle
              cx="28"
              cy="28"
              r="25"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              className="text-blue-500 transition-all duration-300"
              strokeDasharray="157.08"
              strokeDashoffset={157.08 - (157.08 * uploadState.progress) / 100}
            />
          </svg>
        )}

        {/* Icon based on status */}
        <div className="relative z-10">
          {(uploadState.status === "uploading" ||
            uploadState.status === "processing") && (
            <span className="text-xs font-bold text-blue-500">
              {uploadState.progress}%
            </span>
          )}
          {uploadState.status === "processed" && (
            <Check size={24} className="text-green-500" />
          )}
          {uploadState.status === "error" && (
            <AlertCircle size={24} className="text-red-500" />
          )}
        </div>
      </button>
    );
  }

  // Render Card View
  return (
    <div className="fixed top-20 left-4 right-4 md:left-auto md:right-6 md:w-96 bg-dark-900 border border-dark-700 rounded-xl shadow-2xl z-[9999] overflow-hidden animate-slide-in">
      {/* Header */}
      <div className="bg-dark-800 px-4 py-3 flex items-center justify-between border-b border-dark-700">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
            <FileText size={16} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="font-medium text-sm truncate">
              {uploadState.file.name}
            </h4>
            <p className="text-xs text-dark-400">
              {formatFileSize(uploadState.file.size)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => setIsCollapsed(true)}
            className="p-1.5 hover:bg-dark-700 rounded-lg transition-colors"
            title="Minimize to circle"
          >
            <div className="w-4 h-4 flex items-center justify-center">
              <div className="w-3 h-0.5 bg-dark-400 rounded-full" />
            </div>
          </button>
          <button
            onClick={handleExpand}
            className="p-1.5 hover:bg-dark-700 rounded-lg transition-colors"
            title="Expand to full page"
          >
            <Maximize2 size={16} className="text-dark-400" />
          </button>
          {uploadState.status !== "processing" && (
            <button
              onClick={handleClose}
              className="p-1.5 hover:bg-dark-700 rounded-lg transition-colors"
              title="Close"
            >
              <X size={16} className="text-dark-400" />
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="p-4 space-y-4">
        {/* Upload Progress */}
        {uploadState.status === "uploading" && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-dark-300">Uploading...</span>
              <span className="text-dark-400">{uploadState.progress}%</span>
            </div>
            <div className="h-1.5 bg-dark-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all duration-300"
                style={{ width: `${uploadState.progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Processing Status */}
        {uploadState.status === "processing" && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-dark-400">Processing...</span>
              <span className="text-dark-400">{uploadState.progress}%</span>
            </div>
            <div className="h-1.5 bg-dark-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all duration-300"
                style={{ width: `${uploadState.progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Success Status */}
        {uploadState.status === "processed" && (
          <div className="flex items-center gap-3 p-3 bg-green-900/20 border border-green-700 rounded-lg">
            <Check size={20} className="text-green-500" />
            <div>
              <p className="text-sm font-medium text-green-400">
                Processing complete!
              </p>
              <p className="text-xs text-dark-400">Redirecting to profile...</p>
            </div>
          </div>
        )}

        {/* Error Status */}
        {uploadState.status === "error" && (
          <div className="space-y-3">
            <div className="flex items-start gap-3 p-3 bg-red-900/20 border border-red-700 rounded-lg">
              <AlertCircle
                size={20}
                className="text-red-500 flex-shrink-0 mt-0.5"
              />
              <div>
                <p className="text-sm font-medium text-red-400">
                  Upload failed
                </p>
                <p className="text-xs text-dark-400">
                  {uploadState.errorMessage}
                </p>
              </div>
            </div>
            <button
              onClick={handleExpand}
              className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg font-medium transition-colors"
            >
              View Details
            </button>
          </div>
        )}
      </div>

      <style jsx>{`
        @keyframes slide-in {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
        .animate-slide-in {
          animation: slide-in 0.3s ease-out;
        }
      `}</style>
    </div>
  );
}
