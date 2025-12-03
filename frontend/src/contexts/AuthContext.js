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

    const interval = setInterval(() => {
      refreshTokenSilently();
    }, 10 * 60 * 1000); // Refresh every 10 minutes to ensure tokens don't expire

    return () => clearInterval(interval);
  }, []);

  const checkAuth = async () => {
    try {
      const token = localStorage.getItem("accessToken");
      if (token) {
        const response = await apiService.getCurrentUser();
        setUser(response.data.data.user);
      }
    } catch (error) {
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

      // Don't fetch user data again after refresh to avoid potential issues
      // The user state should remain valid with the refreshed token
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
