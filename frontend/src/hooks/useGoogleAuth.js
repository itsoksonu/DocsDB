import { useEffect, useState, useCallback, useMemo } from 'react';
import toast from 'react-hot-toast';

export const useGoogleAuth = () => {
  const [isGoogleLoaded, setIsGoogleLoaded] = useState(false);

  useEffect(() => {
    // Held at effect scope so the cleanup below can clear them. Without that, a
    // component that unmounts within the 5s window leaves a 100ms interval
    // running and calling setState on a dead component.
    let pollId;
    let timeoutId;

    const initializeGoogleAuth = () => {
      if (window.google?.accounts?.id) {
        setIsGoogleLoaded(true);
        return;
      }

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
        pollId = setInterval(() => {
          if (window.google?.accounts?.id) {
            setIsGoogleLoaded(true);
            clearInterval(pollId);
          }
        }, 100);

        timeoutId = setTimeout(() => {
          clearInterval(pollId);
          if (!window.google?.accounts?.id) {
            console.error('Google OAuth not available after timeout');
          }
        }, 5000);
      }
    };

    initializeGoogleAuth();

    return () => {
      clearInterval(pollId);
      clearTimeout(timeoutId);
    };
  }, []);

  // Everything below is memoized, and the returned object with it. Callers
  // (DesktopNavbar, Footer) name initializeGoogleOneTap in effect dependency
  // arrays; with a fresh function on every render those effects would re-run
  // continuously and re-initialize Google One Tap each time.
  //
  // Declared in dependency order: triggerGoogleOAuthPopup, then the prompt that
  // falls back to it, then initialize.
  const triggerGoogleOAuthPopup = useCallback(() => {
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
  }, []);

  const promptGoogleOneTap = useCallback(() => {
    if (!window.google?.accounts?.id) {
      throw new Error('Google OAuth not available');
    }

    window.google.accounts.id.prompt((notification) => {
      if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
        triggerGoogleOAuthPopup();
      }
    });
  }, [triggerGoogleOAuthPopup]);

  const initializeGoogleOneTap = useCallback((clientId, callback) => {
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
  }, []);

  return useMemo(
    () => ({
      isGoogleLoaded,
      initializeGoogleOneTap,
      promptGoogleOneTap,
      triggerGoogleOAuthPopup
    }),
    [
      isGoogleLoaded,
      initializeGoogleOneTap,
      promptGoogleOneTap,
      triggerGoogleOAuthPopup
    ]
  );
};