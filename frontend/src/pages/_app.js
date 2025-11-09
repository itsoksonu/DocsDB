// src/pages/_app.jsx
import { AuthProvider } from '../contexts/AuthContext.js';
import { SearchModal } from '../components/common/SearchModal.jsx';
import { ProfileModal } from '../components/common/ProfileModal.jsx';
import { SettingsModal } from '../components/common/SettingsModal.jsx';
import { Toaster } from 'react-hot-toast';
import '../styles/globals.css';

export default function App({ Component, pageProps }) {

  return (
    <AuthProvider>
      <Component {...pageProps} />
      <SearchModal />
      <ProfileModal />
      <SettingsModal />
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
    </AuthProvider>
  );
}