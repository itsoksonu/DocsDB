import { createContext, useContext, useState } from "react";

const UploadContext = createContext();

export const UploadProvider = ({ children }) => {
  const [uploadState, setUploadState] = useState({
    isUploading: false,
    file: null,
    progress: 0,
    status: "idle", // idle, uploading, processing, processed, error
    processingStep: "",
    documentId: null,
    errorMessage: "",
    isMinimized: false,
  });

  const updateUploadState = (updates) => {
    setUploadState((prev) => ({ ...prev, ...updates }));
  };

  const resetUploadState = () => {
    setUploadState({
      isUploading: false,
      file: null,
      progress: 0,
      status: "idle",
      processingStep: "",
      documentId: null,
      errorMessage: "",
      isMinimized: false,
    });
  };

  return (
    <UploadContext.Provider value={{ uploadState, updateUploadState, resetUploadState }}>
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