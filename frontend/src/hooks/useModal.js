// src/hooks/useModal.js
import { useCallback } from 'react';

export const useModal = () => {
  const openModal = useCallback((modalId) => {
    if (typeof window !== 'undefined') {
      const modal = document.getElementById(modalId);
      if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        document.body.style.overflow = 'hidden';
      }
    }
  }, []);

  const closeModal = useCallback((modalId) => {
    if (typeof window !== 'undefined') {
      const modal = document.getElementById(modalId);
      if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        document.body.style.overflow = 'auto';
      }
    }
  }, []);

  return { openModal, closeModal };
};