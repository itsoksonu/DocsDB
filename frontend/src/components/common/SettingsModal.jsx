// src/components/common/SettingsModal.jsx
import { X, Bell, Eye, Download } from '../../icons/index.js';

export const SettingsModal = () => {
  const closeModal = () => {
    const modal = document.getElementById('settings_modal');
    if (modal) modal.close();
  };

  return (
    <dialog id="settings_modal" className="modal">
      <div className="modal-box bg-dark-800 border border-dark-600 rounded-2xl max-w-md">
        <div className="flex justify-between items-center mb-6">
          <h3 className="font-bold text-lg text-white">Settings</h3>
          <button 
            onClick={closeModal}
            className="btn btn-sm btn-ghost p-2 hover:bg-dark-700 rounded-xl"
          >
            <X size={20} />
          </button>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between py-2">
            <div className="flex items-center gap-3">
              <Bell size={18} className="text-dark-400" />
              <span className="text-white">Notifications</span>
            </div>
            <input type="checkbox" className="toggle toggle-primary" defaultChecked />
          </div>

          <div className="flex items-center justify-between py-2">
            <div className="flex items-center gap-3">
              <Eye size={18} className="text-dark-400" />
              <span className="text-white">Dark Mode</span>
            </div>
            <input type="checkbox" className="toggle toggle-primary" defaultChecked />
          </div>

          <div className="flex items-center justify-between py-2">
            <div className="flex items-center gap-3">
              <Download size={18} className="text-dark-400" />
              <span className="text-white">Auto-download</span>
            </div>
            <input type="checkbox" className="toggle toggle-primary" />
          </div>
        </div>
      </div>
      
      <form method="dialog" className="modal-backdrop">
        <button onClick={closeModal}>close</button>
      </form>
    </dialog>
  );
};