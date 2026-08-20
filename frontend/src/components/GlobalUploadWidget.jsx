import { io } from "socket.io-client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/router";
import {
  FileText,
  X,
  Check,
  AlertCircle,
  Maximize2,
  RefreshCw,
} from "../icons";
import { useUpload } from "../contexts/UploadContext";
import { apiService } from "../services/api";
import toast from "react-hot-toast";

export default function GlobalUploadWidget() {
  const router = useRouter();
  const { uploads, isMinimized, setIsMinimized, updateUpload, resetUploads, retryUpload } = useUpload();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const socketRef = useRef(null);
  const joinedRoomsRef = useRef(new Set());
  const uploadsRef = useRef(uploads);

  useEffect(() => {
    uploadsRef.current = uploads;
  }, [uploads]);

  const handleProgressUpdate = (data) => {
    const current = uploadsRef.current;
    const upload = data.documentId
      ? current.find((u) => u.documentId === data.documentId)
      : current.find((u) => u.status === "processing");
    if (!upload) return;

    if (data.completed || data.step === "completed") {
      updateUpload(upload.id, {
        status: "processed",
        processingStep: "finalizing",
        progress: 100,
      });
      toast.success(`${upload.file.name} uploaded successfully`);
    } else if (data.step) {
      updateUpload(upload.id, { processingStep: data.step });
    }
  };

  // Compute processing doc IDs for effect dependency
  const processingDocIds = uploads
    .filter((u) => u.status === "processing" && u.documentId)
    .map((u) => u.documentId)
    .join(",");

  // Socket + polling for processing uploads
  useEffect(() => {
    const processingUploads = uploadsRef.current.filter(
      (u) => u.status === "processing" && u.documentId
    );
    if (processingUploads.length === 0) return;

    // Setup socket if not yet connected
    if (!socketRef.current) {
      const socket = io(
        process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001",
        { withCredentials: true, transports: ["websocket", "polling"] }
      );
      socketRef.current = socket;

      socket.on("connect", () => {
        uploadsRef.current
          .filter((u) => u.status === "processing" && u.documentId)
          .forEach((u) => {
            if (!joinedRoomsRef.current.has(u.documentId)) {
              socket.emit("join-document", u.documentId);
              joinedRoomsRef.current.add(u.documentId);
            }
          });
      });

      socket.on("processing-progress", handleProgressUpdate);
      socket.on("error", (err) => console.error("Socket error:", err));
    }

    // Join any new rooms if already connected
    if (socketRef.current?.connected) {
      processingUploads.forEach((u) => {
        if (!joinedRoomsRef.current.has(u.documentId)) {
          socketRef.current.emit("join-document", u.documentId);
          joinedRoomsRef.current.add(u.documentId);
        }
      });
    }

    // Polling fallback
    const checkStatuses = async () => {
      const current = uploadsRef.current.filter(
        (u) => u.status === "processing" && u.documentId
      );
      for (const u of current) {
        try {
          const response = await apiService.getUploadStatus(u.documentId);
          const { status, processingError } =
            response.data.data || response.data;
          if (status === "processed") {
            handleProgressUpdate({ documentId: u.documentId, completed: true });
          } else if (status === "duplicate") {
            // Not a failure: the user already had this exact file, so there is
            // nothing to retry and nothing went wrong.
            updateUpload(u.id, {
              status: "duplicate",
              progress: 100,
              errorMessage: "",
            });
          } else if (status === "failed") {
            updateUpload(u.id, {
              status: "error",
              errorMessage: processingError || "Processing failed",
            });
          }
        } catch (err) {
          console.error("Status check failed:", err);
        }
      }
    };

    checkStatuses();
    const pollInterval = setInterval(checkStatuses, 2000);
    return () => clearInterval(pollInterval);
  }, [processingDocIds]);

  // Redirect when all uploads are done
  useEffect(() => {
    if (uploads.length === 0) return;
    const allDone = uploads.every(
      (u) =>
        u.status === "processed" ||
        u.status === "duplicate" ||
        u.status === "error"
    );
    const anySuccess = uploads.some((u) => u.status === "processed");
    if (allDone && anySuccess) {
      setTimeout(() => {
        if (socketRef.current) {
          socketRef.current.disconnect();
          socketRef.current = null;
        }
        resetUploads();
        router.push("/profile?tab=uploaded");
      }, 2000);
    }
  }, [uploads]);

  // Cleanup socket on unmount
  useEffect(() => {
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, []);

  // Don't render if no active uploads or not minimized
  const activeUploads = uploads.filter((u) => u.status !== "idle");
  if (!isMinimized || activeUploads.length === 0) return null;

  const processingCount = activeUploads.filter(
    (u) => u.status === "uploading" || u.status === "processing"
  ).length;
  const overallProgress =
    activeUploads.length > 0
      ? Math.round(
          activeUploads.reduce((sum, u) => sum + u.progress, 0) /
            activeUploads.length
        )
      : 0;
  const allDone = activeUploads.every(
    (u) =>
        u.status === "processed" ||
        u.status === "duplicate" ||
        u.status === "error"
  );
  const anyError = activeUploads.some((u) => u.status === "error");

  const handleExpand = () => {
    setIsMinimized(false);
    router.push("/upload");
  };

  const handleClose = () => {
    if (processingCount > 0) {
      const confirmed = window.confirm(
        "Files are still uploading. Close anyway? Processing will continue in the background."
      );
      if (!confirmed) return;
    }
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    resetUploads();
  };

  // Circle view
  if (isCollapsed) {
    return (
      <button
        onClick={() => setIsCollapsed(false)}
        className="fixed bottom-6 right-6 w-14 h-14 bg-dark-800 border border-dark-700 rounded-full shadow-2xl z-[9999] flex items-center justify-center hover:scale-105 transition-all duration-200 animate-slide-in group"
        title="Show Upload Progress"
      >
        <div className="absolute inset-0 rounded-full border-2 border-transparent group-hover:border-blue-500/50 transition-colors" />
        {processingCount > 0 && (
          <svg
            className="absolute inset-0 w-full h-full -rotate-90"
            viewBox="0 0 56 56"
          >
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
              strokeDashoffset={157.08 - (157.08 * overallProgress) / 100}
            />
          </svg>
        )}
        <div className="relative z-10">
          {processingCount > 0 && (
            <span className="text-xs font-bold text-blue-500">
              {overallProgress}%
            </span>
          )}
          {allDone && !anyError && (
            <Check size={24} className="text-green-500" />
          )}
          {allDone && anyError && (
            <AlertCircle size={24} className="text-red-500" />
          )}
        </div>
      </button>
    );
  }

  // Card view
  return (
    <div className="fixed top-20 left-4 right-4 md:left-auto md:right-6 md:w-96 bg-dark-900 border border-dark-700 rounded-xl shadow-2xl z-[9999] overflow-hidden animate-slide-in">
      {/* Header */}
      <div className="bg-dark-800 px-4 py-3 flex items-center justify-between border-b border-dark-700">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
            <FileText size={14} className="text-white" />
          </div>
          <span className="font-medium text-sm">
            {processingCount > 0
              ? `Uploading ${activeUploads.length} file${activeUploads.length > 1 ? "s" : ""}`
              : "Upload Complete"}
          </span>
        </div>
        <div className="flex items-center gap-1">
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
          <button
            onClick={handleClose}
            className="p-1.5 hover:bg-dark-700 rounded-lg transition-colors"
            title="Close"
          >
            <X size={16} className="text-dark-400" />
          </button>
        </div>
      </div>

      {/* File List */}
      <div className="max-h-72 overflow-y-auto divide-y divide-dark-700/50">
        {activeUploads.map((u) => (
          <div key={u.id} className="px-4 py-3 space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-sm truncate flex-1">{u.file.name}</span>
              <span className="flex-shrink-0">
                {u.status === "processed" ? (
                  <Check size={14} className="text-green-500" />
                ) : u.status === "duplicate" ? (
                  <Check size={14} className="text-purple-400" />
                ) : u.status === "error" ? (
                  <AlertCircle size={14} className="text-red-500" />
                ) : (
                  <span className="text-xs text-blue-400 font-medium">
                    {u.progress}%
                  </span>
                )}
              </span>
            </div>
            {(u.status === "uploading" || u.status === "processing") && (
              <div className="h-1 bg-dark-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 transition-all duration-300"
                  style={{ width: `${u.progress}%` }}
                />
              </div>
            )}
            {u.status === "duplicate" && (
              <p className="text-xs text-purple-300">
                You already uploaded this file — nothing new was added.
              </p>
            )}
            {u.status === "error" && (
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs text-red-400 flex-1">{u.errorMessage}</p>
                <button
                  onClick={() => retryUpload(u.id)}
                  disabled={u.retrying}
                  className="flex items-center gap-1 px-2 py-1 text-xs font-medium bg-dark-700 hover:bg-dark-600 text-white rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                  title={
                    u.storedInS3
                      ? "Process this file again without re-uploading"
                      : "Upload this file again"
                  }
                >
                  <RefreshCw
                    size={11}
                    className={u.retrying ? "animate-spin" : ""}
                  />
                  {u.retrying ? "Retrying" : "Retry"}
                </button>
              </div>
            )}
          </div>
        ))}
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
