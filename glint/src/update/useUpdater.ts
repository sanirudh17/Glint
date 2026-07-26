/**
 * useUpdater — shared update state machine for the Settings panel and the popup.
 *
 * `check()` compares the running version against the latest GitHub release;
 * `install()` kicks off the Rust download+launch and tracks its progress from the
 * `update-progress` / `update-launching` / `update-error` events. The pure
 * comparison lives in ./version; this hook is only the glue + async/IO.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentVersion, fetchLatestRelease, installUpdate } from "./github";
import { isNewer } from "./version";

export type UpdateStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "uptodate"; current: string }
  | {
      kind: "available";
      current: string;
      latest: string;
      assetUrl: string;
      htmlUrl: string;
      notes: string;
    }
  | { kind: "downloading"; version: string; downloaded: number; total: number | null }
  | { kind: "launching"; version: string }
  | { kind: "error"; message: string };

function messageOf(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return "Something went wrong.";
}

export function useUpdater() {
  const [status, setStatus] = useState<UpdateStatus>({ kind: "idle" });
  const versionRef = useRef<string>("");

  const check = useCallback(async () => {
    setStatus({ kind: "checking" });
    try {
      const [current, release] = await Promise.all([getCurrentVersion(), fetchLatestRelease()]);
      if (release.assetUrl && isNewer(release.version, current)) {
        setStatus({
          kind: "available",
          current,
          latest: release.version,
          assetUrl: release.assetUrl,
          htmlUrl: release.htmlUrl,
          notes: release.notes,
        });
      } else {
        setStatus({ kind: "uptodate", current });
      }
    } catch (e) {
      setStatus({ kind: "error", message: messageOf(e) });
    }
  }, []);

  const install = useCallback(async (assetUrl: string, version: string) => {
    versionRef.current = version;
    setStatus({ kind: "downloading", version, downloaded: 0, total: null });
    try {
      await installUpdate(assetUrl, version);
    } catch (e) {
      setStatus({ kind: "error", message: messageOf(e) });
    }
  }, []);

  // Progress / terminal events from the Rust download thread.
  useEffect(() => {
    const subs = [
      listen<{ downloaded: number; total: number | null }>("update-progress", (e) => {
        setStatus({
          kind: "downloading",
          version: versionRef.current,
          downloaded: e.payload.downloaded,
          total: e.payload.total,
        });
      }),
      listen<string>("update-launching", (e) => {
        setStatus({ kind: "launching", version: e.payload });
      }),
      listen<string>("update-error", (e) => {
        setStatus({ kind: "error", message: e.payload });
      }),
    ];
    return () => {
      subs.forEach((p) => p.then((f) => f()));
    };
  }, []);

  return { status, check, install };
}
