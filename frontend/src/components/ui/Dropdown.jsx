// src/components/ui/Dropdown.jsx
import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown } from 'lucide-react';

export const Dropdown = ({ 
  trigger, 
  children, 
  align = 'right', 
  className = '',
  isOpen,
  onClose
}) => {
  const dropdownRef = useRef(null);
  const contentRef = useRef(null);
  const [position, setPosition] = useState({ horizontal: align, vertical: 'bottom' });

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  useEffect(() => {
    if (isOpen && contentRef.current && dropdownRef.current) {
      const dropdown = dropdownRef.current.getBoundingClientRect();
      const content = contentRef.current.getBoundingClientRect();
      const viewport = {
        width: window.innerWidth,
        height: window.innerHeight
      };

      let horizontal = align;
      let vertical = 'bottom';

      // Check horizontal positioning
      if (align === 'right') {
        // Check if dropdown goes off right edge
        if (dropdown.right < content.width) {
          horizontal = 'left';
        }
      } else {
        // Check if dropdown goes off left edge
        if (dropdown.left + content.width > viewport.width) {
          horizontal = 'right';
        }
      }

      // Check vertical positioning
      // Check if there's enough space below
      if (dropdown.bottom + content.height > viewport.height) {
        // Check if there's more space above
        if (dropdown.top > viewport.height - dropdown.bottom) {
          vertical = 'top';
        }
      }

      setPosition({ horizontal, vertical });
    }
  }, [isOpen, align]);

  const getPositionClasses = () => {
    const classes = [];
    
    // Horizontal alignment
    if (position.horizontal === 'left') {
      classes.push('left-0');
    } else {
      classes.push('right-0');
    }

    // Vertical alignment
    if (position.vertical === 'top') {
      classes.push('bottom-full mb-2');
    } else {
      classes.push('top-full mt-2');
    }

    return classes.join(' ');
  };

  const getAnimationProps = () => {
    if (position.vertical === 'top') {
      return {
        initial: { opacity: 0, scale: 0.95, y: 10 },
        animate: { opacity: 1, scale: 1, y: 0 },
        exit: { opacity: 0, scale: 0.95, y: 10 }
      };
    }
    return {
      initial: { opacity: 0, scale: 0.95, y: -10 },
      animate: { opacity: 1, scale: 1, y: 0 },
      exit: { opacity: 0, scale: 0.95, y: -10 }
    };
  };

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      <div onClick={(e) => {
        e.stopPropagation();
      }}>
        {trigger}
      </div>
      
      <AnimatePresence>
        {isOpen && (
          <motion.div
            ref={contentRef}
            {...getAnimationProps()}
            transition={{ duration: 0.2 }}
            className={`absolute w-56 md:w-64 rounded-2xl bg-dark-800 border border-dark-700 shadow-2xl z-50 overflow-hidden ${getPositionClasses()}`}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export const DropdownItem = ({ 
  label,
  onClick, 
  className = '',
  icon: Icon 
}) => (
  <button
    onClick={onClick}
    className={`w-full px-4 py-3 text-left text-dark-300 hover:bg-dark-700 hover:text-white transition-all duration-200 flex items-center gap-3 ${className}`}
  >
    {Icon && <Icon size={18} className="flex-shrink-0" />}
    <span>{label}</span>
  </button>
);