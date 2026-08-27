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
    // The one in-flight refresh, shared by every caller. Replaces the previous
    // isRefreshing flag + failedQueue pair, which only covered the axios
    // interceptor and left askDocumentAi and the AuthContext timer able to start
    // a second, concurrent refresh.
    this.refreshPromise = null;
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
      (error) => Promise.reject(error),
    );

    this.client.interceptors.response.use(
      (response) => {
        return response;
      },
      async (error) => {
        const originalRequest = error.config;

        // Don't intercept refresh token requests to avoid infinite loops
        if (originalRequest.url?.includes("/auth/refresh")) {
          return Promise.reject(error);
        }

        // Don't intercept logout requests
        if (originalRequest.url?.includes("/auth/logout")) {
          return Promise.reject(error);
        }

        if (error.response?.status === 401 && !originalRequest._retry) {
          originalRequest._retry = true;

          try {
            // Concurrent 401s all await the same refresh, then each retries its
            // own request. Previously a second refresh could be started in
            // parallel, which the server now reads as token replay.
            const accessToken = await this.ensureFreshToken();

            originalRequest.headers.Authorization = `Bearer ${accessToken}`;
            return this.client(originalRequest);
          } catch (refreshError) {
            console.error("API interceptor: Token refresh failed", refreshError);

            // Only drop the token when the refresh itself was rejected; a network
            // blip should not sign the user out.
            if (refreshError.response?.status === 401) {
              localStorage.removeItem("accessToken");
            }
            return Promise.reject(refreshError);
          }
        }

        const message = error.response?.data?.message || "Something went wrong";

        // Background requests the user did not initiate report their own
        // failures where they are relevant, instead of interrupting with a
        // toast about something nobody asked for.
        if (originalRequest?.silent) {
          return Promise.reject(error);
        }

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
      },
    );
  }

  /**
   * The single place a refresh may be requested from.
   *
   * The server now rotates refresh tokens and revokes the whole family if one is
   * presented twice, so two concurrent refreshes are no longer merely wasteful -
   * the loser looks exactly like a stolen token being replayed and signs the user
   * out. Everything that might refresh has to funnel through here.
   *
   * Concurrent callers share one in-flight promise rather than being queued: they
   * all await the same request and then retry their own work.
   */
  async ensureFreshToken() {
    if (this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = (async () => {
      try {
        const response = await this.refreshToken();
        const accessToken =
          response.data?.accessToken || response.accessToken;

        if (!accessToken) {
          throw new Error("Invalid refresh response");
        }

        localStorage.setItem("accessToken", accessToken);
        return accessToken;
      } finally {
        // Cleared before the promise settles for the caller, so the next 401
        // starts a fresh attempt instead of reusing a rejected one.
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
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

  async updateProfile(data) {
    const response = await this.client.patch("/auth/me", data);
    return response.data;
  }

  // Upload endpoints
  async getPresignedUrl(fileData) {
    const response = await this.client.post("/upload/presign", {
      fileName: fileData.fileName,
      fileType: fileData.fileType,
      fileSize: fileData.fileSize,
      uploadType: fileData.uploadType || "document",
    });
    return response.data;
  }

  async uploadFileToS3(presignedUrl, file) {
    const response = await axios.put(presignedUrl, file, {
      headers: {
        "Content-Type": file.type,
      },
    });
    return response;
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

  // Structured content for the in-app viewer (docx paragraphs, pptx slides,
  // xlsx/csv rows). PDFs render from the signed URL and never call this.
  async getDocumentPreview(identifier) {
    const response = await this.client.get(`/documents/${identifier}/preview`);
    return response.data;
  }

  // Re-runs processing on a document that already exists in storage. Used by
  // the retry affordances instead of uploading the same file a second time.
  async reprocessDocument(documentId) {
    const response = await this.client.post(
      `/documents/${documentId}/reprocess`
    );
    return response.data;
  }

  // Warms a document's retrieval index so the first question is not the one
  // that pays for building it. Called when the Ask AI panel is opened.
  async prepareDocumentAi(identifier) {
    const response = await this.client.post(
      `/documents/${identifier}/ask/prepare`,
      null,
      // Opening the panel is not an action whose failure deserves a toast.
      { silent: true },
    );
    return response.data;
  }

  // Ask AI about a document. Streamed as Server-Sent Events, so this goes
  // through fetch rather than the axios client: XHR buffers the whole response
  // and would hand back the answer only once it is complete.
  //
  // The axios interceptors don't apply either, so the 401 refresh dance is
  // repeated here - once, reusing the same refresh call.
  async askDocumentAi(
    identifier,
    {
      question,
      history = [],
      signal,
      onToken,
      onMeta,
      onProvider,
      onSources,
      onDone,
    } = {},
  ) {
    const url = `${API_BASE_URL}/documents/${identifier}/ask`;

    const send = (token) =>
      fetch(url, {
        method: "POST",
        credentials: "include",
        signal,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ question, history }),
      });

    let response = await send(localStorage.getItem("accessToken"));

    if (response.status === 401) {
      // Via ensureFreshToken, not refreshToken: this used to bypass the
      // interceptor's lock entirely, so an SSE 401 landing alongside an axios
      // 401 fired two refreshes - which the server now treats as replay and
      // answers by revoking the session.
      let accessToken;
      try {
        accessToken = await this.ensureFreshToken();
      } catch {
        throw new Error("Your session has expired");
      }

      response = await send(accessToken);
    }

    if (!response.ok) {
      // Every pre-stream failure is ordinary JSON, so the real reason (no
      // readable text, rate limited, no permission) reaches the user.
      const body = await response.json().catch(() => null);
      throw new Error(body?.message || "Something went wrong");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let streamError = null;

    const handleEvent = (block) => {
      const lines = block.split("\n");
      const event = lines
        .find((line) => line.startsWith("event:"))
        ?.slice(6)
        .trim();
      const raw = lines
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");

      if (!event || !raw) return;

      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        return;
      }

      if (event === "token") onToken?.(data.text);
      else if (event === "meta") onMeta?.(data);
      else if (event === "sources") onSources?.(data.sources);
      else if (event === "provider") onProvider?.(data.provider);
      else if (event === "done") onDone?.(data);
      else if (event === "error") streamError = new Error(data.message);
    };

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Events are separated by a blank line; a partial one stays buffered.
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() || "";
        blocks.forEach(handleEvent);
      }
    } finally {
      reader.cancel().catch(() => {});
    }

    if (streamError) throw streamError;
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

  async recordInteraction(documentId, type) {
    const response = await this.client.post("/feed/interactions", {
      documentId,
      type,
    });
    return response.data;
  }

  // document Save related endpoints
  async saveDocument(documentId, collectionId = null) {
    const response = await this.client.post(`/documents/${documentId}/save`, {
      collectionId,
    });
    return response.data;
  }

  async getCollections() {
    const response = await this.client.get("/documents/user/collections");
    return response.data;
  }

  async createCollection(name) {
    const response = await this.client.post("/documents/user/collections", {
      name,
    });
    return response.data;
  }

  async updateCollection(collectionId, name) {
    const response = await this.client.put(
      `/documents/user/collections/${collectionId}`,
      {
        name,
      },
    );
    return response.data;
  }

  async unsaveDocument(documentId) {
    const response = await this.client.delete(`/documents/${documentId}/save`);
    return response.data;
  }

  async getSavedDocuments(params = {}) {
    const response = await this.client.get("/documents/user/saved-documents", {
      params,
    });
    return response.data;
  }

  async checkSavedStatus(documentId) {
    const response = await this.client.get(
      `/documents/${documentId}/save/status`,
    );
    return response.data;
  }

  async deleteDocument(documentId) {
    const response = await this.client.delete(`/documents/${documentId}`);
    return response.data;
  }

  async trackDownload(documentId) {
    const response = await this.client.post(
      `/documents/${documentId}/track-download`,
    );
    return response.data;
  }

  // documents endpoints
  async getUserDocuments(params = {}) {
    const response = await this.client.get("/documents/user/my-documents", {
      params,
    });
    return response.data;
  }

  async getUserStats() {
    const response = await this.client.get("/documents/user/stats");
    return response.data;
  }

  async reportDocument(data) {
    const response = await this.client.post("/report", data);
    return response.data;
  }

  async submitReport(data) {
    const response = await this.client.post("/report", data);
    return response.data;
  }

  async checkReportStatus(documentId) {
    const response = await this.client.get(`/report/check/${documentId}`);
    return response.data;
  }

  // Admin Endpoints
  async getAdminStats() {
    const response = await this.client.get("/admin/dashboard");
    return response.data;
  }

  async getAdminUsers(params) {
    const response = await this.client.get("/admin/users", { params });
    return response.data;
  }

  async updateUserStatus(userId, data) {
    const response = await this.client.patch(
      `/admin/users/${userId}/status`,
      data,
    );
    return response.data;
  }

  async getAdminDocuments(params) {
    const response = await this.client.get("/admin/documents", { params });
    return response.data;
  }

  // AI provider configuration
  async getAiSettings() {
    const response = await this.client.get("/admin/ai/settings");
    return response.data;
  }

  async updateAiSettings(data) {
    const response = await this.client.patch("/admin/ai/settings", data);
    return response.data;
  }

  async testAiProvider(provider, model) {
    const response = await this.client.post("/admin/ai/test", {
      provider,
      model,
    });
    return response.data;
  }

  async testAllAiProviders() {
    const response = await this.client.post("/admin/ai/test-all");
    return response.data;
  }

  async getAdminDocument(documentId, params = {}) {
    const response = await this.client.get(`/admin/documents/${documentId}`, {
      params,
    });
    return response.data;
  }

  async takedownDocument(documentId, data) {
    const response = await this.client.post(
      `/admin/documents/${documentId}/takedown`,
      data,
    );
    return response.data;
  }

  async restoreAdminDocument(documentId, data = {}) {
    const response = await this.client.post(
      `/admin/documents/${documentId}/restore`,
      data,
    );
    return response.data;
  }

  async reprocessAdminDocument(documentId) {
    const response = await this.client.post(
      `/admin/documents/${documentId}/reprocess`,
    );
    return response.data;
  }

  async regenerateAdminThumbnail(documentId) {
    const response = await this.client.post(
      `/admin/documents/${documentId}/thumbnail`,
    );
    return response.data;
  }

  async getModerationQueue(params) {
    const response = await this.client.get("/admin/moderation/queue", {
      params,
    });
    return response.data;
  }

  async processModerationItem(reportId, data) {
    const response = await this.client.post(
      `/admin/moderation/${reportId}/process`,
      data,
    );
    return response.data;
  }

  async updateAdminDocument(documentId, data) {
    const response = await this.client.patch(
      `/admin/documents/${documentId}`,
      data,
    );
    return response.data;
  }

  async startFetchJob(category, count) {
    const response = await this.client.post("/admin/fetch-docs", {
      category,
      count,
    });
    return response.data;
  }

  async getFetchJobStatus(jobId) {
    const response = await this.client.get(`/admin/fetch-docs/${jobId}`);
    return response.data;
  }
}

export const apiService = new APIService();
