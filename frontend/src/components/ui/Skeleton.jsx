export const Skeleton = ({ className = '' }) => (
  <div className={`animate-pulse bg-dark-700 rounded-lg ${className}`} />
);

export const DocumentSkeleton = () => (
  <div className="bg-dark-800 rounded-xl p-3 border border-dark-600 animate-pulse w-36 h-64">
    <div className="flex flex-col gap-2 h-full">
      {/* Thumbnail Skeleton */}
      <Skeleton className="w-full h-36 rounded-lg" />
      
      {/* Content Skeleton */}
      <div className="flex flex-col justify-between flex-1 space-y-2">
        {/* Title Skeleton */}
        <div className="space-y-1">
          <Skeleton className="h-3 w-full rounded" />
          <Skeleton className="h-3 w-4/5 rounded" />
        </div>
        
        {/* Bottom section Skeleton */}
        <div className="space-y-2">
          {/* User info Skeleton */}
          <div className="flex items-center gap-1">
            <Skeleton className="h-3 w-3 rounded-full" />
            <Skeleton className="h-3 w-20 rounded" />
          </div>

          {/* Views and Downloads Skeleton */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <Skeleton className="h-3 w-3 rounded-full" />
              <Skeleton className="h-3 w-6 rounded" />
            </div>
            <div className="flex items-center gap-1">
              <Skeleton className="h-3 w-3 rounded-full" />
              <Skeleton className="h-3 w-6 rounded" />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
);