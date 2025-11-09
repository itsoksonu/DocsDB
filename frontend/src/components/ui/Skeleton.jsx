// src/components/ui/Skeleton.jsx
export const Skeleton = ({ className = '' }) => (
  <div className={`animate-pulse bg-dark-700 rounded-lg ${className}`} />
);

export const DocumentSkeleton = () => (
  <div className="bg-dark-800 rounded-2xl p-6 border border-dark-600 animate-pulse">
    <div className="flex items-start gap-4">
      <Skeleton className="w-16 h-20 rounded-xl" />
      <div className="flex-1 space-y-3">
        <Skeleton className="h-5 w-3/4 rounded" />
        <Skeleton className="h-4 w-1/2 rounded" />
        <div className="flex gap-2">
          <Skeleton className="h-6 w-16 rounded-full" />
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
        <div className="flex items-center gap-4 text-sm text-dark-400">
          <Skeleton className="h-4 w-24 rounded" />
          <Skeleton className="h-4 w-16 rounded" />
          <Skeleton className="h-4 w-20 rounded" />
        </div>
      </div>
    </div>
  </div>
);