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
    this.searchCache = new Map();
    this.isRefreshing = false;
    this.failedQueue = [];
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
        return response;
      },
      async (error) => {
        const originalRequest = error.config;

        // Don't intercept refresh token requests to avoid infinite loops
        if (originalRequest.url?.includes('/auth/refresh')) {
          return Promise.reject(error);
        }

        // Don't intercept logout requests
        if (originalRequest.url?.includes('/auth/logout')) {
          return Promise.reject(error);
        }

        if (
          error.response?.status === 401 &&
          !originalRequest._retry
        ) {
          if (this.isRefreshing) {
            // If refresh is already in progress, queue this request
            return new Promise((resolve, reject) => {
              this.failedQueue.push({ resolve, reject });
            }).then(() => {
              const token = localStorage.getItem("accessToken");
              if (token) {
                originalRequest.headers.Authorization = `Bearer ${token}`;
              }
              return this.client(originalRequest);
            }).catch(err => {
              return Promise.reject(err);
            });
          }

          originalRequest._retry = true;
          this.isRefreshing = true;

          try {
            console.log("API interceptor: Attempting token refresh...");
            const response = await this.refreshToken();
            const accessToken = response.data?.data?.accessToken || response.data?.accessToken;

            if (!accessToken) {
              throw new Error('Invalid refresh response');
            }

            localStorage.setItem("accessToken", accessToken);
            console.log("API interceptor: Token refreshed successfully");

            // Process queued requests
            this.processQueue(null, accessToken);

            // Retry the original request
            originalRequest.headers.Authorization = `Bearer ${accessToken}`;
            return this.client(originalRequest);
          } catch (refreshError) {
            console.error("API interceptor: Token refresh failed", refreshError);
            
            // Process queued requests with error
            this.processQueue(refreshError, null);

            // Only clear token and redirect if refresh token is invalid/expired
            if (refreshError.response?.status === 401) {
              localStorage.removeItem("accessToken");
              console.log("API interceptor: Refresh token expired");
            }
            return Promise.reject(refreshError);
          } finally {
            this.isRefreshing = false;
          }
        }

        const message = error.response?.data?.message || "Something went wrong";

        // Don't show toast for 401 errors or refresh failures
        if (error.response?.status >= 500) {
          toast.error("Server error. Please try again later.");
        } else if (error.response?.status !== 401) {
          // Only show toast for non-401 errors
          if (!originalRequest._retry) {
            toast.error(message);
          }
        }

        return Promise.reject(error);
      }
    );
  }

  processQueue(error, token = null) {
    this.failedQueue.forEach(({ resolve, reject }) => {
      if (error) {
        reject(error);
      } else {
        resolve(token);
      }
    });

    this.failedQueue = [];
  }

  //auth endpoints
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

  // document Save related endpoints
  async saveDocument(documentId) {
    const response = await this.client.post(`/documents/${documentId}/save`);
    return response.data;
  }

  async unsaveDocument(documentId) {
    const response = await this.client.delete(`/documents/${documentId}/save`);
    return response.data;
  }

  async getSavedDocuments(params = {}) {
    const response = await this.client.get("/documents/user/saved-documents", { params });
    return response.data;
  }

  async checkSavedStatus(documentId) {
    const response = await this.client.get(
      `/documents/${documentId}/save/status`
    );
    return response.data;
  }

  // documents endpoints
  async getUserDocuments(params = {}) {
    const response = await this.client.get("/documents/user/my-documents", { params });
    return response.data;
  }
}

export const apiService = new APIService();