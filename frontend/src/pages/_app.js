import { AuthProvider } from '../contexts/AuthContext.js';
import dynamic from 'next/dynamic';
import '../styles/globals.css';
import { UploadProvider } from "../contexts/UploadContext.jsx";
import GlobalUploadWidget from "../components/GlobalUploadWidget.jsx";

const Toaster = dynamic(
  () => import('react-hot-toast').then((mod) => ({ default: mod.Toaster })),
  { ssr: false }
);

export default function App({ Component, pageProps }) {
  return (
    <AuthProvider>
      <UploadProvider>
      <GlobalUploadWidget />
      <Component {...pageProps} />
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