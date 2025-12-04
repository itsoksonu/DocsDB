import { useEffect } from "react";
import { useRouter } from "next/router";
import {
  FileText,
  X,
  Check,
  AlertCircle,
  Maximize2,
  Shield,
  FileSearch,
  Sparkles,
  Image as ImageIcon,
} from "../icons";
import { useUpload } from "../contexts/UploadContext";
import { apiService } from "../services/api";
import toast from "react-hot-toast";

export default function GlobalUploadWidget() {
  const router = useRouter();
  const { uploadState, updateUploadState, resetUploadState } = useUpload();

  const getProcessingStepInfo = (step) => {
    const steps = {
      "virus-scan": {
        icon: Shield,
        label: "Running virus scan",
        description: "Ensuring your document is safe",
      },
      "extracting-content": {
        icon: FileSearch,
        label: "Extracting content",
        description: "Reading document text and data",
      },
      "generating-metadata": {
        icon: Sparkles,
        label: "Generating metadata",
        description: "Creating title, description, and tags",
      },
      "creating-thumbnail": {
        icon: ImageIcon,
        label: "Creating thumbnail",
        description: "Generating document preview",
      },
      "finalizing": {
        icon: Check,
        label: "Finalizing",
        description: "Almost done!",
      },
    };
    return steps[step] || steps["finalizing"];
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
  };

  const simulateProcessingSteps = async () => {
    const steps = [
      "virus-scan",
      "extracting-content",
      "generating-metadata",
      "creating-thumbnail",
      "finalizing",
    ];

    for (const step of steps) {
      updateUploadState({ processingStep: step });
      await new Promise((resolve) => setTimeout(resolve, 10000));
    }
  };

  const checkProcessingStatus = async (docId) => {
    try {
      const response = await apiService.getUploadStatus(docId);
      const status = response.data.status;

      if (status === "processed") {
        updateUploadState({ 
          status: "processed", 
          processingStep: "finalizing" 
        });
        toast.success("Document processed successfully!");
        
        // Auto-close after 3 seconds
        setTimeout(() => {
          resetUploadState();
          router.push("/profile?tab=uploaded");
        }, 2000);
      } else if (status === "failed") {
        updateUploadState({
          status: "error",
          errorMessage: response.data.processingError || "Processing failed",
        });
        toast.error("Document processing failed");
      } else if (status === "processing") {
        setTimeout(() => checkProcessingStatus(docId), 3000);
      }
    } catch (error) {
      console.error("Error checking status:", error);
      updateUploadState({
        status: "error",
        errorMessage: "Failed to check processing status",
      });
    }
  };

  // Start polling when processing begins
  useEffect(() => {
    if (uploadState.status === "processing" && uploadState.documentId) {
      simulateProcessingSteps();
      checkProcessingStatus(uploadState.documentId);
    }
  }, [uploadState.status, uploadState.documentId]);

  // Don't render if not minimized or no active upload
  if (!uploadState.isMinimized || !uploadState.file) {
    return null;
  }

  const stepInfo = getProcessingStepInfo(uploadState.processingStep);
  const StepIcon = stepInfo.icon;

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

  return (
    <div className="fixed top-20 right-6 w-96 bg-dark-900 border border-dark-700 rounded-xl shadow-2xl z-[9999] overflow-hidden animate-slide-in">
      {/* Header */}
      <div className="bg-dark-800 px-4 py-3 flex items-center justify-between border-b border-dark-700">
        <div className="flex items-center gap-3">
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
        <div className="flex items-center gap-2">
          <button
            onClick={handleExpand}
            className="p-1.5 hover:bg-dark-700 rounded-lg transition-colors"
            title="Expand"
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
            <div className="flex items-center justify-between text-sm">
              <span className="text-dark-300">Uploading...</span>
              <span className="text-dark-400">{uploadState.progress}%</span>
            </div>
            <div className="h-2 bg-dark-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all duration-300"
                style={{ width: `${uploadState.progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Processing Status */}
        {uploadState.status === "processing" && (
          <div className="space-y-3">
            <div className="flex items-center gap-3 p-3 bg-dark-800 rounded-lg">
              <div className="w-10 h-10 bg-blue-600/20 rounded-lg flex items-center justify-center flex-shrink-0">
                <StepIcon size={20} className="text-blue-500 animate-pulse" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium">{stepInfo.label}</p>
                <p className="text-xs text-dark-400">{stepInfo.description}</p>
              </div>
            </div>
            <div className="h-1.5 bg-dark-800 rounded-full overflow-hidden">
              <div className="h-full bg-blue-500 animate-pulse w-full" />
            </div>
            <p className="text-xs text-center text-dark-500">
              Processing continues in background
            </p>
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
                <p className="text-sm font-medium text-red-400">Upload failed</p>
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