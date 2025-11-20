import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

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

      if (align === 'right') {
        if (dropdown.right < content.width) {
          horizontal = 'left';
        }
      } else {
        if (dropdown.left + content.width > viewport.width) {
          horizontal = 'right';
        }
      }

      if (dropdown.bottom + content.height > viewport.height) {
        if (dropdown.top > viewport.height - dropdown.bottom) {
          vertical = 'top';
        }
      }

      setPosition({ horizontal, vertical });
    }
  }, [isOpen, align]);

  const getPositionClasses = () => {
    const classes = [];
    
    if (position.horizontal === 'left') {
      classes.push('left-0');
    } else {
      classes.push('right-0');
    }

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