import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/global.css";
import App from "./App";

// Chrome-free transient webviews (capture overlay, HUD, pinned images) are
// transparent at the OS level so the live desktop / frozen frame shows through.
// global.css paints an opaque `body { background: var(--bg) }` (a dark substrate),
// which would otherwise flood that transparency with a solid dark-blue veil until
// the frozen screenshot finishes decoding. Force the document transparent on those
// routes — runs synchronously before React's first paint, so there's no flash.
{
  const hash = window.location.hash;
  if (
    hash.startsWith("#/overlay") ||
    hash.startsWith("#/hud") ||
    hash.startsWith("#/pin") ||
    hash.startsWith("#/rec-bar") ||
    hash.startsWith("#/rec-countdown") ||
    hash.startsWith("#/rec-select") ||
    hash.startsWith("#/rec-hud") ||
    hash.startsWith("#/rec-cam")
  ) {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
