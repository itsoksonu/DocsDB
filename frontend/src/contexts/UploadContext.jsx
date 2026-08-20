import { createContext, useContext, useState } from "react";
import toast from "react-hot-toast";
import { apiService } from "../services/api";

const UploadContext = createContext();

const uploadToS3 = (presignedUrl, file, onProgress) => {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 90));
      }
    });
    xhr.addEventListener("load", () => {
      if (xhr.status === 200) resolve();
      else reject(new Error("Upload failed"));
    });
    xhr.addEventListener("error", () => reject(new Error("Upload failed")));
    xhr.addEventListener("abort", () => reject(new Error("Upload cancelled")));
    xhr.open("PUT", presignedUrl);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.send(file);
  });
};

export const UploadProvider = ({ children }) => {
  const [uploads, setUploads] = useState([]);
  const [isMinimized, setIsMinimized] = useState(false);

  const addFiles = (files) => {
    const newUploads = Array.from(files).map((file) => ({
      id: `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file,
      progress: 0,
      status: "idle",
      processingStep: "",
      documentId: null,
      errorMessage: "",
      // Tells a retry whether the bytes are already in S3, and therefore
      // whether it needs to re-upload or only re-queue processing.
      storedInS3: false,
      retrying: false,
    }));
    setUploads((prev) => [...prev, ...newUploads]);
  };

  const updateUpload = (id, updates) => {
    setUploads((prev) =>
      prev.map((u) => (u.id === id ? { ...u, ...updates } : u))
    );
  };

  const removeUpload = (id) => {
    setUploads((prev) => prev.filter((u) => u.id !== id));
  };

  const resetUploads = () => {
    setUploads([]);
    setIsMinimized(false);
  };

  const uploadFile = async (uploadItem) => {
    const { id, file } = uploadItem;
    updateUpload(id, {
      status: "uploading",
      progress: 0,
      errorMessage: "",
      storedInS3: false,
    });

    try {
      const presignResponse = await apiService.getPresignedUrl({
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
      });
      const { uploadUrl, documentId, key } = presignResponse.data;
      updateUpload(id, { documentId });

      await uploadToS3(uploadUrl, file, (progress) =>
        updateUpload(id, { progress })
      );

      updateUpload(id, {
        status: "processing",
        processingStep: "virus-scan",
        storedInS3: true,
      });
      await apiService.completeUpload({ documentId, key });
    } catch (error) {
      const message =
        error.response?.data?.message || "Upload failed. Please try again.";
      updateUpload(id, { status: "error", errorMessage: message });
      toast.error(error.response?.data?.message || `${file.name} failed to upload`);
    }
  };

  /**
   * Retrying a failed item never re-uploads a file that is already in S3.
   * If the bytes made it, we only ask the server to run the pipeline again;
   * a fresh upload would orphan the first Document row and its S3 object.
   */
  const retryUpload = async (id) => {
    const item = uploads.find((u) => u.id === id);
    if (!item || item.status !== "error" || item.retrying) return;

    if (!item.storedInS3 || !item.documentId) {
      await uploadFile(item);
      return;
    }

    updateUpload(id, { retrying: true });

    try {
      await apiService.reprocessDocument(item.documentId);
      updateUpload(id, {
        status: "processing",
        processingStep: "virus-scan",
        progress: 90,
        errorMessage: "",
        retrying: false,
      });
    } catch (error) {
      const message =
        error.response?.data?.message || "Could not retry. Please try again.";
      updateUpload(id, { errorMessage: message, retrying: false });
      toast.error(message);
    }
  };

  const retryAllFailed = async () => {
    const failed = uploads.filter((u) => u.status === "error" && !u.retrying);
    await Promise.all(failed.map((u) => retryUpload(u.id)));
  };

  return (
    <UploadContext.Provider
      value={{
        uploads,
        isMinimized,
        setIsMinimized,
        addFiles,
        updateUpload,
        removeUpload,
        resetUploads,
        uploadFile,
        retryUpload,
        retryAllFailed,
      }}
    >
      {children}
    </UploadContext.Provider>
  );
};

export const useUpload = () => {
  const context = useContext(UploadContext);
  if (!context) {
    throw new Error("useUpload must be used within UploadProvider");
  }
  return context;
};
