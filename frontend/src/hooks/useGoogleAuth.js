// src/hooks/useGoogleAuth.js
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';

export const useGoogleAuth = () => {
  const [isGoogleLoaded, setIsGoogleLoaded] = useState(false);

  useEffect(() => {
    const initializeGoogleAuth = () => {
      if (window.google?.accounts?.id) {
        setIsGoogleLoaded(true);
        return;
      }

      // Load Google OAuth script if not already loaded
      if (!document.querySelector('script[src*="accounts.google.com"]')) {
        const script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.defer = true;
        script.onload = () => {
          setIsGoogleLoaded(true);
        };
        script.onerror = () => {
          console.error('Failed to load Google OAuth script');
          toast.error('Failed to load sign-in service');
        };
        document.head.appendChild(script);
      } else {
        // Script already exists, check if Google is available
        const checkGoogle = setInterval(() => {
          if (window.google?.accounts?.id) {
            setIsGoogleLoaded(true);
            clearInterval(checkGoogle);
          }
        }, 100);

        // Timeout after 5 seconds
        setTimeout(() => {
          clearInterval(checkGoogle);
          if (!window.google?.accounts?.id) {
            console.error('Google OAuth not available after timeout');
          }
        }, 5000);
      }
    };

    initializeGoogleAuth();
  }, []);

  const initializeGoogleOneTap = (clientId, callback) => {
    if (!window.google?.accounts?.id) {
      console.error('Google OAuth not available');
      return false;
    }

    try {
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: callback,
        auto_select: false,
        cancel_on_tap_outside: true,
        context: 'use'
      });

      return true;
    } catch (error) {
      console.error('Failed to initialize Google One Tap:', error);
      return false;
    }
  };

  const promptGoogleOneTap = () => {
    if (!window.google?.accounts?.id) {
      throw new Error('Google OAuth not available');
    }

    window.google.accounts.id.prompt((notification) => {
      if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
        // Fallback to regular OAuth flow
        triggerGoogleOAuthPopup();
      }
    });
  };

  const triggerGoogleOAuthPopup = () => {
    // Fallback to traditional OAuth popup
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    const redirectUri = process.env.NEXT_PUBLIC_GOOGLE_REDIRECT_URI || `${window.location.origin}/auth/callback`;
    
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'openid profile email');
    authUrl.searchParams.set('state', 'google_oauth');
    authUrl.searchParams.set('prompt', 'consent');

    window.location.href = authUrl.toString();
  };

  return {
    isGoogleLoaded,
    initializeGoogleOneTap,
    promptGoogleOneTap,
    triggerGoogleOAuthPopup
  };
};