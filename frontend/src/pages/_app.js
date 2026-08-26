import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { AuthProvider } from '../contexts/AuthContext.js';
import dynamic from 'next/dynamic';
import '../styles/globals.css';
import { UploadProvider } from "../contexts/UploadContext.jsx";
import GlobalUploadWidget from "../components/GlobalUploadWidget.jsx";
import { DesktopNavbar } from "../components/layout/DesktopNavbar.jsx";
import { DocumentViewerSkeleton } from "../components/ui/DocumentViewerSkeleton.jsx";

const Toaster = dynamic(
  () => import('react-hot-toast').then((mod) => ({ default: mod.Toaster })),
  { ssr: false }
);

/**
 * The document page is server-rendered for SEO, which means a click waits for
 * getServerSideProps to run before anything on screen changes - the old page
 * just sits there looking unresponsive.
 *
 * Rendering the skeleton as soon as the route change starts makes the
 * navigation itself instant; the data then fills it in. The skeleton already
 * existed for the direct-load case, so this only changes when it is shown.
 */
function useDocumentNavigation() {
  const router = useRouter();
  const [navigating, setNavigating] = useState(false);

  useEffect(() => {
    const start = (url) => setNavigating(String(url).startsWith("/document/"));
    const stop = () => setNavigating(false);

    router.events.on("routeChangeStart", start);
    router.events.on("routeChangeComplete", stop);
    router.events.on("routeChangeError", stop);

    return () => {
      router.events.off("routeChangeStart", start);
      router.events.off("routeChangeComplete", stop);
      router.events.off("routeChangeError", stop);
    };
  }, [router]);

  return navigating;
}

export default function App({ Component, pageProps }) {
  const navigatingToDocument = useDocumentNavigation();

  return (
    <AuthProvider>
      <UploadProvider>
      <GlobalUploadWidget />
      {navigatingToDocument ? (
        <div className="min-h-screen bg-dark-950 text-white">
          <DesktopNavbar />
          <DocumentViewerSkeleton />
        </div>
      ) : (
        <Component {...pageProps} />
      )}
      <Toaster
        position="top-center"
        toastOptions={{
          duration: 4000,
          style: {
            background: '#1e293b',
            color: '#f1f5f9',
            border: '1px solid #334155'
          }
        }}
      />
      </UploadProvider>
    </AuthProvider>
  );
}
