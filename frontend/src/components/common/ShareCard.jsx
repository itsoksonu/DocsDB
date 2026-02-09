import React, { forwardRef } from "react";
import { FileText } from "../../icons";

const ShareCard = forwardRef(({ document }, ref) => {
  const {
    generatedTitle,
    generatedDescription,
    userId,
    fileType,
    thumbnailUrl,
  } = document;
  const authorName = userId?.name || "Unknown Author";

  return (
    <div
      ref={ref}
      className="relative bg-gradient-to-br from-gray-900 via-gray-900 to-gray-800 rounded-2xl overflow-hidden shadow-2xl flex flex-col select-none"
      style={{
        width: "300px",
        height: "533px",
        aspectRatio: "9/16",
      }}
    >
      {/* Background decoration */}
      <div
        className="absolute top-0 left-0 pointer-events-none"
        style={{
          width: "100%",
          height: "100%",
          opacity: 0.3,
        }}
      >
        <div
          className="absolute top-0 left-0 bg-gradient-to-b from-teal-900/40 via-transparent to-transparent"
          style={{
            width: "100%",
            height: "33.33%",
          }}
        />
        <div
          className="absolute bottom-0 right-0 bg-gradient-to-t from-slate-800/40 via-transparent to-transparent"
          style={{
            width: "100%",
            height: "33.33%",
          }}
        />
      </div>

      {/* Header */}
      <div
        className="flex justify-center items-center"
        style={{
          zIndex: 10,
          width: "100%",
          paddingTop: "16px",
          paddingBottom: "12px",
        }}
      >
        <div
          className="flex items-center justify-center gap-1 bg-gray-800/60 backdrop-blur-sm px-4 rounded-full border border-gray-700/50 shadow-lg"
          style={{ height: "26px", transform: "translateY(-0.5px)" }}
        >
          {/* Logo */}
          <img
            src="/favicon.svg"
            alt="DocsDB Logo"
            className="block"
            style={{
              width: "12px",
              height: "12px",
              objectFit: "contain",
              transform: "translateY(-0.5px)",
            }}
          />

          <span
            className="text-gray-300"
            style={{
              fontSize: "11px",
              fontWeight: "bold",
              letterSpacing: "0.15em",
              fontFamily: "Arial, sans-serif",
            }}
          >
            DocsDB
          </span>
        </div>
      </div>

      {/* Main Content Area */}
      <div
        className="flex flex-col items-center"
        style={{
          zIndex: 10,
          paddingLeft: "20px",
          paddingRight: "20px",
          height: "413px",
        }}
      >
        {/* Thumbnail Card */}
        <div
          className="relative bg-gray-800 rounded-xl shadow-2xl overflow-hidden border border-gray-700 flex items-center justify-center"
          style={{
            width: "190px",
            height: "260px",
            marginBottom: "16px",
            flexShrink: 0,
          }}
        >
          {thumbnailUrl && thumbnailUrl !== userId?.avatar ? (
            <img
              src={`/api/proxy-image?url=${encodeURIComponent(thumbnailUrl)}`}
              alt="Document Thumbnail"
              className="w-full h-full object-cover"
              crossOrigin="anonymous"
            />
          ) : (
            <div className="flex flex-col items-center gap-3 text-gray-600">
              <FileText size={48} strokeWidth={1.5} />
            </div>
          )}

          {/* File Type Badge */}
          {fileType && (
            <div
              className="absolute bg-gray-900/95 backdrop-blur-md rounded-lg text-white uppercase border border-gray-700/50 shadow-xl flex items-center justify-center"
              style={{
                top: "10px",
                right: "10px",
                paddingLeft: "10px",
                paddingRight: "10px",
                height: "22px",
                fontSize: "10px",
                fontWeight: "bold",
                letterSpacing: "0.05em",
                fontFamily: "Arial, sans-serif",
                transform: "translateY(-0.5px)",
              }}
            >
              {fileType}
            </div>
          )}
        </div>

        {/* Text Content */}
        <div
          className="flex flex-col items-center"
          style={{
            textAlign: "center",
            width: "100%",
            gap: "8px",
            flex: 1,
            minHeight: 0,
            justifyContent: "flex-start",
          }}
        >
          <h2
            style={{
              color: "white",
              fontFamily: "Arial, Helvetica, sans-serif",
              fontSize: "16px",
              fontWeight: "bold",
              letterSpacing: "-0.02em",
              lineHeight: "1.6",
              wordBreak: "break-word",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              textAlign: "center",
              width: "100%",
              paddingLeft: "8px",
              paddingRight: "8px",
              paddingBottom: "2px",
              margin: 0,
            }}
          >
            {generatedTitle}
          </h2>

          <p
            style={{
              color: "#9ca3af",
              fontFamily: "Arial, Helvetica, sans-serif",
              fontSize: "10px",
              letterSpacing: "0.01em",
              lineHeight: "1.8",
              wordBreak: "break-word",
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              textAlign: "center",
              width: "100%",
              paddingLeft: "12px",
              paddingRight: "12px",
              paddingBottom: "2px",
              margin: 0,
            }}
          >
            {generatedDescription}
          </p>
        </div>
      </div>

      {/* Footer Section */}
      <div
        className="bg-gray-800/80 backdrop-blur-md border-t border-gray-700/50"
        style={{
          zIndex: 10,
          width: "100%",
          height: "70px",
          paddingLeft: "20px",
          paddingRight: "20px",
          paddingTop: "14px",
          paddingBottom: "14px",
          flexShrink: 0,
        }}
      >
        <div
          className="flex items-center"
          style={{
            gap: "12px",
            height: "100%",
          }}
        >
          {userId?.avatar ? (
            <>
              <img
                src={`/api/proxy-image?url=${encodeURIComponent(
                  userId.avatar,
                )}`}
                alt={authorName}
                className="rounded-full border-2 border-gray-700 object-cover shadow-lg"
                crossOrigin="anonymous"
                style={{
                  width: "36px",
                  height: "36px",
                  flexShrink: 0,
                }}
                onError={(e) => {
                  e.target.style.display = "none";
                  const fallback = e.target.nextSibling;
                  if (fallback) fallback.style.display = "flex";
                }}
              />
              <div
                className="rounded-full bg-gradient-to-br from-teal-500 to-slate-600 items-center justify-center text-white shadow-lg hidden"
                style={{
                  width: "36px",
                  height: "36px",
                  fontSize: "14px",
                  fontWeight: "bold",
                  flexShrink: 0,
                }}
              >
                {authorName.charAt(0).toUpperCase()}
              </div>
            </>
          ) : (
            <div
              className="rounded-full bg-gradient-to-br from-teal-500 to-slate-600 flex items-center justify-center text-white shadow-lg"
              style={{
                width: "36px",
                height: "36px",
                fontSize: "14px",
                fontWeight: "bold",
                flexShrink: 0,
              }}
            >
              {authorName.charAt(0).toUpperCase()}
            </div>
          )}

          <div
            className="flex flex-col"
            style={{
              textAlign: "left",
              minWidth: 0,
              flex: 1,
              justifyContent: "center",
            }}
          >
            <span
              style={{
                color: "#6b7280",
                fontFamily: "Arial, Helvetica, sans-serif",
                fontSize: "8px",
                fontWeight: "600",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                lineHeight: 1,
                marginBottom: "2px",
              }}
            >
              Shared by
            </span>
            <span
              className="truncate"
              style={{
                color: "white",
                fontFamily: "Arial, Helvetica, sans-serif",
                fontSize: "13px",
                fontWeight: "600",
                letterSpacing: "-0.01em",
                lineHeight: 1.8,
                marginTop: "2px",
                paddingBottom: "1px",
              }}
            >
              {authorName}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
});

ShareCard.displayName = "ShareCard";

export default ShareCard;
