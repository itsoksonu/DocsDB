import React from 'react';

export const DocumentViewerSkeleton = () => {
  return (
    <div className="pt-20 md:pt-24 pb-8 w-full animate-pulse">
      <div className="max-w-[1600px] mx-auto px-4">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* Left Column Skeleton (Info) */}
          <div className="lg:col-span-3 space-y-6">
            {/* Back Button Placeholder */}
            <div className="h-5 w-20 bg-dark-800 rounded mb-2"></div>

            {/* Main Meta Card */}
            <div className="bg-dark-900/50 rounded-xl p-4 border border-dark-800/50">
              {/* Badges */}
              <div className="flex gap-2 mb-3">
                <div className="h-6 w-16 bg-dark-800 rounded"></div>
                <div className="h-6 w-20 bg-dark-800 rounded"></div>
              </div>
              
              {/* Title */}
              <div className="h-8 w-11/12 bg-dark-800 rounded mb-3"></div>
              <div className="h-8 w-2/3 bg-dark-800 rounded mb-4"></div>

              {/* Description Lines */}
              <div className="space-y-2 mb-6">
                <div className="h-3 w-full bg-dark-800 rounded"></div>
                <div className="h-3 w-full bg-dark-800 rounded"></div>
                <div className="h-3 w-4/5 bg-dark-800 rounded"></div>
              </div>

              {/* Buttons */}
              <div className="flex flex-col gap-2">
                <div className="h-10 w-full bg-dark-800 rounded-lg"></div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="h-10 bg-dark-800 rounded-lg"></div>
                  <div className="h-10 bg-dark-800 rounded-lg"></div>
                </div>
              </div>
            </div>

            {/* Details Card Skeleton */}
            <div className="bg-dark-900/50 rounded-xl p-4 border border-dark-800/50 hidden lg:block">
              <div className="h-4 w-24 bg-dark-800 rounded mb-4"></div>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 rounded-full bg-dark-800"></div>
                <div className="flex-1">
                  <div className="h-3 w-16 bg-dark-800 rounded mb-1"></div>
                  <div className="h-3 w-24 bg-dark-800 rounded"></div>
                </div>
              </div>
              <div className="h-px bg-dark-800 my-4"></div>
              <div className="grid grid-cols-2 gap-4">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i}>
                    <div className="h-3 w-16 bg-dark-800 rounded mb-2"></div>
                    <div className="h-4 w-20 bg-dark-800 rounded"></div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Middle Column Skeleton (Viewer) */}
          <div className="lg:col-span-6">
            <div className="bg-dark-900/50 rounded-xl border border-dark-800/50 overflow-hidden">
              {/* Aspect Ratio Box to match PDF viewer */}
              <div className="aspect-[8.5/11] w-full bg-dark-800/50 flex items-center justify-center">
                <div className="w-16 h-16 bg-dark-800 rounded-full opacity-50"></div>
              </div>
            </div>
          </div>

          {/* Right Column Skeleton (Related Docs) */}
          <div className="lg:col-span-3">
            <div className="bg-dark-900/50 rounded-xl p-4 border border-dark-800/50">
              <div className="h-4 w-32 bg-dark-800 rounded mb-4"></div>
              <div className="flex flex-wrap gap-4 justify-center">
                {/* Mimic Document Cards */}
                {[1, 2, 3].map((i) => (
                  <div key={i} className="w-full h-32 bg-dark-800 rounded-lg"></div>
                ))}
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};