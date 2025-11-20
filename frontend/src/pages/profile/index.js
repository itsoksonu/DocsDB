import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '../../contexts/AuthContext';
import { apiService } from '../../services/api';
import { DesktopNavbar } from '../../components/layout/DesktopNavbar';
import { DocumentCard } from '../../components/common/DocumentCard';
import { DocumentSkeleton } from '../../components/ui/Skeleton';
import { Edit, Save, X, Upload, Bookmark, Image, Mail } from '../../icons';
import toast from 'react-hot-toast';
import Footer from "../../components/layout/Footer";

const ProfilePage = () => {
  const { user, updateUser } = useAuth();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('uploaded');
  const [uploadedDocs, setUploadedDocs] = useState([]);
  const [savedDocs, setSavedDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    avatar: ''
  });
  const [uploadLoading, setUploadLoading] = useState(false);
  const [savedLoading, setSavedLoading] = useState(false);

  useEffect(() => {
    if (router.query.tab === 'saved') {
      setActiveTab('saved');
    } else if (router.query.tab === 'uploaded') {
      setActiveTab('uploaded');
    }
  }, [router.query.tab]);

  useEffect(() => {
    if (user) {
      setFormData({
        name: user.name || '',
        avatar: user.avatar || ''
      });
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      loadDocuments();
    }
  }, [activeTab, user]);

  const loadDocuments = async () => {
    setLoading(true);
    try {
      if (activeTab === 'uploaded') {
        await loadUploadedDocuments();
      } else {
        await loadSavedDocuments();
      }
    } catch (error) {
      console.error('Error loading documents:', error);
      toast.error('Failed to load documents');
    } finally {
      setLoading(false);
    }
  };

  const loadUploadedDocuments = async () => {
    setUploadLoading(true);
    try {
      const response = await apiService.getUserDocuments({
        status: 'all',
        limit: 50
      });
      setUploadedDocs(response.data.documents || []);
    } catch (error) {
      console.error('Error loading uploaded documents:', error);
      setUploadedDocs([]);
    } finally {
      setUploadLoading(false);
    }
  };

  const loadSavedDocuments = async () => {
    setSavedLoading(true);
    try {
      const response = await apiService.getSavedDocuments({ limit: 50 });
      setSavedDocs(response.data.documents || []);
    } catch (error) {
      console.error('Error loading saved documents:', error);
      setSavedDocs([]);
    } finally {
      setSavedLoading(false);
    }
  };

  const handleEditToggle = () => {
    if (editing) {
      setFormData({
        name: user.name || '',
        avatar: user.avatar || ''
      });
    }
    setEditing(!editing);
  };

  const handleSaveProfile = async () => {
    if (!formData.name.trim()) {
      toast.error('Name is required');
      return;
    }

    try {
      await updateUser({
        name: formData.name.trim(),
        avatar: formData.avatar.trim() || user.avatar
      });
      
      setEditing(false);
      toast.success('Profile updated successfully');
    } catch (error) {
      console.error('Error updating profile:', error);
      toast.error('Failed to update profile');
    }
  };

  const handleInputChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleAvatarUpload = (event) => {
    const file = event.target.files[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        toast.error('Image size should be less than 5MB');
        return;
      }

      if (!file.type.startsWith('image/')) {
        toast.error('Please upload an image file');
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        setFormData(prev => ({
          ...prev,
          avatar: e.target.result
        }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleUploadClick = () => {
    router.push('/upload');
  };

  const currentDocs = activeTab === 'uploaded' ? uploadedDocs : savedDocs;
  const isLoading = loading || (activeTab === 'uploaded' ? uploadLoading : savedLoading);

  if (!user) {
    return (
      <div className="min-h-screen bg-dark-950 text-white">
        <DesktopNavbar onUploadClick={handleUploadClick} />
        <div className="pt-24 flex items-center justify-center px-4">
          <div className="text-center">
            <h1 className="text-xl md:text-2xl font-bold mb-4">Please sign in to view your profile</h1>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-dark-950 text-white">
      <DesktopNavbar onUploadClick={handleUploadClick} />
      
      <div className="pt-20 md:pt-24 max-w-6xl mx-auto px-2 md:px-4 pb-8">
        {/* Profile Header */}
        <div className="bg-dark-900/50 backdrop-blur-sm rounded-xl md:rounded-2xl p-4 md:p-8 mb-6 md:mb-8 border border-dark-800/50">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
            <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4 md:gap-6 w-full md:w-auto">
              {/* Avatar Section */}
              <div className="relative flex-shrink-0">
                {editing ? (
                  <>
                    <div className="w-20 h-20 md:w-24 md:h-24 rounded-full bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center text-white text-xl md:text-2xl font-medium relative overflow-hidden">
                      {formData.avatar ? (
                        <img
                          src={formData.avatar}
                          alt="Profile"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        user.name?.charAt(0).toUpperCase()
                      )}
                    </div>
                    <label className="absolute -bottom-1 -right-1 md:-bottom-2 md:-right-2 bg-blue-500 hover:bg-blue-600 text-white p-1.5 md:p-2 rounded-full cursor-pointer transition-colors">
                      <Image size={14} className="md:w-4 md:h-4" />
                      <input
                        type="file"
                        className="hidden"
                        accept="image/*"
                        onChange={handleAvatarUpload}
                      />
                    </label>
                  </>
                ) : (
                  <div className="w-20 h-20 md:w-24 md:h-24 rounded-full bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center text-white text-xl md:text-2xl font-medium">
                    {user.avatar ? (
                      <img
                        src={user.avatar}
                        alt={user.name}
                        className="w-full h-full rounded-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      user.name?.charAt(0).toUpperCase()
                    )}
                  </div>
                )}
              </div>

              {/* User Info */}
              <div className="flex-1 w-full text-center sm:text-left">
                {editing ? (
                  <div className="space-y-3 md:space-y-4">
                    <div>
                      <label className="block text-xs md:text-sm font-medium text-dark-300 mb-1.5 md:mb-2">
                        Name
                      </label>
                      <input
                        type="text"
                        value={formData.name}
                        onChange={(e) => handleInputChange('name', e.target.value)}
                        className="w-full bg-dark-800/50 border border-dark-700 rounded-lg px-3 md:px-4 py-2 text-sm md:text-base text-white focus:outline-none focus:border-blue-500 transition-colors"
                        placeholder="Enter your name"
                      />
                    </div>
                    <div>
                      <label className="block text-xs md:text-sm font-medium text-dark-300 mb-1.5 md:mb-2">
                        Avatar URL
                      </label>
                      <input
                        type="url"
                        value={formData.avatar}
                        onChange={(e) => handleInputChange('avatar', e.target.value)}
                        className="w-full bg-dark-800/50 border border-dark-700 rounded-lg px-3 md:px-4 py-2 text-sm md:text-base text-white focus:outline-none focus:border-blue-500 transition-colors"
                        placeholder="Paste image URL"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2 md:space-y-3">
                    <h1 className="text-2xl md:text-3xl font-bold text-white">{user.name}</h1>
                    <div className="flex items-center justify-center sm:justify-start gap-2 text-dark-300 text-sm md:text-base">
                      <Mail size={14} className="md:w-4 md:h-4 flex-shrink-0" />
                      <span className="truncate">{user.email}</span>
                    </div>
                    <div className="flex items-center justify-center sm:justify-start gap-3 md:gap-4 text-xs md:text-sm text-dark-400">
                      <span className="whitespace-nowrap">{uploadedDocs.length} uploaded</span>
                      <span className="whitespace-nowrap">{savedDocs.length} saved</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Edit/Save Buttons */}
            <div className="flex justify-center md:justify-start gap-2 w-full md:w-auto">
              {editing ? (
                <>
                  <button
                    onClick={handleSaveProfile}
                    className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors text-sm md:text-base flex-1 md:flex-initial"
                  >
                    <Save size={14} className="md:w-4 md:h-4" />
                    Save
                  </button>
                  <button
                    onClick={handleEditToggle}
                    className="flex items-center justify-center gap-2 px-4 py-2 bg-dark-800 hover:bg-dark-700 text-white rounded-lg transition-colors text-sm md:text-base flex-1 md:flex-initial"
                  >
                    <X size={14} className="md:w-4 md:h-4" />
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  onClick={handleEditToggle}
                  className="flex items-center justify-center gap-2 px-4 py-2 bg-dark-800 hover:bg-dark-700 text-white rounded-lg transition-colors text-sm md:text-base w-full md:w-auto"
                >
                  <Edit size={14} className="md:w-4 md:h-4" />
                  Edit Profile
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Tabs Section */}
        <div className="bg-dark-900/50 backdrop-blur-sm rounded-xl md:rounded-2xl p-3 md:p-6 border border-dark-800/50">
          {/* Tabs Navigation */}
          <div className="flex border-b border-dark-800 mb-4 md:mb-6 overflow-x-auto">
            <button
              onClick={() => setActiveTab('uploaded')}
              className={`flex items-center gap-1.5 md:gap-2 px-3 md:px-6 py-2.5 md:py-3 border-b-2 transition-all whitespace-nowrap text-sm md:text-base ${
                activeTab === 'uploaded'
                  ? 'border-blue-500 text-blue-500'
                  : 'border-transparent text-dark-400 hover:text-white'
              }`}
            >
              <Upload size={16} className="md:w-[18px] md:h-[18px]" />
              <span className="hidden sm:inline">Uploaded Documents</span>
              <span className="sm:hidden">Uploaded</span>
              <span className="bg-dark-800 text-dark-300 text-xs px-1.5 md:px-2 py-0.5 md:py-1 rounded-full ml-1 md:ml-2">
                {uploadedDocs.length}
              </span>
            </button>
            <button
              onClick={() => setActiveTab('saved')}
              className={`flex items-center gap-1.5 md:gap-2 px-3 md:px-6 py-2.5 md:py-3 border-b-2 transition-all whitespace-nowrap text-sm md:text-base ${
                activeTab === 'saved'
                  ? 'border-blue-500 text-blue-500'
                  : 'border-transparent text-dark-400 hover:text-white'
              }`}
            >
              <Bookmark size={16} className="md:w-[18px] md:h-[18px]" />
              <span className="hidden sm:inline">Saved Documents</span>
              <span className="sm:hidden">Saved</span>
              <span className="bg-dark-800 text-dark-300 text-xs px-1.5 md:px-2 py-0.5 md:py-1 rounded-full ml-1 md:ml-2">
                {savedDocs.length}
              </span>
            </button>
          </div>

          {/* Tab Content */}
          <div className="min-h-[400px]">
            {isLoading ? (
              <div className="flex flex-wrap gap-4 md:gap-6 justify-center">
                {Array.from({ length: 12 }).map((_, i) => (
                  <DocumentSkeleton key={i} />
                ))}
              </div>
            ) : currentDocs.length > 0 ? (
              <div className="flex flex-wrap gap-4 md:gap-6 justify-center">
                {currentDocs.map((document) => (
                  <DocumentCard key={document._id} document={document} />
                ))}
              </div>
            ) : (
              <div className="text-center py-12 md:py-16 px-4">
                <div className="w-20 h-20 md:w-24 md:h-24 bg-dark-800/50 rounded-full flex items-center justify-center mx-auto mb-4">
                  {activeTab === 'uploaded' ? (
                    <Upload size={28} className="md:w-8 md:h-8 text-dark-400" />
                  ) : (
                    <Bookmark size={28} className="md:w-8 md:h-8 text-dark-400" />
                  )}
                </div>
                <h3 className="text-lg md:text-xl font-semibold text-white mb-2">
                  {activeTab === 'uploaded' ? 'No documents uploaded yet' : 'No documents saved yet'}
                </h3>
                <p className="text-sm md:text-base text-dark-400 mb-6 max-w-md mx-auto">
                  {activeTab === 'uploaded' 
                    ? 'Start sharing your knowledge by uploading your first document.'
                    : 'Save interesting documents to access them quickly later.'
                  }
                </p>
                {activeTab === 'uploaded' && (
                  <button
                    onClick={handleUploadClick}
                    className="inline-flex items-center gap-2 px-5 md:px-6 py-2.5 md:py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors text-sm md:text-base"
                  >
                    <Upload size={16} className="md:w-[18px] md:h-[18px]" />
                    Upload Your First Document
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
         {/* Footer Section */}
        <Footer />
    </div>
  );
};

export default ProfilePage;