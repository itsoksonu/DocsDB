// src/services/api.js
import axios from "axios";
import toast from "react-hot-toast";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";

class APIService {
  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      timeout: 30000,
      withCredentials: true,
    });

    this.setupInterceptors();
    this.retryCount = 0;
    this.maxRetries = 3;
    this.searchCache = new Map();
  }

  setupInterceptors() {
    this.client.interceptors.request.use(
      (config) => {
        const token = localStorage.getItem("accessToken");
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    this.client.interceptors.response.use(
      (response) => {
        this.retryCount = 0; // Reset retry count on successful response
        return response;
      },
      async (error) => {
        const originalRequest = error.config;

        if (
          error.response?.status === 401 &&
          !originalRequest._retry &&
          this.retryCount < this.maxRetries
        ) {
          originalRequest._retry = true;
          this.retryCount++;

          try {
            const response = await this.refreshToken();
            const { accessToken } = response.data.data;
            localStorage.setItem("accessToken", accessToken);

            originalRequest.headers.Authorization = `Bearer ${accessToken}`;
            return this.client(originalRequest);
          } catch (refreshError) {
            this.retryCount = 0;
            localStorage.removeItem("accessToken");
            window.location.href = "/";
            return Promise.reject(refreshError);
          }
        }

        this.retryCount = 0; // Reset retry count

        const message = error.response?.data?.message || "Something went wrong";

        if (error.response?.status >= 500) {
          toast.error("Server error. Please try again later.");
        } else if (error.response?.status !== 401) {
          toast.error(message);
        }

        return Promise.reject(error);
      }
    );
  }

  // OAuth login - Only method for authentication
  async oauthLogin(oauthData) {
    const response = await this.client.post("/oauth", oauthData);
    return response.data;
  }

  async logout() {
    const response = await this.client.post("/auth/logout");
    localStorage.removeItem("accessToken");
    return response.data;
  }

  async getCurrentUser() {
    const response = await this.client.get("/auth/me");
    return response.data;
  }

  async refreshToken() {
    const response = await this.client.post("/auth/refresh");
    return response.data;
  }

  async getOAuthProviders() {
    const response = await this.client.get("/oauth/providers");
    return response.data;
  }

  // Upload endpoints
  async getPresignedUrl(fileData) {
    const response = await this.client.post("/upload/presign", {
      fileName: fileData.fileName,
      fileType: fileData.fileType,
      fileSize: fileData.fileSize,
    });
    return response.data;
  }

  async completeUpload(completeData) {
    const response = await this.client.post("/upload/complete", {
      documentId: completeData.documentId,
      key: completeData.key,
    });
    return response.data;
  }

  async getUploadStatus(documentId) {
    const response = await this.client.get(`/upload/status/${documentId}`);
    return response.data;
  }

  // Feed endpoints
  async getFeed(params = {}) {
    const response = await this.client.get("/feed", { params });
    return response.data;
  }

  async searchDocuments(params) {
    const key = JSON.stringify(params);
    if (this.searchCache.has(key)) return this.searchCache.get(key);
    const response = await this.client.get("/feed/search", { params });
    this.searchCache.set(key, response.data);

    if (this.searchCache.size > 50) {
      const firstKey = this.searchCache.keys().next().value;
      this.searchCache.delete(firstKey);
    }
    return response.data;
  }

  async getTrending(timeframe = "week", limit = 20) {
    const response = await this.client.get("/feed/trending", {
      params: { timeframe, limit },
    });
    return response.data;
  }

  async getCategories() {
    const response = await this.client.get("/feed/categories");
    return response.data;
  }

  async getRelatedDocuments(documentId, limit = 10) {
    const response = await this.client.get(`/feed/related/${documentId}`, {
      params: { limit },
    });
    return response.data;
  }

  // Save document
  async saveDocument(documentId) {
    const response = await this.client.post(`/documents/${documentId}/save`);
    return response.data;
  }

  // Unsave document
  async unsaveDocument(documentId) {
    const response = await this.client.delete(`/documents/${documentId}/save`);
    return response.data;
  }

  // Get saved documents
  async getSavedDocuments(params = {}) {
    const response = await this.client.get("/documents/user/saved-documents", { params });
    return response.data;
  }

  // Check if document is saved
  async checkSavedStatus(documentId) {
    const response = await this.client.get(
      `/documents/${documentId}/save/status`
    );
    return response.data;
  }

  async getUserDocuments(params = {}) {
  const response = await this.client.get("/documents/user/my-documents", { params });
  return response.data;
}
}

export const apiService = new APIService();
