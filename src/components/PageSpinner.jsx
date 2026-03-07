export default function PageSpinner({
  fullScreen = false,
  label = "Loading...",
}) {
  return (
    <div
      className={`page-spinner-wrap ${fullScreen ? "fullscreen" : ""}`}
      role="status"
      aria-live="polite"
    >
      <div className="page-spinner-scene">
        <div className="ps-ring ps-ring-outer" />
        <div className="ps-ring ps-ring-mid" />
        <div className="ps-core">
          <div className="ps-core-inner" />
        </div>
        <div className="ps-orbit">
          <div className="ps-dot" />
        </div>
      </div>

      <div className="ps-label-wrap">
        <span className="ps-label">{label}</span>
        <span className="ps-dots">
          <span />
          <span />
          <span />
        </span>
      </div>

      <style>{`
        .page-spinner-wrap {
          position: fixed;
          top: 58px;
          left: 0;
          right: 0;
          bottom: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 28px;
          z-index: 50;
          pointer-events: none;
        }

        .page-spinner-wrap.fullscreen {
          top: 0;
          z-index: 9999;
          background: #f9f5f5;
          pointer-events: all;
        }

        body.dark .page-spinner-wrap.fullscreen {
          background: #121212;
        }

        .page-spinner-scene {
          position: relative;
          width: 72px;
          height: 72px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .ps-ring {
          position: absolute;
          inset: 0;
          border-radius: 50%;
          border: 2px solid transparent;
        }

        .ps-ring-outer {
          border-top-color: #e8192c;
          border-right-color: rgba(232, 25, 44, 0.2);
          border-bottom-color: transparent;
          border-left-color: rgba(232, 25, 44, 0.2);
          animation: ps-spin 1.1s cubic-bezier(0.4, 0, 0.2, 1) infinite;
        }

        .ps-ring-mid {
          inset: 10px;
          border-top-color: transparent;
          border-right-color: transparent;
          border-bottom-color: #e8192c;
          border-left-color: rgba(232, 25, 44, 0.3);
          animation: ps-spin 0.85s cubic-bezier(0.4, 0, 0.2, 1) infinite reverse;
        }

        .ps-core {
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: linear-gradient(135deg, rgba(232,25,44,0.15), rgba(232,25,44,0.05));
          display: flex;
          align-items: center;
          justify-content: center;
          animation: ps-pulse 1.8s ease-in-out infinite;
        }

        .ps-core-inner {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: linear-gradient(135deg, #e8192c, #a30c1a);
          box-shadow: 0 0 12px rgba(232, 25, 44, 0.5);
          animation: ps-pulse 1.8s ease-in-out infinite reverse;
        }

        body.dark .ps-core {
          background: linear-gradient(135deg, rgba(232,25,44,0.2), rgba(232,25,44,0.08));
        }

        body.dark .ps-core-inner {
          box-shadow: 0 0 16px rgba(232, 25, 44, 0.6);
        }

        .ps-orbit {
          position: absolute;
          inset: 0;
          animation: ps-spin 1.6s linear infinite;
        }

        .ps-dot {
          position: absolute;
          top: 3px;
          left: 50%;
          transform: translateX(-50%);
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #e8192c;
          box-shadow: 0 0 8px rgba(232, 25, 44, 0.7);
        }

        .ps-label-wrap {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .ps-label {
          font-size: 13px;
          font-weight: 600;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: #78504f;
          opacity: 0.85;
        }

        body.dark .ps-label {
          color: #a89898;
        }

        .ps-dots {
          display: flex;
          gap: 3px;
          align-items: center;
        }

        .ps-dots span {
          display: block;
          width: 3px;
          height: 3px;
          border-radius: 50%;
          background: #e8192c;
          opacity: 0.4;
          animation: ps-blink 1.2s ease-in-out infinite;
        }

        .ps-dots span:nth-child(2) { animation-delay: 0.2s; }
        .ps-dots span:nth-child(3) { animation-delay: 0.4s; }

        @keyframes ps-spin {
          to { transform: rotate(360deg); }
        }

        @keyframes ps-pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50%       { transform: scale(1.18); opacity: 0.7; }
        }

        @keyframes ps-blink {
          0%, 100% { opacity: 0.2; transform: scale(0.8); }
          50%       { opacity: 1;   transform: scale(1.2); }
        }
      `}</style>
    </div>
  );
}
