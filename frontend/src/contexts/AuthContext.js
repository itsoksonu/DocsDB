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

  useEffect(() => {
    checkAuth();

    // Refresh token every 13 minutes (before 15min expiry)
    refreshIntervalRef.current = setInterval(() => {
      if (user) {
        refreshTokenSilently();
      }
    }, 13 * 60 * 1000);

    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, [user]);

  const checkAuth = async () => {
    try {
      const token = localStorage.getItem("accessToken");
      if (token) {
        const response = await apiService.getCurrentUser();
        setUser(response.data.data.user);
      }
    } catch (error) {
      // If getCurrentUser fails, try to refresh the token
      console.log("Initial auth check failed, attempting token refresh...");
      const refreshSuccess = await refreshTokenSilently();
      
      // Only if refresh also fails, clear the token
      if (!refreshSuccess) {
        localStorage.removeItem("accessToken");
      }
    } finally {
      setLoading(false);
    }
  };

  const refreshTokenSilently = async () => {
    if (refreshing) return false;

    setRefreshing(true);
    try {
      const response = await apiService.refreshToken();
      const newAccessToken = response.data.data.accessToken || response.data.accessToken;
      
      if (newAccessToken) {
        localStorage.setItem("accessToken", newAccessToken);
        
        // Fetch user data if we don't have it
        if (!user) {
          try {
            const userResponse = await apiService.getCurrentUser();
            setUser(userResponse.data.data.user);
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
      // This means the refresh token is invalid/expired
      if (error.response?.status === 401) {
        console.log("Refresh token expired, logging out...");
        await logout();
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