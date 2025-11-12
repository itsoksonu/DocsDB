// src/components/common/DocumentCard.jsx
import { useState } from 'react';
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
  Share2
} from '../../icons';
import { Dropdown, DropdownItem } from '../ui/Dropdown';

export const DocumentCard = ({ document }) => {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  return (
    <div className="group bg-dark-800 rounded-xl p-3 border border-dark-600 hover:border-dark-400 transition-all duration-300 cursor-pointer w-36 h-[17rem]">
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
                <DropdownItem 
                  icon={Bookmark} 
                  label="Save for later" 
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsDropdownOpen(false);
                    // Handle save
                  }}
                />
                <DropdownItem 
                  icon={Download} 
                  label="Download" 
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsDropdownOpen(false);
                    // Handle download
                  }}
                />
                <DropdownItem 
                  icon={Share2} 
                  label="Share" 
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsDropdownOpen(false);
                    // Handle share
                  }}
                />
                <DropdownItem 
                  icon={Sparkles} 
                  label="Show more like this" 
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsDropdownOpen(false);
                    // Handle show more
                  }}
                />
                <div className="border-t border-dark-600" />
                <DropdownItem 
                  icon={EyeOff} 
                  label="Don't show again" 
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsDropdownOpen(false);
                    // Handle hide
                  }}
                />
                <DropdownItem 
                  icon={Flag} 
                  label="Report" 
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsDropdownOpen(false);
                    // Handle report
                  }}
                  className="text-red-400 hover:text-red-300"
                />
              </Dropdown>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};