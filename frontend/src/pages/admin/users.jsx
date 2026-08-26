import { useState, useEffect, useRef, useCallback } from "react";
import AdminLayout from "../../components/admin/AdminLayout";
import { apiService } from "../../services/api";
import {
  Search,
  Filter,
  MoreVertical,
  Shield,
  Ban,
  CheckCircle,
} from "lucide-react";
import toast from "react-hot-toast";
import { format } from "date-fns";

export default function UserManagement() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const fetchSeqRef = useRef(0);

  // Debounce the search term, then fetch from a single effect. Two effects both
  // calling fetchUsers meant duplicate requests on mount and on every filter
  // change, with no ordering guarantee between the responses.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 500);
    return () => clearTimeout(timer);
  }, [search]);

  // useCallback so the effect can depend on the function rather than restating
  // its inputs. It reads the four filter values and sets none of them.
  const fetchUsers = useCallback(async () => {
    setLoading(true);

    const seq = ++fetchSeqRef.current;
    const isCurrent = () => seq === fetchSeqRef.current;

    try {
      const params = {
        page,
        limit: 10,
        search: debouncedSearch,
        role: roleFilter,
        status: statusFilter,
      };

      // Clean undefined/empty params
      Object.keys(params).forEach((key) => !params[key] && delete params[key]);

      const response = await apiService.getAdminUsers(params);
      if (!isCurrent()) return;

      if (response && response.data) {
        setUsers(response.data.users);
        setPagination(response.data.pagination);
      }
    } catch (error) {
      if (!isCurrent()) return;
      console.error("Error fetching users:", error);
      toast.error("Failed to load users");
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [page, roleFilter, statusFilter, debouncedSearch]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleStatusChange = async (userId, newStatus) => {
    try {
      if (
        !confirm(`Are you sure you want to change user status to ${newStatus}?`)
      )
        return;

      await apiService.updateUserStatus(userId, { status: newStatus });
      toast.success(`User status updated to ${newStatus}`);
      fetchUsers(); // Refresh list
    } catch (error) {
      console.error("Error updating status:", error);
      toast.error("Failed to update user status");
    }
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">User Management</h1>
            <p className="text-dark-400">
              Manage users, roles, and account status
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col md:flex-row gap-4 bg-dark-900 p-4 rounded-xl border border-dark-800">
          <div className="flex-1 relative">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-400"
              size={20}
            />
            <input
              type="text"
              placeholder="Search by name or email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-dark-950 border border-dark-800 rounded-lg text-white focus:outline-none focus:border-blue-500"
            />
          </div>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="bg-dark-950 border border-dark-800 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-blue-500"
          >
            <option value="">All Roles</option>
            <option value="user">User</option>
            <option value="creator">Creator</option>
            <option value="admin">Admin</option>
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-dark-950 border border-dark-800 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-blue-500"
          >
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="banned">Banned</option>
          </select>
        </div>

        {/* Table */}
        <div className="bg-dark-900 border border-dark-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-dark-950 text-dark-400 uppercase text-xs font-semibold">
                <tr>
                  <th className="px-6 py-4">User</th>
                  <th className="px-6 py-4">Role</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4">Joined</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-800">
                {loading ? (
                  <tr>
                    <td
                      colSpan="5"
                      className="px-6 py-8 text-center text-dark-500"
                    >
                      Loading users...
                    </td>
                  </tr>
                ) : users.length === 0 ? (
                  <tr>
                    <td
                      colSpan="5"
                      className="px-6 py-8 text-center text-dark-500"
                    >
                      No users found matching your criteria.
                    </td>
                  </tr>
                ) : (
                  users.map((user) => (
                    <tr
                      key={user._id}
                      className="hover:bg-dark-800/50 transition-colors"
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-dark-800 flex items-center justify-center overflow-hidden">
                            {user.avatar && user.avatar.startsWith("http") ? (
                              <img
                                src={user.avatar}
                                alt=""
                                className="w-full h-full object-cover"
                                referrerPolicy="no-referrer"
                              />
                            ) : (
                              <span className="text-dark-400 font-bold text-sm">
                                {user.name.charAt(0).toUpperCase()}
                              </span>
                            )}
                          </div>
                          <div>
                            <p className="font-medium text-dark-200">
                              {user.name}
                            </p>
                            <p className="text-sm text-dark-500">
                              {user.email}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium capitalize border ${
                            user.role === "admin"
                              ? "bg-purple-500/10 text-purple-400 border-purple-500/20"
                              : user.role === "creator"
                              ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                              : "bg-dark-800 text-dark-400 border-dark-700"
                          }`}
                        >
                          {user.role}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium capitalize ${
                            user.status === "active"
                              ? "bg-emerald-500/10 text-emerald-400"
                              : "bg-red-500/10 text-red-400"
                          }`}
                        >
                          {user.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-dark-400 text-sm">
                        {format(new Date(user.createdAt), "MMM d, yyyy")}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2 group">
                          {user.status === "active" ? (
                            <button
                              onClick={() =>
                                handleStatusChange(user._id, "suspended")
                              }
                              className="p-2 text-dark-400 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
                              title="Suspend User"
                            >
                              <Ban size={18} />
                            </button>
                          ) : (
                            <button
                              onClick={() =>
                                handleStatusChange(user._id, "active")
                              }
                              className="p-2 text-dark-400 hover:text-emerald-400 hover:bg-emerald-400/10 rounded-lg transition-colors"
                              title="Activate User"
                            >
                              <CheckCircle size={18} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {pagination && pagination.total > 0 && (
            <div className="px-6 py-4 border-t border-dark-800 flex items-center justify-between">
              <p className="text-sm text-dark-400">
                Showing{" "}
                <span className="font-medium text-dark-200">
                  {(page - 1) * 10 + 1}
                </span>{" "}
                to{" "}
                <span className="font-medium text-dark-200">
                  {Math.min(page * 10, pagination.total)}
                </span>{" "}
                of{" "}
                <span className="font-medium text-dark-200">
                  {pagination.total}
                </span>{" "}
                users
              </p>
              <div className="flex gap-2">
                <button
                  disabled={page === 1}
                  onClick={() => setPage(page - 1)}
                  className="px-3 py-1 bg-dark-800 border border-dark-700 rounded text-sm text-dark-300 hover:bg-dark-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <button
                  disabled={!pagination.hasMore}
                  onClick={() => setPage(page + 1)}
                  className="px-3 py-1 bg-dark-800 border border-dark-700 rounded text-sm text-dark-300 hover:bg-dark-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
