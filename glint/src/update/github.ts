/**
 * github.ts — talk to GitHub + the Rust updater.
 *
 * The version CHECK is a plain browser `fetch` from the webview to GitHub's public
 * API (CSP is unset and GitHub sends permissive CORS), so it needs no Rust. The
 * DOWNLOAD is a Rust command (`update_install`) because streaming a ~100 MB
 * installer over IPC and writing it from JS would be wasteful and clumsy.
 */
import { invoke } from "@tauri-apps/api/core";

/** Repo the releases live under — keep in sync with updater.rs's URL guard. */
const OWNER_REPO = "sanirudh17/Glint";
const LATEST_RELEASE_API = `https://api.github.com/repos/${OWNER_REPO}/releases/latest`;

export interface LatestRelease {
  /** Numeric version with any leading "v" stripped, e.g. "0.1.4". */
  version: string;
  /** The `-setup.exe` asset download URL, or null if the release has none. */
  assetUrl: string | null;
  /** The release's human page on GitHub. */
  htmlUrl: string;
  /** Release notes (markdown), may be empty. */
  notes: string;
}

/** The running build's version, from Rust (`app.package_info().version`). */
export function getCurrentVersion(): Promise<string> {
  return invoke<string>("app_version");
}

/** Fetch the latest published release. Throws on network / rate-limit / HTTP error. */
export async function fetchLatestRelease(): Promise<LatestRelease> {
  const res = await fetch(LATEST_RELEASE_API, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!res.ok) {
    throw new Error(
      res.status === 403
        ? "GitHub rate limit reached — try again in a little while."
        : `GitHub returned ${res.status}.`,
    );
  }
  const json = (await res.json()) as {
    tag_name?: string;
    html_url?: string;
    body?: string;
    assets?: Array<{ name?: string; browser_download_url?: string }>;
  };
  const tag = json.tag_name ?? "";
  const asset = (json.assets ?? []).find((a) => /-setup\.exe$/i.test(a.name ?? ""));
  return {
    version: tag.replace(/^v/i, ""),
    assetUrl: asset?.browser_download_url ?? null,
    htmlUrl: json.html_url ?? `https://github.com/${OWNER_REPO}/releases/latest`,
    notes: json.body ?? "",
  };
}

/**
 * Ask Rust to download the installer and launch it. Resolves as soon as the
 * download STARTS; progress arrives via the `update-progress` event and the app
 * exits itself once the installer is launched (`update-launching`). Rejects only
 * if the download couldn't be started (e.g. the URL failed validation).
 */
export function installUpdate(url: string, version: string): Promise<void> {
  return invoke<void>("update_install", { url, version });
}
