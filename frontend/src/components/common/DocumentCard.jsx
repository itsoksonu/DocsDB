// src/components/common/DocumentCard.jsx
import { useState } from 'react';
import { 
  FileText, 
  Eye, 
  Download,
  User 
} from '../../icons';

export const DocumentCard = ({ document }) => {
  const [imageLoaded, setImageLoaded] = useState(false);

  console.log(document.thumbnailUrl)

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
            <div className="flex items-center gap-3 text-xs text-dark-400">
              <div className="flex items-center gap-1">
                <Eye size={10} />
                <span>{document.viewsCount || 0}</span>
              </div>
              <div className="flex items-center gap-1">
                <Download size={10} />
                <span>{document.downloadsCount || 0}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};