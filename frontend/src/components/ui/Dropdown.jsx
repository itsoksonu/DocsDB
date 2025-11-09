// src/components/ui/Dropdown.jsx
import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown } from '../../icons';

export const Dropdown = ({ 
  trigger, 
  children, 
  align = 'right', 
  className = '' 
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const alignmentClasses = {
    left: 'left-0',
    right: 'right-0'
  };

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      <div onClick={() => setIsOpen(!isOpen)}>
        {trigger}
      </div>
      
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -10 }}
            transition={{ duration: 0.2 }}
            className={`absolute top-full mt-2 w-56 rounded-xl bg-dark-800 border border-dark-600 shadow-2xl z-50 ${alignmentClasses[align]}`}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export const DropdownItem = ({ 
  children, 
  onClick, 
  className = '',
  icon: Icon 
}) => (
  <button
    onClick={onClick}
    className={`w-full px-4 py-3 text-left text-sm text-dark-200 hover:bg-dark-700 hover:text-white transition-all duration-200 first:rounded-t-xl last:rounded-b-xl flex items-center gap-3 ${className}`}
  >
    {Icon && <Icon size={16} />}
    {children}
  </button>
);