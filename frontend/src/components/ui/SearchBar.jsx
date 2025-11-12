// src/components/ui/SearchBar.jsx
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Search, X } from '../../icons';
import debounce from "lodash.debounce";

export const SearchBar = ({ 
  onSearch, 
  placeholder = "Search documents...",
  className = "",
  autoFocus = false 
}) => {
  const [query, setQuery] = useState('');
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
  const debouncedSearch = debounce((val) => {
    if (val.length >= 2 || val.length === 0) {
      onSearch(val);
    }
  }, 600);

  debouncedSearch(query);
  return () => debouncedSearch.cancel();
}, [query]);

  const clearSearch = () => {
    setQuery('');
    onSearch('');
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`relative ${className}`}
    >
      <div className={`relative flex items-center transition-all duration-300 ${
        isFocused ? 'ring-2 ring-blue-500' : 'ring-1 ring-dark-600'
      } rounded-2xl bg-dark-800`}>
        <Search 
          size={20} 
          className="absolute left-4 text-dark-400" 
        />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          className="w-full pl-12 pr-12 py-4 bg-transparent text-white placeholder-dark-400 outline-none rounded-2xl"
        />
        {query && (
          <button
            onClick={clearSearch}
            className="absolute right-4 p-1 hover:bg-dark-700 rounded-lg transition-colors"
          >
            <X size={16} className="text-dark-400" />
          </button>
        )}
      </div>
    </motion.div>
  );
};