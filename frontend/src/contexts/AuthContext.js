// src/contexts/AuthContext.js
import { createContext, useContext, useEffect, useState } from "react";
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

  useEffect(() => {
    checkAuth();

    // Set up token refresh interval
    const interval = setInterval(() => {
      refreshTokenSilently();
    }, 25 * 60 * 1000); // Refresh every 25 minutes

    return () => clearInterval(interval);
  }, []);

  const checkAuth = async () => {
    try {
      const token = localStorage.getItem("accessToken");
      if (token) {
        const response = await apiService.getCurrentUser();
        setUser(response.data.user); // Fixed: response.data.user (getCurrentUser returns {success, data: {user}})
      }
    } catch (error) {
      // Token might be expired, try to refresh
      await refreshTokenSilently();
    } finally {
      setLoading(false);
    }
  };

  const refreshTokenSilently = async () => {
    if (refreshing) return;

    setRefreshing(true);
    try {
      const response = await apiService.refreshToken();
      localStorage.setItem("accessToken", response.data.data.accessToken);

      const userResponse = await apiService.getCurrentUser();
      setUser(userResponse.data.data.user);
    } catch (error) {
      await logout();
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
      // Extract the credential (JWT token) from the response
      const credential = googleResponse.credential;

      if (!credential) {
        throw new Error("No credential received from Google");
      }

      // Decode the JWT to get user info (optional, for logging)
      const payload = JSON.parse(atob(credential.split(".")[1]));

      const oauthData = {
        provider: "google",
        accessToken: credential, // This is the JWT token
        providerId: payload.sub, // Use 'sub' as providerId
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
    }
  };

  const value = {
    user,
    oauthLogin,
    handleGoogleOAuth,
    logout,
    loading,
    refreshing,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
