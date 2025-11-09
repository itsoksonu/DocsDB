// src/components/common/DocumentCard.jsx
import { useState } from 'react';
import { 
  FileText, 
  Eye, 
  Download, 
  Calendar,
  User 
} from '../../icons';

export const DocumentCard = ({ document }) => {
  const [imageLoaded, setImageLoaded] = useState(false);

  return (
    <div className="group bg-dark-800 rounded-2xl p-6 border border-dark-600 hover:border-dark-400 transition-all duration-300">
      <div className="flex items-start gap-4">
        {/* Thumbnail */}
        <div className="relative w-16 h-20 flex-shrink-0 overflow-hidden rounded-xl bg-dark-700">
          {document.thumbnailS3Path ? (
            <img
              src={document.thumbnailS3Path}
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
        <div className="flex-1 space-y-3">
          <h3 className="font-semibold text-white line-clamp-1 group-hover:text-blue-300 transition-colors">
            {document.generatedTitle}
          </h3>
          
          <p className="text-dark-300 text-sm line-clamp-1">
            {document.generatedDescription}
          </p>

          {/* Tags */}
          <div className="flex flex-wrap gap-2">
            {document.tags?.slice(0, 2).map((tag, index) => (
              <span
                key={index}
                className="px-2 py-1 bg-dark-700 text-dark-300 text-xs rounded-full"
              >
                #{tag}
              </span>
            ))}
          </div>

          {/* Metadata */}
          <div className="flex items-center gap-4 text-xs text-dark-400">
            <div className="flex items-center gap-1">
              <User size={14} />
              <span>{document.userId?.name || 'Unknown'}</span>
            </div>
            <div className="flex items-center gap-1">
              <Calendar size={14} />
              <span>{new Date(document.createdAt).toLocaleDateString()}</span>
            </div>
            <div className="flex items-center gap-1">
              <Eye size={14} />
              <span>{document.viewsCount || 0}</span>
            </div>
            <div className="flex items-center gap-1">
              <Download size={14} />
              <span>{document.downloadsCount || 0}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};