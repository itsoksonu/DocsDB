import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export const Modal = ({
  isOpen,
  onClose,
  title,
  children,
  danger = false,
  onConfirm,
  confirmText = "Confirm",
  cancelText = "Cancel",
  isLoading = false,
}) => {
  const modalRef = useRef(null);

  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };

    if (isOpen) {
      document.body.style.overflow = "hidden";
      document.addEventListener("keydown", handleEscape);
    }

    return () => {
      document.body.style.overflow = "unset";
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Render using portal to ensure it's on top of everything
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Modal Content */}
      <div
        ref={modalRef}
        className="relative w-full max-w-md bg-dark-800 border border-dark-600 rounded-xl shadow-2xl transform transition-all scale-100 opacity-100"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-dark-700">
          <h3
            id="modal-title"
            className={`text-lg font-semibold ${
              danger ? "text-red-400" : "text-white"
            }`}
          >
            {title}
          </h3>
          <button
            onClick={onClose}
            className="text-dark-400 hover:text-white transition-colors p-1 rounded-lg hover:bg-dark-700"
            disabled={isLoading}
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="p-6 text-dark-200">{children}</div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-4 border-t border-dark-700 bg-dark-800/50 rounded-b-xl">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-dark-300 hover:text-white hover:bg-dark-700 rounded-lg transition-colors"
            disabled={isLoading}
          >
            {cancelText}
          </button>

          {onConfirm && (
            <button
              onClick={onConfirm}
              disabled={isLoading}
              className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors flex items-center gap-2
                ${
                  danger
                    ? "bg-red-500 hover:bg-red-600 disabled:bg-red-500/50"
                    : "bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50"
                }`}
            >
              {isLoading && (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              )}
              {confirmText}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};
