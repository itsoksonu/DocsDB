// src/components/common/SearchModal.jsx
import { useState } from 'react';
import { X, Search } from '../../icons';
import { useModal } from '../../hooks/useModal';

export const SearchModal = () => {
  const { closeModal } = useModal();
  const [query, setQuery] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    // Implement search
    closeModal('search_modal');
  };

  return (
    <dialog id="search_modal" className="modal">
      <div className="modal-box bg-dark-800 border border-dark-600 rounded-2xl max-w-2xl">
        <div className="flex justify-between items-center mb-6">
          <h3 className="font-bold text-lg text-white">Search Documents</h3>
          <button 
            onClick={() => closeModal('search_modal')}
            className="btn btn-sm btn-ghost p-2 hover:bg-dark-700 rounded-xl"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="relative">
            <Search size={20} className="absolute left-4 top-1/2 transform -translate-y-1/2 text-dark-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search documents, research, topics..."
              className="w-full pl-12 pr-4 py-4 bg-dark-700 border border-dark-600 rounded-xl text-white placeholder-dark-400 focus:border-blue-500 focus:outline-none"
              autoFocus
            />
          </div>
        </form>
      </div>
      
      <form method="dialog" className="modal-backdrop">
        <button onClick={() => closeModal('search_modal')}>close</button>
      </form>
    </dialog>
  );
};