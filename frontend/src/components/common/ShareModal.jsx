import React, { useRef, useState } from "react";
import { X, Download, Share2, Copy, Check } from "../../icons";
import ShareCard from "./ShareCard";

import toast from "react-hot-toast";

export const ShareModal = ({ isOpen, onClose, document: doc }) => {
  const cardRef = useRef(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleCopyLink = () => {
    const shareUrl = `${window.location.origin}/document/${doc.slug || doc._id}`;
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    toast.success("Link copied!");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleNativeShare = async () => {
    const shareUrl = `${window.location.origin}/document/${doc.slug || doc._id}`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: doc.generatedTitle,
          text: doc.generatedDescription,
          url: shareUrl,
        });
      } catch (err) {
        if (err.name !== "AbortError") {
          console.error("Share failed", err);
        }
      }
    } else {
      toast.error("Sharing not supported on this device");
    }
  };

  const handleDownloadImage = async () => {
    if (!cardRef.current) return;
    setIsCapturing(true);

    try {
      const domtoimage = (await import("dom-to-image-more")).default;

      // Wait for fonts and images to load
      await document.fonts.ready;
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Pre-load all images in the card
      const images = cardRef.current.querySelectorAll("img");
      await Promise.all(
        Array.from(images).map((img) => {
          if (img.complete) return Promise.resolve();
          return new Promise((resolve) => {
            img.onload = resolve;
            img.onerror = resolve;
          });
        })
      );

      const SCALE = 3; // 3x = 900x1599 (high quality)

      const dataUrl = await domtoimage.toPng(cardRef.current, {
        width: 300 * SCALE,
        height: 533 * SCALE,
        style: {
          transform: `scale(${SCALE})`,
          transformOrigin: "top left",
          backgroundColor: "#111827",
          border: "none",
          outline: "none",
          boxShadow: "none",
        },
        filter: (node) => {
          // remove SVG debug outlines / borders
          if (node.tagName === "foreignObject") return false;
          if (node.style) {
            node.style.border = "none";
            node.style.outline = "none";
          }
          return true;
        },
      });

      const image = dataUrl;

      const link = document.createElement("a");
      link.href = image;
      link.download = `docsdb-${doc.generatedTitle
        .slice(0, 30)
        .replace(/[^a-zA-Z0-9]/g, "-")}-share.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success("Image downloaded!");
    } catch (error) {
      console.error("Error generating image:", error);
      toast.error("Failed to generate image");
    } finally {
      setIsCapturing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      {/* Modal Container */}
      <div className="bg-dark-800 rounded-2xl border border-dark-600 shadow-2xl w-full max-w-md flex flex-col overflow-hidden max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-dark-600">
          <h3 className="text-white font-semibold flex items-center gap-2">
            <Share2 size={18} className="text-blue-400" />
            Share Document
          </h3>
          <button
            onClick={onClose}
            className="p-1 hover:bg-dark-700 rounded-full transition-colors text-dark-400 hover:text-white"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content (Scrollable if needed) */}
        <div className="flex-1 overflow-y-auto px-6 py-3 flex flex-col items-center gap-3">
          {/* Live Preview of the Card - Scaled for modal */}
          <div className="relative w-full flex justify-center leading-none">
            <div
              className="transform scale-[0.7] origin-top shadow-2xl rounded-xl m-0 p-0 "
              style={{
                opacity: isCapturing ? 0.3 : 1,
                transition: "opacity 0.2s",
                pointerEvents: isCapturing ? "none" : "auto",
                marginBottom: "-120px",
              }}
            >
              <ShareCard document={doc} />
            </div>
          </div>

          {/* Hidden full-size card for perfect capture - Positioned off-screen */}
          <div
            style={{
              position: "fixed",
              left: "-10000px",
              top: "-10000px",
              visibility: isCapturing ? "visible" : "hidden",
              pointerEvents: "none",
            }}
          >
            <ShareCard ref={cardRef} document={doc} />
          </div>

          {/* Actions Grid */}
          <div className="grid grid-cols-2 gap-3 w-full max-w-[300px]">
            <button
              onClick={handleDownloadImage}
              disabled={isCapturing}
              className="flex items-center justify-center gap-2 p-3 bg-dark-700 hover:bg-dark-600 rounded-lg transition-all border border-dark-600 hover:border-blue-500/50 group disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-dark-700 disabled:hover:border-dark-600"
            >
              <Download
                size={16}
                className="text-blue-400 group-hover:text-white transition-colors"
              />
              <span className="text-xs font-medium text-dark-200 group-hover:text-white transition-colors">
                {isCapturing ? "Processing..." : "Download"}
              </span>
            </button>

            <button
              onClick={handleNativeShare}
              disabled={isCapturing}
              className="flex items-center justify-center gap-2 p-3 bg-dark-700 hover:bg-dark-600 rounded-lg transition-all border border-dark-600 hover:border-purple-500/50 group disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Share2
                size={16}
                className="text-purple-400 group-hover:text-white transition-colors"
              />
              <span className="text-xs font-medium text-dark-200 group-hover:text-white transition-colors">
                Share Via
              </span>
            </button>
          </div>

          {/* Copy Link Input */}
          <div className="w-full max-w-[300px] relative">
            <div className="bg-dark-900 border border-dark-700 rounded-lg flex items-center p-1 pl-3 h-9">
              <span className="text-dark-400 text-[10px] truncate flex-1">
                {`${window.location.origin}/document/${doc.slug || doc._id}`}
              </span>
              <button
                onClick={handleCopyLink}
                disabled={isCapturing}
                className="h-7 px-2 bg-dark-700 hover:bg-dark-600 text-white rounded transition-colors flex items-center gap-1.5 ml-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {copied ? (
                  <Check size={12} className="text-green-400" />
                ) : (
                  <Copy size={12} />
                )}
                <span className="text-[10px] font-medium">
                  {copied ? "Copied" : "Copy"}
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
