// src/components/common/ProfileModal.jsx
import { useAuth } from '../../contexts/AuthContext';
import { useModal } from '../../hooks/useModal';
import { X, User, FileText, Settings, LogOut } from '../../icons';

export const ProfileModal = () => {
  const { user } = useAuth();
  const { closeModal } = useModal();

  return (
    <dialog id="profile_modal" className="modal">
      <div className="modal-box bg-dark-800 border border-dark-600 rounded-2xl max-w-md">
        <div className="flex justify-between items-center mb-6">
          <h3 className="font-bold text-lg text-white">Profile</h3>
          <button 
            onClick={() => closeModal('profile_modal')}
            className="btn btn-sm btn-ghost p-2 hover:bg-dark-700 rounded-xl"
          >
            <X size={20} />
          </button>
        </div>

        {user && (
          <div className="space-y-6">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 bg-gradient-to-br from-purple-500 to-pink-600 rounded-full flex items-center justify-center text-white text-2xl font-bold">
                {user.name?.charAt(0).toUpperCase()}
              </div>
              <div>
                <h4 className="font-semibold text-white text-lg">{user.name}</h4>
                <p className="text-dark-300">{user.email}</p>
                <span className="inline-block px-2 py-1 bg-blue-500/20 text-blue-300 text-xs rounded-full mt-1">
                  {user.role}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <button className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-dark-700 rounded-xl transition-colors">
                <User size={18} />
                <span>Edit Profile</span>
              </button>
              
              <button className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-dark-700 rounded-xl transition-colors">
                <FileText size={18} />
                <span>My Documents</span>
              </button>
              
              <button 
                onClick={() => {
                  closeModal('profile_modal');
                  document.getElementById('settings_modal').showModal();
                }}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-dark-700 rounded-xl transition-colors"
              >
                <Settings size={18} />
                <span>Settings</span>
              </button>
            </div>
          </div>
        )}
      </div>
      
      <form method="dialog" className="modal-backdrop">
        <button onClick={() => closeModal('profile_modal')}>close</button>
      </form>
    </dialog>
  );
};