import { createContext, useContext, useEffect, useState, useRef } from "react";
import { apiService } from "../services/api";

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const refreshIntervalRef = useRef(null);
  const isInitialMount = useRef(true);

  useEffect(() => {
    // Only run checkAuth on initial mount
    if (isInitialMount.current) {
      isInitialMount.current = false;
      checkAuth();
    }

    // Set up refresh interval
    refreshIntervalRef.current = setInterval(() => {
      if (user) {
        refreshTokenSilently();
      }
    }, 13 * 60 * 1000); // Refresh every 13 minutes

    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, [user]);

  const checkAuth = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem("accessToken");

      if (!token) {
        // No access token, try to get one using refresh token
        console.log("No access token found, attempting to refresh...");
        const refreshSuccess = await refreshTokenSilently();

        if (!refreshSuccess) {
          console.log("No valid session found");
          setLoading(false);
          return;
        }
      }

      // Try to get user data
      try {
        const response = await apiService.getCurrentUser();
        setUser(response.data.user);
        console.log("User authenticated successfully");
      } catch (error) {
        // If getCurrentUser fails, try refreshing token
        console.log("Failed to get user, attempting token refresh...");
        const refreshSuccess = await refreshTokenSilently();

        if (refreshSuccess) {
          // Try getting user again after successful refresh
          try {
            const response = await apiService.getCurrentUser();
            setUser(response.data.user);
            console.log("User authenticated after refresh");
          } catch (retryError) {
            console.error("Failed to get user after refresh:", retryError);
            localStorage.removeItem("accessToken");
          }
        } else {
          localStorage.removeItem("accessToken");
        }
      }
    } catch (error) {
      console.error("Auth check failed:", error);
      localStorage.removeItem("accessToken");
    } finally {
      setLoading(false);
    }
  };

  const refreshTokenSilently = async () => {
    if (refreshing) {
      console.log("Refresh already in progress, skipping...");
      return false;
    }

    setRefreshing(true);
    try {
      console.log("Attempting to refresh token...");
      const response = await apiService.refreshToken();
      const newAccessToken = response.data.accessToken;

      if (newAccessToken) {
        localStorage.setItem("accessToken", newAccessToken);
        console.log("Token refreshed successfully");

        // Fetch user data if we don't have it
        if (!user) {
          try {
            const userResponse = await apiService.getCurrentUser();
            setUser(userResponse.data.user);
            console.log("User data fetched after refresh");
          } catch (err) {
            console.error("Failed to fetch user after refresh:", err);
          }
        }

        return true;
      }
      return false;
    } catch (error) {
      console.error("Token refresh failed:", error);

      // Only logout if it's a 401 (unauthorized) error
      if (error.response?.status === 401) {
        console.log("Refresh token expired, clearing session...");
        localStorage.removeItem("accessToken");
        setUser(null);
      }

      return false;
    } finally {
      setRefreshing(false);
    }
  };

  const oauthLogin = async (oauthData) => {
    const response = await apiService.oauthLogin(oauthData);
    localStorage.setItem("accessToken", response.data.accessToken);
    setUser(response.data.user);
    return response;
  };

  const handleGoogleOAuth = async (googleResponse) => {
    try {
      const credential = googleResponse.credential;

      if (!credential) {
        throw new Error("No credential received from Google");
      }

      const payload = JSON.parse(atob(credential.split(".")[1]));

      const oauthData = {
        provider: "google",
        accessToken: credential,
        providerId: payload.sub,
        email: payload.email,
        name: payload.name,
        avatar: payload.picture,
      };

      const response = await apiService.oauthLogin(oauthData);
      localStorage.setItem("accessToken", response.data.accessToken);
      setUser(response.data.user);

      return response;
    } catch (error) {
      console.error("Google OAuth login failed:", error);
      throw error;
    }
  };

  const logout = async () => {
    try {
      await apiService.logout();
    } catch (error) {
      console.error("Logout error:", error);
    } finally {
      localStorage.removeItem("accessToken");
      setUser(null);

      // Clear the refresh interval
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    }
  };

  const value = {
    user,
    oauthLogin,
    handleGoogleOAuth,
    logout,
    loading,
    refreshing,
    refreshToken: refreshTokenSilently,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
