import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { 
  FileText, 
  Eye, 
  Download,
  User,
  MoreVertical,
  Bookmark,
  Sparkles,
  EyeOff,
  Flag,
  Share2,
  BookmarkCheck
} from '../../icons';
import { Dropdown, DropdownItem } from '../ui/Dropdown';
import { apiService } from '../../services/api';
import toast from 'react-hot-toast';

export const DocumentCard = ({ document }) => {
  const router = useRouter();
  const [imageLoaded, setImageLoaded] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [hasCheckedStatus, setHasCheckedStatus] = useState(false);

  useEffect(() => {
    if (isDropdownOpen && !hasCheckedStatus) {
      checkSavedStatus();
    }
  }, [isDropdownOpen, hasCheckedStatus]);

  const checkSavedStatus = async () => {
    try {
      const response = await apiService.checkSavedStatus(document._id);
      setIsSaved(response.data.isSaved);
      setHasCheckedStatus(true);
    } catch (error) {
      console.error('Error checking save status:', error);
    }
  };

  const handleCardClick = (e) => {
    if (e.target.closest('.dropdown-trigger') || e.target.closest('.dropdown-menu')) {
      return;
    }
    router.push(`/document/${document._id}`);
  };

  const handleSaveToggle = async (e) => {
    e.stopPropagation();
    
    const token = localStorage.getItem("accessToken");
    if (!token) {
      toast.error("Please login to save documents");
      setIsDropdownOpen(false);
      return;
    }

    if (isSaving) return;

    setIsSaving(true);
    try {
      if (isSaved) {
        await apiService.unsaveDocument(document._id);
        setIsSaved(false);
        toast.success("Document removed from saved");
      } else {
        await apiService.saveDocument(document._id);
        setIsSaved(true);
        toast.success("Document saved");
      }
    } catch (error) {
      console.error('Error toggling save:', error);
      toast.error("Failed to update save status");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDownload = async (e) => {
    e.stopPropagation();
    setIsDropdownOpen(false);
    
    try {
      const response = await apiService.client.get(`/documents/${document._id}/view`);
      const viewUrl = response.data.data.viewUrl;
      window.open(viewUrl, '_blank');
      toast.success('Download started');
    } catch (error) {
      console.error('Error downloading:', error);
      toast.error('Failed to download document');
    }
  };

  const handleShare = async (e) => {
    e.stopPropagation();
    setIsDropdownOpen(false);
    
    const shareUrl = `${window.location.origin}/document/${document._id}`;
    
    if (navigator.share) {
      try {
        await navigator.share({
          title: document.generatedTitle,
          text: document.generatedDescription,
          url: shareUrl,
        });
      } catch (err) {
        if (err.name !== 'AbortError') {
          navigator.clipboard.writeText(shareUrl);
          toast.success('Link copied to clipboard');
        }
      }
    } else {
      navigator.clipboard.writeText(shareUrl);
      toast.success('Link copied to clipboard');
    }
  };

  return (
    <div 
      onClick={handleCardClick}
      className="group bg-dark-800 rounded-xl p-3 border border-dark-600 hover:border-dark-400 transition-all duration-300 cursor-pointer w-36 h-[17rem]"
    >
      <div className="flex flex-col gap-2 h-full">
        {/* Thumbnail */}
        <div className="relative w-full h-40 flex-shrink-0 overflow-hidden rounded-lg bg-dark-700">
          {document.thumbnailS3Path ? (
            <img
              src={document.thumbnailUrl}
              alt={document.generatedTitle}
              className={`w-full h-full object-cover transition-opacity duration-300 ${
                imageLoaded ? 'opacity-100' : 'opacity-0'
              }`}
              onLoad={() => setImageLoaded(true)}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <FileText size={24} className="text-dark-400" />
            </div>
          )}
          {!imageLoaded && document.thumbnailS3Path && (
            <div className="absolute inset-0 bg-dark-700 animate-pulse" />
          )}
          
          {/* File Type Tag */}
          {document.fileType && (
            <div className="absolute top-2 right-2 px-2 py-1 bg-dark-900/80 backdrop-blur-sm rounded text-xs font-medium text-white uppercase">
              {document.fileType}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex flex-col justify-between flex-1 space-y-2">
          {/* Title */}
          <h3 className="font-semibold text-white text-xs line-clamp-2 group-hover:text-blue-300 transition-colors leading-tight">
            {document.generatedTitle}
          </h3>
          
          {/* Bottom section */}
          <div className="space-y-2">
            {/* User info */}
            <div className="flex items-center gap-1 text-xs text-dark-400">
              <User size={10} />
              <span className="line-clamp-1">{document.userId?.name || 'Unknown'}</span>
            </div>

            {/* Views and Downloads */}
            <div className="flex items-center justify-between text-xs text-dark-400">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1">
                  <Eye size={10} />
                  <span>{document.viewsCount || 0}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Download size={10} />
                  <span>{document.downloadsCount || 0}</span>
                </div>
              </div>

              {/* More Options */}
              <div className="dropdown-trigger">
                <Dropdown
                  trigger={
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsDropdownOpen(!isDropdownOpen);
                      }}
                      className="p-1 hover:bg-dark-700 rounded transition-colors"
                    >
                      <MoreVertical size={14} className="text-dark-400 hover:text-white" />
                    </button>
                  }
                  isOpen={isDropdownOpen}
                  onClose={() => setIsDropdownOpen(false)}
                  align="right"
                >
                  <div className="dropdown-menu">
                    <DropdownItem 
                      icon={isSaved ? BookmarkCheck : Bookmark}
                      label={isSaved ? "Remove from saved" : "Save for later"}
                      onClick={handleSaveToggle}
                      disabled={isSaving}
                    />
                    <DropdownItem 
                      icon={Download} 
                      label="Download" 
                      onClick={handleDownload}
                    />
                    <DropdownItem 
                      icon={Share2} 
                      label="Share" 
                      onClick={handleShare}
                    />
                    <DropdownItem 
                      icon={Sparkles} 
                      label="Show more like this" 
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsDropdownOpen(false);
                        router.push(`/?category=${document.category}`);
                      }}
                    />
                    <div className="border-t border-dark-600" />
                    <DropdownItem 
                      icon={EyeOff} 
                      label="Don't show again" 
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsDropdownOpen(false);
                        toast.info('Document hidden');
                      }}
                    />
                    <DropdownItem 
                      icon={Flag} 
                      label="Report" 
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsDropdownOpen(false);
                        toast.info('Report submitted');
                      }}
                      className="text-red-400 hover:text-red-300"
                    />
                  </div>
                </Dropdown>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};