import { createContext, useContext, useState } from "react";

const UploadContext = createContext();

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
