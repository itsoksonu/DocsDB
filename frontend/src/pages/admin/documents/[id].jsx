import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import AdminLayout from "../../../components/admin/AdminLayout";
import { apiService } from "../../../services/api";
import {
  ArrowLeft,
  ExternalLink,
  RefreshCw,
  Image as ImageIcon,
  ShieldAlert,
  AlertTriangle,
  Eye,
  Download,
  Bookmark,
  Clock,
  HardDrive,
  FileText,
  Tag,
  Globe,
  Lock,
  Layers,
  Flag,
  Check,
} from "../../../icons";
import toast from "react-hot-toast";
import { format, formatDistanceToNow } from "date-fns";

const PERIODS = [7, 30, 90];

function formatBytes(bytes) {
  if (!bytes) return "—";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024))
  );
  return `${Math.round((bytes / 1024 ** i) * 10) / 10} ${units[i]}`;
}

function formatDuration(ms) {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${ms} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

function safeDate(value, pattern = "MMM d, yyyy 'at' HH:mm") {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : format(date, pattern);
}

const STATUS_STYLES = {
  processed: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  failed: "bg-red-500/10 text-red-400 border-red-500/20",
  processing: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  uploaded: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  taken_down: "bg-red-500/10 text-red-400 border-red-500/20",
  quarantined: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  rejected: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  duplicate: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  deleted: "bg-dark-700 text-dark-400 border-dark-600",
};

function StatCard({ icon: Icon, label, value, sub }) {
  return (
    <div className="bg-dark-900 border border-dark-800 rounded-xl p-4">
      <div className="flex items-center gap-2 text-dark-400 mb-2">
        <Icon size={16} />
        <span className="text-xs uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-2xl font-semibold text-white tabular-nums">{value}</p>
      {sub && <p className="text-xs text-dark-500 mt-1">{sub}</p>}
    </div>
  );
}

function Field({ label, children, mono }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-dark-500 mb-1">{label}</p>
      <div
        className={`text-sm text-dark-200 break-words ${mono ? "font-mono text-xs" : ""}`}
      >
        {children ?? "—"}
      </div>
    </div>
  );
}

/**
 * Simple inline bar chart. Recharts is not a dependency of this app and one
 * admin chart does not justify adding it.
 */
