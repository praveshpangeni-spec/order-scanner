"use client";
import { useEffect, useState } from "react";

/** Registers the service worker and offers an in-app "Install app" button on
 *  Android/Chrome (via beforeinstallprompt). */
export default function PWA() {
  const [prompt, setPrompt] = useState<any>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    const onPrompt = (e: any) => {
      e.preventDefault();
      setPrompt(e);
    };
    const onInstalled = () => setPrompt(null);

    // After a new deploy, a page opened earlier can reference JS files that no
    // longer exist (ChunkLoadError → blank screen). Reload once to pick up the
    // new version; guarded so it can't loop.
    const isChunkError = (x: any) =>
      /ChunkLoadError|Loading chunk .* failed|Failed to fetch dynamically imported module/i.test(
        String(x?.name || "") + " " + String(x?.message || x || "")
      );
    const recover = (x: any) => {
      if (!isChunkError(x)) return;
      try {
        const last = Number(sessionStorage.getItem("chunk_reload_at") || 0);
        if (Date.now() - last < 30_000) return;
        sessionStorage.setItem("chunk_reload_at", String(Date.now()));
      } catch {}
      window.location.reload();
    };
    const onError = (e: ErrorEvent) => recover(e.error || e.message);
    const onRejection = (e: PromiseRejectionEvent) => recover(e.reason);

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  const standalone =
    typeof window !== "undefined" &&
    (window.matchMedia?.("(display-mode: standalone)").matches ||
      (window.navigator as any).standalone === true);

  if (!prompt || dismissed || standalone) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 flex items-center justify-between gap-3 border-t border-slate-200 bg-white px-4 py-3 shadow-[0_-2px_10px_rgba(0,0,0,0.06)]">
      <span className="text-sm text-slate-700">📷 Install Order Scanner as an app</span>
      <div className="flex gap-2">
        <button
          className="btn-ghost !py-1.5 !px-3 text-xs"
          onClick={() => setDismissed(true)}
        >
          Not now
        </button>
        <button
          className="btn-primary !py-1.5 !px-3 text-xs"
          onClick={async () => {
            prompt.prompt();
            try {
              await prompt.userChoice;
            } catch {}
            setPrompt(null);
          }}
        >
          Install
        </button>
      </div>
    </div>
  );
}
