"use client";

import { useEffect, useState, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import JSZip from "jszip";

const WINDOWS_INSTALLER_URL =
  process.env.NEXT_PUBLIC_INSTALLER_URL ??
  "https://pub-aa1b48d86cfc49d69effbf73a4f10cee.r2.dev/VoicerSetup.exe";

const MAC_INSTALLER_URL =
  process.env.NEXT_PUBLIC_MAC_INSTALLER_URL ??
  "https://pub-ab293b0d3d6d4fd188ae2c2155f079d0.r2.dev/VoicerInstaller.dmg";

type Platform = "windows" | "mac";
type Stage = "validating" | "downloading" | "bundling" | "done" | "error" | "mobile";

function isMobileUA(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|Opera Mini|IEMobile|WPDesktop/i.test(
    navigator.userAgent
  );
}

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "windows";
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent)
    ? "mac"
    : "windows";
}

function DownloadFlow() {
  const searchParams = useSearchParams();
  const uid = searchParams.get("uid");
  const planParam = searchParams.get("plan");
  const startedRef = useRef(false);

  const [stage, setStage] = useState<Stage>("validating");
  const [progress, setProgress] = useState(0); // 0-100
  const [errorMsg, setErrorMsg] = useState("");
  const [platform, setPlatform] = useState<Platform>("windows");

  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const isValid = uid && uuidRegex.test(uid);

  useEffect(() => {
    if (startedRef.current) return;
    if (!isValid) {
      setStage("error");
      setErrorMsg("Invalid or missing download link. Check your email for the correct URL.");
      return;
    }
    if (isMobileUA()) {
      setStage("mobile");
      return;
    }
    const p = detectPlatform();
    setPlatform(p);
    startedRef.current = true;
    bundleAndDownload(uid, p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isValid, uid]);

  async function bundleAndDownload(userId: string, plat: Platform = platform) {
    try {
      // ── Download the installer ────────────────────────────────────
      setStage("downloading");
      setProgress(0);

      const installerUrl = plat === "mac" ? MAC_INSTALLER_URL : WINDOWS_INSTALLER_URL;
      const resp = await fetch(installerUrl);
      if (!resp.ok) throw new Error("Download failed — please try again.");

      const contentLength = Number(resp.headers.get("content-length") ?? 0);
      const reader = resp.body?.getReader();
      if (!reader) throw new Error("Streaming not supported");

      const chunks: Uint8Array[] = [];
      let received = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (contentLength > 0) {
          setProgress(Math.min(95, Math.round((received / contentLength) * 95)));
        }
      }

      // Combine chunks into a single blob
      const installerBlob = new Blob(chunks as BlobPart[]);

      // ── Bundle into zip ───────────────────────────────────────────
      setStage("bundling");
      setProgress(96);

      const zip = new JSZip();
      // Plan comes from URL param (set by webhook email) — not from Supabase
      // because the user opening this link on their PC is unauthenticated (RLS blocks it).
      // This is advisory only — host enforces plan server-side via get_user_plan_async().
      const plan = planParam === "pro" || planParam === "byok" ? planParam : "free";

      const installerName = plat === "mac" ? "VoicerInstaller.dmg" : "VoicerSetup.exe";
      zip.file(installerName, installerBlob);
      zip.file("voicer-activation.txt", `${userId}\n${plan}`);

      setProgress(98);
      const zipBlob = await zip.generateAsync({ type: "blob" });
      setProgress(100);

      // ── Auto-trigger download ─────────────────────────────────────
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = plat === "mac" ? "VoicerInstaller-macOS.zip" : "VoicerInstaller.zip";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setStage("done");
    } catch (err) {
      setStage("error");
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    }
  }

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-6 rounded-2xl border border-zinc-800 bg-zinc-950 p-8">
      {stage === "mobile" ? (
        <>
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-yellow-500/20">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#eab308" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
              <line x1="12" y1="18" x2="12.01" y2="18" />
            </svg>
          </div>
          <div className="text-center">
            <p className="font-semibold">Open this link on your PC</p>
            <p className="mt-2 text-sm text-zinc-400">
              Voicer installs on Windows. Open this same link in a browser on the computer you want to control.
            </p>
            <p className="mt-4 text-xs text-zinc-600">
              Tip: copy the link from your email and paste it on your PC.
            </p>
          </div>
        </>
      ) : stage === "error" ? (
        <>
          <p className="text-center text-red-400">{errorMsg}</p>
          <a
            href="/login"
            className="text-sm text-zinc-500 hover:text-zinc-300"
          >
            Back to sign in
          </a>
        </>
      ) : stage === "done" ? (
        <>
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-500/20">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <div className="text-center">
            <p className="font-semibold">Download started</p>
            <p className="mt-2 text-sm text-zinc-400">
              Unzip the file and run{" "}
              <strong className="text-white">
                {platform === "mac" ? "VoicerInstaller.dmg" : "VoicerSetup.exe"}
              </strong>
              .
            </p>
            <p className="mt-1 text-sm text-zinc-400">
              Keep both files in the same folder.
            </p>
          </div>
          <p className="mt-2 text-xs text-zinc-500 text-center leading-relaxed">
            {platform === "mac"
              ? "macOS may say \u201ccannot be opened, unidentified developer\u201d \u2014 right-click the .dmg \u2192 Open \u2192 Open. Only needed the first time."
              : "Windows SmartScreen may show \u201cWindows protected your PC / Suspicious Download\u201d \u2014 click More info \u2192 Run / Download anyway. The installer isn\u2019t \u201csigned\u201d yet (cert is ~$300/yr, we skipped :))."}
          </p>
          <p className="mt-2 text-xs text-zinc-500 text-center leading-relaxed">
            Voicer sets up a small background service so your desktop is always
            ready when you open the app on your phone.
          </p>
          <button
            type="button"
            onClick={() => bundleAndDownload(uid!, platform)}
            className="text-sm text-zinc-500 hover:text-zinc-300"
          >
            Download didn&apos;t start? Click here
          </button>
        </>
      ) : (
        <>
          <p className="font-semibold">
            {stage === "validating" && "Preparing..."}
            {stage === "downloading" && "Downloading installer..."}
            {stage === "bundling" && "Bundling your installer..."}
          </p>

          {/* Progress bar */}
          <div className="w-full rounded-full bg-zinc-800 h-2 overflow-hidden">
            <div
              className="h-full bg-white rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>

          <p className="text-xs text-zinc-600">
            {stage === "downloading"
              ? `${progress}% — this may take a moment on slower connections`
              : "Almost there..."}
          </p>
        </>
      )}
    </div>
  );
}

export default function DownloadPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-black p-6 text-white">
      <h1 className="text-3xl font-bold">Voicer</h1>
      <Suspense
        fallback={
          <div className="flex w-full max-w-md flex-col items-center gap-6 rounded-2xl border border-zinc-800 bg-zinc-950 p-8">
            <p className="font-semibold">Preparing...</p>
          </div>
        }
      >
        <DownloadFlow />
      </Suspense>
    </main>
  );
}