function ActivityChart({ series }) {
  const max = Math.max(1, ...series.map((d) => Math.max(d.views, d.downloads)));

  if (series.every((d) => !d.views && !d.downloads)) {
    return (
      <p className="text-sm text-dark-500 py-12 text-center">
        No views or downloads recorded in this period.
      </p>
    );
  }

  return (
    <div>
      <div className="flex items-end gap-[2px] h-40">
        {series.map((day) => (
          <div
            key={day.date}
            className="flex-1 flex flex-col justify-end gap-[1px] group relative min-w-[2px]"
            title={`${day.date}: ${day.views} views, ${day.downloads} downloads`}
          >
            <div
              className="w-full bg-blue-500/80 rounded-sm transition-all group-hover:bg-blue-400"
              style={{ height: `${(day.views / max) * 100}%` }}
            />
            <div
              className="w-full bg-emerald-500/80 rounded-sm transition-all group-hover:bg-emerald-400"
              style={{ height: `${(day.downloads / max) * 100}%` }}
            />
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between mt-3 text-xs text-dark-500">
        <span>{series[0]?.date}</span>
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-sm bg-blue-500" /> Views
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-sm bg-emerald-500" /> Downloads
          </span>
        </div>
        <span>{series[series.length - 1]?.date}</span>
      </div>
    </div>
  );
}

export default function AdminDocumentDetail() {
  const router = useRouter();
  const { id } = router.query;

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);

    try {
      const response = await apiService.getAdminDocument(id, { days });
      setData(response.data);
    } catch (err) {
      setError(
        err.response?.status === 404
          ? "This document no longer exists."
          : err.response?.data?.message || "Failed to load this document."
      );
    } finally {
      setLoading(false);
    }
  }, [id, days]);

  useEffect(() => {
    load();
  }, [load]);

  const runAction = async (key, action, successMessage) => {
    setBusy(key);
    try {
      await action();
      toast.success(successMessage);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || "That didn't work");
    } finally {
      setBusy(null);
    }
  };

  if (loading && !data) {
    return (
      <AdminLayout>
        <div className="py-20 text-center text-dark-500">Loading document…</div>
      </AdminLayout>
    );
  }

  if (error) {
    return (
      <AdminLayout>
        <div className="py-20 text-center space-y-4">
          <AlertTriangle size={40} className="text-red-400 mx-auto" />
          <p className="text-dark-300">{error}</p>
          <Link
            href="/admin/documents"
            className="inline-flex items-center gap-2 text-blue-400 hover:text-blue-300"
          >
            <ArrowLeft size={16} /> Back to documents
          </Link>
        </div>
      </AdminLayout>
    );
  }

  const { document: doc, owner, engagement, processing, moderation, earnings } =
    data;

  const title = doc.generatedTitle || doc.originalFilename;

  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
          <div className="flex gap-4 min-w-0">
            <Link
              href="/admin/documents"
              className="p-2 h-9 text-dark-400 hover:text-white hover:bg-dark-800 rounded-lg transition-colors flex-shrink-0"
              title="Back to documents"
            >
              <ArrowLeft size={18} />
            </Link>

            {doc.thumbnailUrl ? (
              <img
                src={doc.thumbnailUrl}
                alt=""
                className="w-16 h-20 object-cover rounded-lg border border-dark-800 flex-shrink-0 bg-dark-800"
              />
            ) : (
              <div className="w-16 h-20 rounded-lg border border-dark-800 bg-dark-800 flex items-center justify-center flex-shrink-0">
                <FileText size={20} className="text-dark-500" />
              </div>
            )}

            <div className="min-w-0">
              <h1 className="text-xl font-bold text-white break-words">
                {title}
              </h1>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <span
                  className={`px-2 py-0.5 rounded-full text-xs font-medium border capitalize ${
                    STATUS_STYLES[doc.status] || STATUS_STYLES.deleted
                  }`}
                >
                  {doc.status?.replace("_", " ")}
                </span>
                <span className="px-2 py-0.5 bg-dark-800 rounded-full text-xs text-dark-300 uppercase">
                  {doc.fileType}
                </span>
                {doc.category && (
                  <span className="px-2 py-0.5 bg-blue-500/10 text-blue-400 rounded-full text-xs capitalize">
                    {doc.category}
                  </span>
                )}
                <span className="flex items-center gap-1 px-2 py-0.5 bg-dark-800 rounded-full text-xs text-dark-300 capitalize">
                  {doc.visibility === "public" ? (
                    <Globe size={11} />
                  ) : (
                    <Lock size={11} />
                  )}
                  {doc.visibility}
                </span>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2 flex-shrink-0">
            <Link
              href={`/document/${doc.slug || doc._id}`}
              target="_blank"
              className="flex items-center gap-2 px-3 py-2 text-sm bg-dark-800 hover:bg-dark-700 text-dark-200 rounded-lg transition-colors"
            >
              <ExternalLink size={15} /> Open
            </Link>
            <button
              onClick={() =>
                runAction(
                  "reprocess",
                  () => apiService.reprocessAdminDocument(doc._id),
                  "Queued for reprocessing"
                )
              }
              disabled={busy === "reprocess" || doc.status === "processing"}
              className="flex items-center gap-2 px-3 py-2 text-sm bg-dark-800 hover:bg-dark-700 text-dark-200 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title="Re-runs the full pipeline, including AI metadata"
            >
              <RefreshCw
                size={15}
                className={busy === "reprocess" ? "animate-spin" : ""}
              />
              Reprocess
            </button>
            <button
              onClick={() =>
                runAction(
                  "thumbnail",
                  () => apiService.regenerateAdminThumbnail(doc._id),
                  "Thumbnail regenerated"
                )
              }
              disabled={busy === "thumbnail"}
              className="flex items-center gap-2 px-3 py-2 text-sm bg-dark-800 hover:bg-dark-700 text-dark-200 rounded-lg transition-colors disabled:opacity-40"
              title="Rebuilds only the thumbnail; metadata is left alone"
            >
              <ImageIcon size={15} /> Thumbnail
            </button>
            {doc.status === "taken_down" ? (
              <button
                onClick={() =>
                  runAction(
                    "restore",
                    () => apiService.restoreAdminDocument(doc._id),
                    "Document restored"
                  )
                }
                disabled={busy === "restore"}
                className="flex items-center gap-2 px-3 py-2 text-sm bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 rounded-lg transition-colors disabled:opacity-40"
              >
                <Check size={15} /> Restore
              </button>
            ) : (
              <button
                onClick={() => {
                  const reason = window.prompt("Reason for takedown:");
                  if (!reason) return;
                  runAction(
                    "takedown",
                    () => apiService.takedownDocument(doc._id, { reason }),
                    "Document taken down"
                  );
                }}
                disabled={busy === "takedown"}
                className="flex items-center gap-2 px-3 py-2 text-sm bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg transition-colors disabled:opacity-40"
              >
                <ShieldAlert size={15} /> Take down
              </button>
            )}
          </div>
        </div>

        {/* Failure banner */}
        {processing.error && (
          <div className="flex items-start gap-3 bg-red-500/10 border border-red-500/20 rounded-xl p-4">
            <AlertTriangle
              size={18}
              className="text-red-400 flex-shrink-0 mt-0.5"
            />
            <div className="min-w-0">
              <p className="text-sm font-medium text-red-300">
                Processing failed
              </p>
              <p className="text-sm text-red-400/80 break-words mt-1">
                {processing.error}
              </p>
              {processing.retryCount > 0 && (
                <p className="text-xs text-red-400/60 mt-1">
                  Retried {processing.retryCount}{" "}
                  {processing.retryCount === 1 ? "time" : "times"}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Engagement */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            icon={Eye}
            label="Views"
            value={engagement.views.toLocaleString()}
            sub={`${engagement.viewsInPeriod.toLocaleString()} in ${days}d`}
          />
          <StatCard
            icon={Download}
            label="Downloads"
            value={engagement.downloads.toLocaleString()}
            sub={`${engagement.downloadsInPeriod.toLocaleString()} in ${days}d`}
          />
          <StatCard
            icon={Bookmark}
            label="Saves"
            value={engagement.saves.toLocaleString()}
            sub={`${engagement.savesInCollections.toLocaleString()} in collections`}
          />
          <StatCard
            icon={Flag}
            label="Reports"
            value={moderation.total.toLocaleString()}
            sub={
              moderation.countsByStatus.pending
                ? `${moderation.countsByStatus.pending} pending`
                : "None pending"
            }
          />
        </div>

        {/* Activity */}
        <div className="bg-dark-900 border border-dark-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-sm font-semibold text-dark-200 uppercase tracking-wider">
              Activity
            </h2>
            <div className="flex gap-1 bg-dark-950 rounded-lg p-1">
              {PERIODS.map((period) => (
                <button
                  key={period}
                  onClick={() => setDays(period)}
                  className={`px-3 py-1 text-xs rounded-md transition-colors ${
                    days === period
                      ? "bg-dark-700 text-white"
                      : "text-dark-400 hover:text-white"
                  }`}
                >
                  {period}d
                </button>
              ))}
            </div>
          </div>
          <ActivityChart series={engagement.series} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* File + metadata */}
          <div className="bg-dark-900 border border-dark-800 rounded-xl p-5 space-y-5">
            <h2 className="text-sm font-semibold text-dark-200 uppercase tracking-wider">
              File
            </h2>

            {doc.generatedDescription && (
              <Field label="Description">{doc.generatedDescription}</Field>
            )}

            <div className="grid grid-cols-2 gap-4">
              <Field label="Original filename">{doc.originalFilename}</Field>
              <Field label="Size">
                <span className="flex items-center gap-1.5">
                  <HardDrive size={13} className="text-dark-500" />
                  {formatBytes(doc.sizeBytes)}
                </span>
              </Field>
              <Field label="Pages">{doc.pageCount || "—"}</Field>
              <Field label="Uploaded">{safeDate(doc.createdAt)}</Field>
              <Field label="Last updated">{safeDate(doc.updatedAt)}</Field>
              <Field label="Monetization">
                {doc.monetizationEnabled
                  ? `On · ${doc.revenueSharePercent}% share`
                  : "Off"}
              </Field>
            </div>

            {doc.tags?.length > 0 && (
              <Field label="Tags">
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {doc.tags.map((tag) => (
                    <span
                      key={tag}
                      className="flex items-center gap-1 px-2 py-0.5 bg-dark-800 rounded text-xs text-dark-300"
                    >
                      <Tag size={10} />
                      {tag}
                    </span>
                  ))}
                </div>
              </Field>
            )}

            <div className="pt-4 border-t border-dark-800 grid grid-cols-1 gap-3">
              <Field label="Slug" mono>
                {doc.slug}
              </Field>
              <Field label="Document ID" mono>
                {doc._id}
              </Field>
              <Field label="Storage key" mono>
                {doc.s3Path}
              </Field>
              <Field label="Thumbnail key" mono>
                {doc.thumbnailS3Path}
              </Field>
              {doc.fileHash && (
                <Field label="SHA-256" mono>
                  {doc.fileHash}
                </Field>
              )}
            </div>

            {doc.sourceName && (
              <div className="pt-4 border-t border-dark-800 space-y-3">
                <p className="text-xs text-dark-400 uppercase tracking-wider">
                  Fetched from
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Source">{doc.sourceName}</Field>
                  <Field label="Source ID" mono>
                    {doc.sourceId}
                  </Field>
                  <Field label="License">{doc.license}</Field>
                  <Field label="Original URL">
                    {doc.sourceUrl && (
                      <a
                        href={doc.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-400 hover:text-blue-300 break-all"
                      >
                        {doc.sourceUrl}
                      </a>
                    )}
                  </Field>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-6">
            {/* Owner */}
            <div className="bg-dark-900 border border-dark-800 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-dark-200 uppercase tracking-wider mb-4">
                Uploader
              </h2>
              {owner ? (
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-dark-800 flex items-center justify-center text-sm font-medium text-dark-300 flex-shrink-0 overflow-hidden">
                    {owner.avatar ? (
                      <img
                        src={owner.avatar}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      owner.name?.charAt(0)?.toUpperCase() || "?"
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-white truncate">
                      {owner.name}
                    </p>
                    <p className="text-xs text-dark-500 truncate">
                      {owner.email}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs text-dark-500 capitalize">
                      {owner.role} · {owner.status}
                    </p>
                    <p className="text-xs text-dark-400 mt-0.5">
                      {owner.documentCount} document
                      {owner.documentCount === 1 ? "" : "s"}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-dark-500">
                  The uploader account no longer exists.
                </p>
              )}
            </div>

            {/* Processing */}
            <div className="bg-dark-900 border border-dark-800 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-dark-200 uppercase tracking-wider mb-4">
                Processing
              </h2>

              <ol className="space-y-3 mb-5">
                {processing.timeline.map((entry) => (
                  <li key={entry.step} className="flex items-start gap-3">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 mt-1.5 flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm text-dark-200 capitalize">
                        {entry.step.replace(/_/g, " ")}
                      </p>
                      <p className="text-xs text-dark-500">
                        {safeDate(entry.at)}
                      </p>
                    </div>
                  </li>
                ))}
                {processing.status === "processing" && (
                  <li className="flex items-start gap-3">
                    <span className="w-2 h-2 rounded-full bg-blue-500 mt-1.5 animate-pulse flex-shrink-0" />
                    <p className="text-sm text-dark-400">In progress…</p>
                  </li>
                )}
              </ol>

              <div className="grid grid-cols-2 gap-4 pt-4 border-t border-dark-800">
                <Field label="Duration">
                  <span className="flex items-center gap-1.5">
                    <Clock size={13} className="text-dark-500" />
                    {formatDuration(processing.durationMs)}
                  </span>
                </Field>
                <Field label="Retries">{processing.retryCount}</Field>
                <Field label="Virus scan">
                  {processing.virusScan
                    ? `${processing.virusScan.clean ? "Clean" : "Flagged"} · ${
                        processing.virusScan.scanner || "unknown"
                      }`
                    : "Not scanned"}
                </Field>
                <Field label="Scanned">
                  {safeDate(processing.virusScan?.scannedAt, "MMM d, yyyy")}
                </Field>
              </div>
            </div>

            {/* Earnings */}
            <div className="bg-dark-900 border border-dark-800 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-dark-200 uppercase tracking-wider mb-4">
                Earnings
              </h2>
              <p className="text-2xl font-semibold text-white mb-3 tabular-nums">
                ${earnings.total.toFixed(4)}
              </p>
              {earnings.byType.length > 0 ? (
                <div className="space-y-2">
                  {earnings.byType.map((row) => (
                    <div
                      key={row._id}
                      className="flex justify-between text-sm text-dark-400"
                    >
                      <span className="capitalize">
                        {row._id} × {row.count}
                      </span>
                      <span className="tabular-nums">
                        ${row.total.toFixed(4)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-dark-500">
                  No earnings recorded yet.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Reports */}
        <div className="bg-dark-900 border border-dark-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-dark-200 uppercase tracking-wider mb-4">
            Report history
          </h2>
          {moderation.reports.length === 0 ? (
            <p className="text-sm text-dark-500">
              This document has never been reported.
            </p>
          ) : (
            <div className="overflow-x-auto -mx-5 px-5">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-dark-500 uppercase">
                  <tr>
                    <th className="pb-2 pr-4 font-medium">Type</th>
                    <th className="pb-2 pr-4 font-medium">Reporter</th>
                    <th className="pb-2 pr-4 font-medium">Reason</th>
                    <th className="pb-2 pr-4 font-medium">Status</th>
                    <th className="pb-2 font-medium">When</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-dark-800">
                  {moderation.reports.map((report) => (
                    <tr key={report._id}>
                      <td className="py-2.5 pr-4 text-dark-200 capitalize whitespace-nowrap">
                        {report.type?.replace(/_/g, " ")}
                      </td>
                      <td className="py-2.5 pr-4 text-dark-400 whitespace-nowrap">
                        {report.reporterId?.name || "Anonymous"}
                      </td>
                      <td className="py-2.5 pr-4 text-dark-400 max-w-xs truncate">
                        {report.reason || "—"}
                      </td>
                      <td className="py-2.5 pr-4 capitalize whitespace-nowrap">
                        <span
                          className={
                            report.status === "pending"
                              ? "text-amber-400"
                              : "text-dark-400"
                          }
                        >
                          {report.status}
                        </span>
                      </td>
                      <td className="py-2.5 text-dark-500 whitespace-nowrap">
                        {report.createdAt
                          ? formatDistanceToNow(new Date(report.createdAt), {
                              addSuffix: true,
                            })
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
