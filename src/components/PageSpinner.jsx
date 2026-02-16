export default function PageSpinner({ fullScreen = false, label = "Loading..." }) {
  return (
    <div
      className={`page-spinner-wrap ${fullScreen ? "fullscreen" : ""} bg-gradient-to-br from-red-50 to-slate-100 dark:from-slate-950 dark:to-slate-900`}
      role="status"
      aria-live="polite"
    >
      <div className="page-spinner border-red-200 border-t-red-600 dark:border-slate-600 dark:border-t-red-400" />
      <span className="page-spinner-label text-sm font-semibold tracking-wide text-slate-600 dark:text-slate-300">{label}</span>
    </div>
  );
}
