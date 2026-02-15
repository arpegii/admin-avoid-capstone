export default function PageSpinner({ fullScreen = false, label = "Loading..." }) {
  return (
    <div className={`page-spinner-wrap ${fullScreen ? "fullscreen" : ""}`} role="status" aria-live="polite">
      <div className="page-spinner" />
      <span className="page-spinner-label">{label}</span>
    </div>
  );
}
