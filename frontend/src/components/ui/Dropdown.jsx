import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";

export const Dropdown = ({
  trigger,
  children,
  align = "right",
  className = "",
  isOpen,
  onClose,
}) => {
  const dropdownRef = useRef(null);
  const contentRef = useRef(null);
  const [dropdownPosition, setDropdownPosition] = useState({
    top: 0,
    left: 0,
    right: "auto",
  });
  const [position, setPosition] = useState({
    horizontal: align,
    vertical: "bottom",
  });

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        if (contentRef.current && !contentRef.current.contains(event.target)) {
          onClose();
        }
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  useEffect(() => {
    if (isOpen && dropdownRef.current) {
      const triggerRect = dropdownRef.current.getBoundingClientRect();
      const viewport = {
        width: window.innerWidth,
        height: window.innerHeight,
      };

      let horizontal = align;
      let vertical = "bottom";
      let top = triggerRect.bottom + 8; // 8px gap below trigger
      let left = "auto";
      let right = "auto";

      // Determine horizontal alignment
      if (align === "right") {
        right = viewport.width - triggerRect.right;
        // Check if dropdown would overflow on the left
        if (right + 256 > viewport.width) {
          horizontal = "left";
          left = triggerRect.left;
          right = "auto";
        }
      } else {
        left = triggerRect.left;
        // Check if dropdown would overflow on the right
        if (left + 256 > viewport.width) {
          horizontal = "right";
          right = viewport.width - triggerRect.right;
          left = "auto";
        }
      }

      // Determine vertical alignment
      // Rough estimate: dropdown height ~350px for full menu
      if (triggerRect.bottom + 350 > viewport.height) {
        if (triggerRect.top > viewport.height - triggerRect.bottom) {
          vertical = "top";
          top = triggerRect.top - 8; // Position above with 8px gap
        }
      }

      setPosition({ horizontal, vertical });
      setDropdownPosition({ top, left, right });
    }
  }, [isOpen, align]);

  const getAnimationProps = () => {
    if (position.vertical === "top") {
      return {
        initial: { opacity: 0, scale: 0.95, y: 10 },
        animate: { opacity: 1, scale: 1, y: 0 },
        exit: { opacity: 0, scale: 0.95, y: 10 },
      };
    }
    return {
      initial: { opacity: 0, scale: 0.95, y: -10 },
      animate: { opacity: 1, scale: 1, y: 0 },
      exit: { opacity: 0, scale: 0.95, y: -10 },
    };
  };

  const dropdownContent = (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          ref={contentRef}
          {...getAnimationProps()}
          transition={{ duration: 0.2 }}
          className="fixed w-52 rounded-2xl bg-dark-800 border border-dark-700 shadow-2xl z-[9999] overflow-hidden"
          style={{
            top:
              position.vertical === "top"
                ? "auto"
                : `${dropdownPosition.top}px`,
            bottom:
              position.vertical === "top"
                ? `${window.innerHeight - dropdownPosition.top}px`
                : "auto",
            left:
              dropdownPosition.left !== "auto"
                ? `${dropdownPosition.left}px`
                : "auto",
            right:
              dropdownPosition.right !== "auto"
                ? `${dropdownPosition.right}px`
                : "auto",
          }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      <div
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        {trigger}
      </div>

      {typeof document !== "undefined" &&
        createPortal(dropdownContent, document.body)}
    </div>
  );
};

export const DropdownItem = ({
  label,
  onClick,
  className = "",
  icon: Icon,
}) => (
  <button
    onClick={onClick}
    className={`w-full px-4 py-2.5 text-left text-dark-300 hover:bg-dark-700 hover:text-white transition-all duration-200 flex items-center gap-3 ${className}`}
  >
    {Icon && <Icon size={18} className="flex-shrink-0" />}
    <span>{label}</span>
  </button>
);
