import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Search, X } from '../../icons';
import debounce from "lodash.debounce";

export const SearchBar = ({
  onSearch,
  placeholder = "Search documents...",
  className = "",
  autoFocus = false,
  // search.jsx passes this, but the prop was never accepted - so the input was
  // always blank on load and on back-navigation while results showed a query.
  defaultValue = ''
}) => {
  const [query, setQuery] = useState(defaultValue);
  const [isFocused, setIsFocused] = useState(false);

  // Held in a ref rather than added to the effect deps below. The debounced call
  // used to close over whatever onSearch was current 600ms earlier, which meant
  // searching with stale filters; but every call site passes an unmemoized
  // handler, so depending on it directly would re-fire the search on each render.
  const onSearchRef = useRef(onSearch);
  useEffect(() => {
    onSearchRef.current = onSearch;
  }, [onSearch]);

  useEffect(() => {
    const debouncedSearch = debounce((val) => {
      if (val.length >= 2 || val.length === 0) {
        onSearchRef.current(val);
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