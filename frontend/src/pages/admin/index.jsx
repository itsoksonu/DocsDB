import { useState, useEffect } from "react";
import AdminLayout from "../../components/admin/AdminLayout";
import { apiService } from "../../services/api";
import { Users, FileText, AlertTriangle, Activity } from "lucide-react";
import toast from "react-hot-toast";

const StatCard = ({ title, value, icon: Icon, color, loading }) => (
  <div className="bg-dark-900 border border-dark-800 rounded-xl p-6">
    <div className="flex items-center justify-between">
      <div>
        <p className="text-dark-400 text-sm font-medium">{title}</p>
        {loading ? (
          <div className="h-8 w-24 bg-dark-800 rounded animate-pulse mt-2" />
        ) : (
          <h3 className="text-3xl font-bold text-white mt-2">{value}</h3>
        )}
      </div>
      <div className={`p-3 rounded-lg ${color} bg-opacity-10`}>
        <Icon className={color} size={24} />
      </div>
    </div>
  </div>
);

export default function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      const response = await apiService.getAdminStats();
      if (response && response.data) {
        setStats(response.data);
      }
    } catch (error) {
      console.error("Error fetching admin stats:", error);
      toast.error("Failed to load dashboard stats");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AdminLayout>
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard Overview</h1>
          <p className="text-dark-400 mt-1">
            Welcome back, here's what's happening today.
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatCard
            title="Total Users"
            value={stats?.overview?.totalUsers?.toLocaleString() || "0"}
            icon={Users}
            color="text-blue-400"
            loading={loading}
          />
          <StatCard
            title="Total Documents"
            value={stats?.overview?.totalDocuments?.toLocaleString() || "0"}
            icon={FileText}
            color="text-emerald-400"
            loading={loading}
          />
          <StatCard
            title="Pending Reports"
            value={stats?.overview?.pendingModeration?.toLocaleString() || "0"}
            icon={AlertTriangle}
            color="text-amber-400"
            loading={loading}
          />
          <StatCard
            title="System Health"
            value={stats?.system?.api === "healthy" ? "Online" : "Issues"}
            icon={Activity}
            color="text-purple-400"
            loading={loading}
          />
        </div>

        {/* Recent Activity or Charts could go here */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-dark-900 border border-dark-800 rounded-xl p-6">
            <h3 className="text-lg font-bold text-white mb-4">System Status</h3>
            <div className="space-y-4">
              <div className="flex justify-between items-center py-2 border-b border-dark-800">
                <span className="text-dark-400">Database</span>
                <span
                  className={`px-2 py-1 rounded text-xs font-medium ${
                    stats?.system?.database === "healthy"
                      ? "bg-emerald-500/10 text-emerald-400"
                      : "bg-red-500/10 text-red-400"
                  }`}
                >
                  {stats?.system?.database || "Unknown"}
                </span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-dark-800">
                <span className="text-dark-400">Redis Cache</span>
                <span
                  className={`px-2 py-1 rounded text-xs font-medium ${
                    stats?.system?.redis === "healthy"
                      ? "bg-emerald-500/10 text-emerald-400"
                      : "bg-red-500/10 text-red-400"
                  }`}
                >
                  {stats?.system?.redis || "Unknown"}
                </span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-dark-800">
                <span className="text-dark-400">Storage (S3)</span>
                <span
                  className={`px-2 py-1 rounded text-xs font-medium ${
                    stats?.system?.storage === "healthy"
                      ? "bg-emerald-500/10 text-emerald-400"
                      : "bg-red-500/10 text-red-400"
                  }`}
                >
                  {stats?.system?.storage || "Unknown"}
                </span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-dark-800">
                <div className="flex flex-col">
                  <span className="text-dark-400">API Server</span>
                  {stats?.system?.details?.memory && (
                    <span className="text-xs text-dark-500">
                      Mem: {stats.system.details.memory}
                    </span>
                  )}
                </div>
                <span
                  className={`px-2 py-1 rounded text-xs font-medium ${
                    stats?.system?.api === "healthy"
                      ? "bg-emerald-500/10 text-emerald-400"
                      : stats?.system?.api === "degraded"
                        ? "bg-amber-500/10 text-amber-400"
                        : "bg-red-500/10 text-red-400"
                  }`}
                >
                  {stats?.system?.api || "Unknown"}
                </span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-dark-800">
                <span className="text-dark-400">Failed Processes</span>
                <span className="text-white">
                  {stats?.failedProcesses || 0}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
