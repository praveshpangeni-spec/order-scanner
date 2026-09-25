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
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
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
