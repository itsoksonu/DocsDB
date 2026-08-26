import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  useCallback,
  useMemo,
} from "react";
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

  // `refreshing` stays as state because it is published on the context, but the
  // in-flight check below reads this ref instead. setState is asynchronous, so
  // two calls landing in the same tick could both see refreshing === false and
  // both fire a refresh - the mutex only actually holds as a ref.
  const refreshingRef = useRef(false);

  // The interval and the refresh callback need the current user without either
  // of them depending on it. Reading state directly meant the 13-minute interval
  // was torn down and rebuilt on every user change.
  const userRef = useRef(user);
  useEffect(() => {
    userRef.current = user;
  }, [user]);

  // Declared before checkAuth, which depends on it. A dependency array is
  // evaluated during render, so the callback it names has to already exist.
  const refreshTokenSilently = useCallback(async () => {
    if (refreshingRef.current) {
      return false;
    }

    refreshingRef.current = true;
    setRefreshing(true);
    try {
      const response = await apiService.refreshToken();
      const newAccessToken = response.data.accessToken;

      if (newAccessToken) {
        localStorage.setItem("accessToken", newAccessToken);

        // Fetch user data if we don't have it
        if (!userRef.current) {
          try {
            const userResponse = await apiService.getCurrentUser();
            setUser(userResponse.data.user);
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
        localStorage.removeItem("accessToken");
        setUser(null);
      }

      return false;
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
    // Reads user and the in-flight flag through refs, so this callback is
    // created once and the interval below is never rebuilt.
  }, []);

  const checkAuth = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem("accessToken");

      if (!token) {
        // No access token, try to get one using refresh token
        const refreshSuccess = await refreshTokenSilently();

        if (!refreshSuccess) {
          setLoading(false);
          return;
        }
      }

      // Try to get user data
      try {
        const response = await apiService.getCurrentUser();
        setUser(response.data.user);
      } catch (error) {
        // If getCurrentUser fails, try refreshing token
        const refreshSuccess = await refreshTokenSilently();

        if (refreshSuccess) {
          // Try getting user again after successful refresh
          try {
            const response = await apiService.getCurrentUser();
            setUser(response.data.user);
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
  }, [refreshTokenSilently]);

  // Both callbacks above are stable, so this runs once: the 13-minute interval
  // is created a single time instead of being torn down and rebuilt on every
  // change to `user`.
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      checkAuth();
    }

    refreshIntervalRef.current = setInterval(() => {
      if (userRef.current) {
        refreshTokenSilently();
      }
    }, 13 * 60 * 1000);

    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, [checkAuth, refreshTokenSilently]);

  // Memoized like the callbacks above, and the context value with them. Footer
  // and DesktopNavbar build a `handleGoogleResponse` callback around
  // handleGoogleOAuth and name it in an effect dependency array, so an unstable
  // function here would re-initialize Google One Tap on every render.
  const oauthLogin = useCallback(async (oauthData) => {
    const response = await apiService.oauthLogin(oauthData);
    localStorage.setItem("accessToken", response.data.accessToken);
    setUser(response.data.user);
    return response;
  }, []);

  const updateUser = useCallback(async (data) => {
    try {
      const response = await apiService.updateProfile(data);
      if (response && response.data && response.data.user) {
        setUser(response.data.user);
        return response.data.user;
      }
      return null;
    } catch (error) {
      console.error("Error updating user:", error);
      throw error;
    }
  }, []);

  const handleGoogleOAuth = useCallback(async (googleResponse) => {
    try {
      const credential = googleResponse.credential;

      if (!credential) {
        throw new Error("No credential received from Google");
      }

      // Send only the credential. Identity (sub/email/name/picture) is read from
      // the verified ID token on the server - decoding it here and posting the
      // fields separately meant a crafted body could claim another account.
      const response = await apiService.oauthLogin({
        provider: "google",
        accessToken: credential,
      });
      localStorage.setItem("accessToken", response.data.accessToken);
      setUser(response.data.user);

      return response;
    } catch (error) {
      console.error("Google OAuth login failed:", error);
      throw error;
    }
  }, []);

  const logout = useCallback(async () => {
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
  }, []);

  const value = useMemo(
    () => ({
      user,
      updateUser,
      oauthLogin,
      handleGoogleOAuth,
      logout,
      loading,
      refreshing,
      refreshToken: refreshTokenSilently,
    }),
    [
      user,
      updateUser,
      oauthLogin,
      handleGoogleOAuth,
      logout,
      loading,
      refreshing,
      refreshTokenSilently,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
