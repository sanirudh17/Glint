# Window-frame chrome — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wrap the framed screenshot in an OS-neutral fake window — a titled "Window" bar or a "Browser" address bar — in light/dark, edited from the frame panel and baked into every export.

**Architecture:** Chrome is one new field on the existing `FrameConfig`. Pure layout math (`composition.ts`) adds a fixed-height bar band above the image as part of the rounded "card"; a new Konva sub-component (`WindowChrome.tsx`) paints the bar; `FramePanel.tsx` gains the controls; the store gains a `setChrome` action that auto-enables the frame and applies a smart-default title. No Rust, no new window, no capability changes.

**Tech Stack:** TypeScript, React 19, Zustand, react-konva/Konva, Vitest.

## Global Constraints

- **Local-first:** no cloud, no upload, no accounts, no network. The URL field is cosmetic text — never fetched or validated. (verbatim: "Everything stays on my device. No cloud, no upload, no accounts, no network calls.")
- **Single-user:** no auth of any kind.
- **Recorder isolation (SACRED):** files under `glint/src-tauri/src/recorder/*` import nothing from `capture/`, `editor/`, `overlay/`, `ocr/`; `ocr/` imports nothing from `recorder/`. This phase touches only `glint/src/editor` + `glint/src/views/editor` (frontend) — no Rust, so isolation is unaffected; the green gate re-verifies it.
- **Base branch:** work on `phase-13-window-chrome`, merge to `master` (not `main`).
- **`chromeStyle: "none"` must stay byte-identical** to the current framed output (regression guard).
- **Chrome style values are exactly:** `"none" | "window" | "browser"`. **Theme values:** `"light" | "dark"`. No macOS traffic lights, no Windows caption buttons, no browser tab strip.

---

### Task 1: Chrome model, defaults & persistence

**Files:**
- Modify: `glint/src/editor/useEditorStore.ts` (add `WindowChrome`, extend `FrameConfig`, `DEFAULT_FRAME`, `freshFrame`, `mergeFrame`)
- Test: `glint/src/editor/useEditorStore.test.ts`

**Interfaces:**
- Produces:
  - `interface WindowChrome { style: "none" | "window" | "browser"; theme: "light" | "dark"; title: string; url: string }`
  - `FrameConfig` gains `chrome: WindowChrome`
  - `DEFAULT_FRAME.chrome === { style: "none", theme: "light", title: "", url: "" }`

- [ ] **Step 1: Write the failing tests**

Add to `glint/src/editor/useEditorStore.test.ts` (new `describe` block at end of file):

```ts
describe("window chrome — model & persistence", () => {
  beforeEach(() => useEditorStore.getState().reset());

  it("defaults to no chrome", () => {
    expect(DEFAULT_FRAME.chrome).toEqual({ style: "none", theme: "light", title: "", url: "" });
    useEditorStore.getState().loadDoc(fakeBase(), null, null);
    expect(useEditorStore.getState().frame.chrome.style).toBe("none");
  });

  it("mergeFrame defaults chrome for a legacy doc that lacks it", () => {
    // A legacy frame object with no `chrome` key still hydrates with the default chrome.
    const legacy = { ...DEFAULT_FRAME } as Record<string, unknown>;
    delete legacy.chrome;
    useEditorStore.getState().loadDoc(
      fakeBase(),
      { annotations: [], crop: null, frame: legacy as never },
      null,
    );
    expect(useEditorStore.getState().frame.chrome).toEqual(DEFAULT_FRAME.chrome);
  });

  it("resetFrame clears chrome back to none", () => {
    const s = useEditorStore.getState();
    s.setFrame({ chrome: { style: "window", theme: "dark", title: "X", url: "" } });
    expect(useEditorStore.getState().frame.chrome.style).toBe("window");
    s.resetFrame();
    expect(useEditorStore.getState().frame.chrome).toEqual(DEFAULT_FRAME.chrome);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd glint && npx vitest run src/editor/useEditorStore.test.ts`
Expected: FAIL — `DEFAULT_FRAME.chrome` is `undefined` (property does not exist yet).

- [ ] **Step 3: Add the type and extend the config**

In `glint/src/editor/useEditorStore.ts`, add the interface above `FrameConfig`:

```ts
export interface WindowChrome {
  style: "none" | "window" | "browser";
  theme: "light" | "dark";
  /** Centered title text (Window style). Empty → no title drawn. */
  title: string;
  /** Address-bar text (Browser style). Empty → empty pill. */
  url: string;
}
```

Add `chrome` to `FrameConfig`:

```ts
export interface FrameConfig {
  enabled: boolean;
  background: FrameBackground;
  padding: number;
  radius: number;
  shadow: number;
  aspect: "auto" | "1:1" | "16:9" | "4:3";
  chrome: WindowChrome;
}
```

Add `chrome` to `DEFAULT_FRAME`:

```ts
export const DEFAULT_FRAME: FrameConfig = {
  enabled: false,
  background: { type: "gradient", gradientId: GRADIENTS[0].id },
  padding: 40,
  radius: 12,
  shadow: 35,
  aspect: "auto",
  chrome: { style: "none", theme: "light", title: "", url: "" },
};
```

- [ ] **Step 4: Deep-clone chrome in `freshFrame` and default it in `mergeFrame`**

Replace `freshFrame` and `mergeFrame`:

```ts
/** Fresh frame config with nested background + chrome cloned (so resets never share refs). */
const freshFrame = (): FrameConfig => ({
  ...DEFAULT_FRAME,
  background: { ...DEFAULT_FRAME.background },
  chrome: { ...DEFAULT_FRAME.chrome },
});

/** Merge a loaded frame over defaults so a partial/legacy doc still hydrates safely. */
const mergeFrame = (f: FrameConfig | undefined): FrameConfig =>
  f
    ? {
        ...DEFAULT_FRAME,
        ...f,
        background: f.background ? { ...f.background } : { ...DEFAULT_FRAME.background },
        chrome: { ...DEFAULT_FRAME.chrome, ...(f.chrome ?? {}) },
      }
    : freshFrame();
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd glint && npx vitest run src/editor/useEditorStore.test.ts`
Expected: PASS (all, including the three new ones).

- [ ] **Step 6: Typecheck**

Run: `cd glint && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add glint/src/editor/useEditorStore.ts glint/src/editor/useEditorStore.test.ts
git commit -m "feat(p13): window-chrome model, defaults, legacy-safe merge"
```

---

### Task 2: `setChrome` action — auto-enable frame + smart-default title

**Files:**
- Modify: `glint/src/editor/useEditorStore.ts` (add `setChrome` to the interface and the store)
- Test: `glint/src/editor/useEditorStore.test.ts`

**Interfaces:**
- Consumes: `WindowChrome`, `FrameConfig.chrome` (Task 1).
- Produces: `setChrome: (patch: Partial<WindowChrome>) => void` — merges the patch into `frame.chrome`; if the resulting `style` is `"window"` or `"browser"`, sets `frame.enabled = true`; when switching to `"window"` with an empty title, prefills `title` from `projectName` (or `""`). Never pushes undo history (frame state is live, like `setFrame`).

- [ ] **Step 1: Write the failing tests**

Add to `glint/src/editor/useEditorStore.test.ts`:

```ts
describe("window chrome — setChrome action", () => {
  beforeEach(() => useEditorStore.getState().reset());

  it("selecting Window auto-enables the frame", () => {
    const s = useEditorStore.getState();
    expect(useEditorStore.getState().frame.enabled).toBe(false);
    s.setChrome({ style: "window" });
    expect(useEditorStore.getState().frame.enabled).toBe(true);
    expect(useEditorStore.getState().frame.chrome.style).toBe("window");
  });

  it("selecting Browser auto-enables the frame", () => {
    useEditorStore.getState().setChrome({ style: "browser" });
    expect(useEditorStore.getState().frame.enabled).toBe(true);
  });

  it("selecting None does NOT disable an enabled frame", () => {
    const s = useEditorStore.getState();
    s.toggleFrame(true);
    s.setChrome({ style: "none" });
    expect(useEditorStore.getState().frame.enabled).toBe(true);
    expect(useEditorStore.getState().frame.chrome.style).toBe("none");
  });

  it("switching to Window prefills the title from the project name when empty", () => {
    useEditorStore.getState().loadDoc(fakeBase(), null, { path: "C:/x/Report.glint", name: "Report.glint" });
    useEditorStore.getState().setChrome({ style: "window" });
    expect(useEditorStore.getState().frame.chrome.title).toBe("Report.glint");
  });

  it("does not overwrite a title the user already set", () => {
    const s = useEditorStore.getState();
    s.loadDoc(fakeBase(), null, { path: "C:/x/Report.glint", name: "Report.glint" });
    s.setChrome({ style: "window", title: "Mine" });
    s.setChrome({ theme: "dark" }); // unrelated change must keep the title
    expect(useEditorStore.getState().frame.chrome.title).toBe("Mine");
  });

  it("setChrome does not push undo history", () => {
    useEditorStore.getState().setChrome({ style: "browser" });
    expect(useEditorStore.getState().past).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd glint && npx vitest run src/editor/useEditorStore.test.ts`
Expected: FAIL — `s.setChrome is not a function`.

- [ ] **Step 3: Declare `setChrome` in the `EditorState` interface**

In `glint/src/editor/useEditorStore.ts`, next to `setFrame`/`toggleFrame`:

```ts
  setFrame: (patch: Partial<FrameConfig>) => void;
  setChrome: (patch: Partial<WindowChrome>) => void;
  toggleFrame: (on?: boolean) => void;
```

- [ ] **Step 4: Implement `setChrome` in the store**

Add next to `setFrame` in the store body:

```ts
  // Chrome is live tweak state (like setFrame — never in history). Selecting a
  // real chrome style auto-enables the frame (chrome is part of the card, so a
  // no-op would confuse). Switching to Window with an empty title prefills the
  // project name as a convenience (still editable/clearable).
  setChrome: (patch) =>
    set((s) => {
      const chrome = { ...s.frame.chrome, ...patch };
      const enabling = chrome.style === "window" || chrome.style === "browser";
      if (chrome.style === "window" && !chrome.title.trim()) {
        chrome.title = s.projectName ?? "";
      }
      return {
        frame: { ...s.frame, chrome, enabled: enabling ? true : s.frame.enabled },
        dirty: true,
      };
    }),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd glint && npx vitest run src/editor/useEditorStore.test.ts`
Expected: PASS (all).

- [ ] **Step 6: Typecheck**

Run: `cd glint && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add glint/src/editor/useEditorStore.ts glint/src/editor/useEditorStore.test.ts
git commit -m "feat(p13): setChrome — auto-enable frame + smart-default title"
```

---

### Task 3: Layout math — chrome band above the image

**Files:**
- Modify: `glint/src/editor/composition.ts` (extend `FrameLayoutInput`, `Layout`, `computeLayout`)
- Test: `glint/src/editor/composition.test.ts`

**Interfaces:**
- Consumes: nothing new (pure module).
- Produces:
  - `FrameLayoutInput` gains optional `chrome?: { style: "none" | "window" | "browser" }`.
  - `Layout` gains `chromeH: number` (0 when no chrome).
  - `computeLayout` pushes `contentY` down by `chromeH` and grows `compositionH` by `chromeH`; `compositionW` unchanged. With `chrome` absent or `style: "none"`, every existing field is unchanged.

- [ ] **Step 1: Write the failing tests**

Add to `glint/src/editor/composition.test.ts` inside the `describe("composition", …)` block:

```ts
  it("chrome none → chromeH 0 and layout unchanged", () => {
    const l = computeLayout(400, 200, null, on({ padding: 100, chrome: { style: "none" } }));
    expect(l.chromeH).toBe(0);
    expect(l.compositionH).toBe(400); // same as the padding-only case
    expect(l.contentY).toBe(100);
  });

  it("chrome window adds a bar above the image", () => {
    // content 400 wide → barH = clamp(round(400*0.045)=18, 28, 120) = 28
    const l = computeLayout(400, 200, null, on({ padding: 100, chrome: { style: "window" } }));
    expect(l.chromeH).toBe(28);
    expect(l.compositionH).toBe(428); // 400 + chromeH
    expect(l.compositionW).toBe(600); // unchanged
    expect(l.contentY).toBe(128);     // image pushed down by chromeH
  });

  it("chrome browser has the same single-row bar height as window", () => {
    const w = computeLayout(400, 200, null, on({ padding: 100, chrome: { style: "window" } }));
    const b = computeLayout(400, 200, null, on({ padding: 100, chrome: { style: "browser" } }));
    expect(b.chromeH).toBe(w.chromeH);
  });

  it("bar height respects the clamp on a large capture", () => {
    // content 4000 wide → round(4000*0.045)=180 → clamped to 120
    const l = computeLayout(4000, 2000, null, on({ padding: 0, chrome: { style: "window" } }));
    expect(l.chromeH).toBe(120);
  });

  it("frame disabled → chromeH 0 even with a chrome style set", () => {
    const l = computeLayout(400, 200, null, { enabled: false, padding: 0, radius: 0, shadow: 0, aspect: "auto", chrome: { style: "window" } });
    expect(l.chromeH).toBe(0);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd glint && npx vitest run src/editor/composition.test.ts`
Expected: FAIL — `l.chromeH` is `undefined`.

- [ ] **Step 3: Extend the interfaces + add constants**

In `glint/src/editor/composition.ts`, extend `FrameLayoutInput`:

```ts
export interface FrameLayoutInput {
  enabled: boolean;
  padding: number; // 0–100
  radius: number;
  shadow: number;
  aspect: AspectId;
  /** Only the layout-relevant chrome field; theme/title/url are visual-only. Optional so
      existing callers and legacy layouts default to no chrome. */
  chrome?: { style: "none" | "window" | "browser" };
}
```

Add `chromeH` to `Layout`:

```ts
export interface Layout {
  contentW: number; contentH: number;
  contentX: number; contentY: number;
  compositionW: number; compositionH: number;
  paddingPx: number;
  cropX: number; cropY: number;
  chromeH: number; // height of the chrome band above the image (0 when none)
}
```

Add constants below `ASPECT_RATIO`:

```ts
// Chrome bar height scales with the screenshot's width so it reads consistently
// across capture sizes, then clamps (tuned at-screen, like the shadow ramp).
const BAR_RATIO = 0.045;
const BAR_MIN = 28;
const BAR_MAX = 120;
```

- [ ] **Step 4: Compute `chromeH` in `computeLayout`**

Update the frame-off early return to include `chromeH: 0`:

```ts
  if (!frame.enabled) {
    return {
      contentW, contentH, contentX: 0, contentY: 0,
      compositionW: contentW, compositionH: contentH,
      paddingPx: 0, cropX, cropY, chromeH: 0,
    };
  }
```

Replace the enabled-path body (from `const paddingPx …` to the final `return`) with:

```ts
  const chromeStyle = frame.chrome?.style ?? "none";
  const barH = Math.min(BAR_MAX, Math.max(BAR_MIN, Math.round(contentW * BAR_RATIO)));
  const chromeH = chromeStyle === "none" ? 0 : barH;

  const paddingPx = Math.round((frame.padding / 100) * 0.25 * Math.max(contentW, contentH));
  let compW = contentW + paddingPx * 2;
  let compH = contentH + chromeH + paddingPx * 2;

  const ratio = ASPECT_RATIO[frame.aspect];
  if (ratio) {
    // Enlarge whichever single axis is deficient so compW/compH === ratio.
    if (compW / compH < ratio) compW = Math.round(compH * ratio);
    else compH = Math.round(compW / ratio);
  }

  // The card (chrome bar + image) is centered vertically; the image sits chromeH
  // below the card's top. With chromeH 0 this reduces to the pre-chrome math.
  const cardTop = Math.round((compH - (chromeH + contentH)) / 2);

  return {
    contentW, contentH,
    contentX: Math.round((compW - contentW) / 2),
    contentY: cardTop + chromeH,
    compositionW: compW, compositionH: compH,
    paddingPx, cropX, cropY, chromeH,
  };
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd glint && npx vitest run src/editor/composition.test.ts`
Expected: PASS — including the pre-existing "frame off"/padding/aspect tests (byte-identical for the none case).

- [ ] **Step 6: Typecheck**

Run: `cd glint && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add glint/src/editor/composition.ts glint/src/editor/composition.test.ts
git commit -m "feat(p13): composition math for the chrome bar band"
```

---

### Task 4: `WindowChrome` Konva renderer

**Files:**
- Create: `glint/src/views/editor/WindowChrome.tsx`

**Interfaces:**
- Consumes: `WindowChrome` shape fields (`style`, `theme`, `title`, `url`) from Task 1.
- Produces: `WindowChrome` React component:
  `function WindowChrome(props: { x: number; y: number; width: number; height: number; radius: number; style: "window" | "browser"; theme: "light" | "dark"; title: string; url: string }): JSX.Element` — returns a Konva `<Group listening={false}>` painting the bar (top-rounded), a divider, and either a centered title (window) or an address bar (browser). Callers only mount it when `style !== "none"` and `height > 0`.

- [ ] **Step 1: Create the component**

Create `glint/src/views/editor/WindowChrome.tsx`:

```tsx
import { Group, Rect, Text, Line } from "react-konva";

interface Props {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
  style: "window" | "browser";
  theme: "light" | "dark";
  title: string;
  url: string;
}

const SANS = "system-ui, -apple-system, Segoe UI, Roboto, sans-serif";

/**
 * Konva painter for the OS-neutral window chrome band that sits above the
 * screenshot inside the framed card. Purely decorative (listening=false); never
 * clickable. "window" → centered title; "browser" → back/forward/reload glyphs +
 * a lock + URL address pill. Top corners round to match the card; the bottom
 * edge butts flat against the image.
 */
export function WindowChrome({ x, y, width, height, radius, style, theme, title, url }: Props) {
  const dark = theme === "dark";
  const barFill = dark ? "#2b2b2b" : "#f6f6f6";
  const textColor = dark ? "#e6e6e6" : "#3c3c3c";
  const dividerColor = dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.10)";
  const pad = Math.round(height * 0.28);
  const font = Math.max(9, Math.round(height * 0.36));
  // Top corners rounded, bottom square (the image meets it flat).
  const topRounded = [radius, radius, 0, 0];

  return (
    <Group x={x} y={y} listening={false}>
      <Rect x={0} y={0} width={width} height={height} fill={barFill} cornerRadius={topRounded} />
      <Line points={[0, height - 0.5, width, height - 0.5]} stroke={dividerColor} strokeWidth={1} />

      {style === "window" && title.trim() !== "" && (
        <Text
          x={pad}
          y={0}
          width={Math.max(0, width - pad * 2)}
          height={height}
          text={title}
          fontFamily={SANS}
          fontSize={font}
          fill={textColor}
          align="center"
          verticalAlign="middle"
          ellipsis
          wrap="none"
        />
      )}

      {style === "browser" && renderBrowser({ width, height, pad, font, textColor, dark, url })}
    </Group>
  );
}

function renderBrowser({
  width, height, pad, font, textColor, dark, url,
}: {
  width: number; height: number; pad: number; font: number; textColor: string; dark: boolean; url: string;
}) {
  const navFont = Math.round(font * 1.15);
  const navGap = Math.round(height * 0.42);
  const navX = pad;
  // Back, forward, reload glyphs (decorative). Each is a centered Text cell.
  const glyphs = ["‹", "›", "⟳"];
  const navCells = glyphs.map((g, i) => (
    <Text
      key={g}
      x={navX + i * navGap}
      y={0}
      width={navGap}
      height={height}
      text={g}
      fontFamily={SANS}
      fontSize={navFont}
      fill={textColor}
      align="center"
      verticalAlign="middle"
      wrap="none"
    />
  ));

  const pillH = Math.round(height * 0.62);
  const pillY = Math.round((height - pillH) / 2);
  const pillX = navX + glyphs.length * navGap + Math.round(pad * 0.5);
  const pillW = Math.max(0, width - pillX - pad);
  const pillFill = dark ? "#1e1e1e" : "#ffffff";
  const lockSize = Math.round(pillH * 0.5);
  const lockX = pillX + Math.round(pillH * 0.32);
  const urlX = lockX + lockSize + Math.round(pillH * 0.18);
  const urlW = Math.max(0, pillX + pillW - urlX - Math.round(pillH * 0.3));

  return (
    <Group>
      {navCells}
      <Rect x={pillX} y={pillY} width={pillW} height={pillH} fill={pillFill} cornerRadius={pillH / 2} />
      {/* Lock: a small padlock — filled body + stroked shackle. */}
      <Rect
        x={lockX}
        y={pillY + Math.round(pillH * 0.5) - Math.round(lockSize * 0.15)}
        width={lockSize}
        height={Math.round(lockSize * 0.55)}
        fill={textColor}
        cornerRadius={Math.round(lockSize * 0.12)}
      />
      <Line
        points={lockShacklePoints(lockX, pillY, pillH, lockSize)}
        stroke={textColor}
        strokeWidth={Math.max(1, Math.round(lockSize * 0.12))}
        tension={0}
      />
      <Text
        x={urlX}
        y={0}
        width={urlW}
        height={height}
        text={url}
        fontFamily={SANS}
        fontSize={font}
        fill={textColor}
        align="left"
        verticalAlign="middle"
        ellipsis
        wrap="none"
      />
    </Group>
  );
}

/** Three-point polyline tracing a padlock shackle (an inverted U) above the body. */
function lockShacklePoints(lockX: number, pillY: number, pillH: number, lockSize: number): number[] {
  const cx = lockX + lockSize / 2;
  const bodyTop = pillY + Math.round(pillH * 0.5) - Math.round(lockSize * 0.15);
  const topY = bodyTop - Math.round(lockSize * 0.32);
  const halfW = Math.round(lockSize * 0.26);
  return [cx - halfW, bodyTop, cx - halfW, topY, cx + halfW, topY, cx + halfW, bodyTop];
}
```

- [ ] **Step 2: Typecheck**

Run: `cd glint && npx tsc --noEmit`
Expected: no errors. (No unit test — Konva visuals are verified at-screen, consistent with `AnnotationNode.tsx`.)

- [ ] **Step 3: Commit**

```bash
git add glint/src/views/editor/WindowChrome.tsx
git commit -m "feat(p13): WindowChrome Konva renderer (title + browser address bar)"
```

---

### Task 5: Wire chrome into `EditorStage`

**Files:**
- Modify: `glint/src/views/editor/EditorStage.tsx` (card = bar+image; bottom-only image clip; mount `WindowChrome`)

**Interfaces:**
- Consumes: `layout.chromeH` (Task 3); `WindowChrome` (Task 4); `frame.chrome` (Task 1).
- Produces: nothing downstream (leaf rendering change).

- [ ] **Step 1: Import `WindowChrome` and add a bottom-rounded path helper**

At the top of `glint/src/views/editor/EditorStage.tsx`, add the import beside the other editor imports:

```ts
import { WindowChrome } from "./WindowChrome";
```

Below the existing `roundedRectPath` function, add:

```ts
/** Trace a rect whose BOTTOM two corners are rounded and top edge is square
    (the chrome bar covers the top). Used to clip the image under a chrome bar. */
function bottomRoundedRectPath(ctx: Konva.Context, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y);
  ctx.closePath();
}
```

- [ ] **Step 2: Compute card geometry near the other frame visuals**

In the render body, just after the `const r = frame.enabled ? frame.radius : 0;` line, add:

```ts
  const chromeH = layout.chromeH;
  const cardY = layout.contentY - chromeH;      // card top (bar top) — image top when chromeH 0
  const cardH = chromeH + layout.contentH;       // full card height (bar + image)
  const chromeOn = frame.enabled && chromeH > 0 && frame.chrome.style !== "none";
```

- [ ] **Step 3: Replace the screenshot-card Layer**

Find the Layer that currently renders the shadow rect + clipped image (the block starting `{/* Screenshot card: … */}` through its closing `</Layer>`). Replace that whole Layer with:

```tsx
        {/* Screenshot card: a shadow-casting rounded rect spanning the chrome bar +
            image, the image clipped to the card (bottom-only corners when a chrome
            bar covers the top), then the chrome bar painted on top. Frame off →
            chromeH 0, r 0, no shadow → plain image, byte-identical to before. */}
        <Layer listening={false}>
          {frame.enabled && (
            <Rect
              x={layout.contentX}
              y={cardY}
              width={layout.contentW}
              height={cardH}
              cornerRadius={r}
              fill="#000"
              {...shadowProps}
            />
          )}
          <Group
            clipFunc={
              r > 0
                ? chromeOn
                  ? (ctx) => bottomRoundedRectPath(ctx, layout.contentX, layout.contentY, layout.contentW, layout.contentH, r)
                  : (ctx) => roundedRectPath(ctx, layout.contentX, layout.contentY, layout.contentW, layout.contentH, r)
                : undefined
            }
          >
            <KonvaImage
              image={base.image}
              x={layout.contentX}
              y={layout.contentY}
              width={layout.contentW}
              height={layout.contentH}
              crop={{ x: layout.cropX, y: layout.cropY, width: layout.contentW, height: layout.contentH }}
            />
          </Group>
          {chromeOn && (
            <WindowChrome
              x={layout.contentX}
              y={cardY}
              width={layout.contentW}
              height={chromeH}
              radius={r}
              style={frame.chrome.style as "window" | "browser"}
              theme={frame.chrome.theme}
              title={frame.chrome.title}
              url={frame.chrome.url}
            />
          )}
        </Layer>
```

- [ ] **Step 4: Typecheck**

Run: `cd glint && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Full frontend test run (no regressions)**

Run: `cd glint && npx vitest run`
Expected: PASS (all suites).

- [ ] **Step 6: Commit**

```bash
git add glint/src/views/editor/EditorStage.tsx
git commit -m "feat(p13): render chrome bar as part of the screenshot card"
```

---

### Task 6: Frame-panel "Window" controls

**Files:**
- Modify: `glint/src/views/editor/FramePanel.tsx` (add the Window section)
- Modify: `glint/src/views/editor/editor.css` (add `.frame-input`)

**Interfaces:**
- Consumes: `frame.chrome` (Task 1), `setChrome` (Task 2).
- Produces: nothing downstream (UI leaf).

- [ ] **Step 1: Add the `.frame-input` style**

In `glint/src/views/editor/editor.css`, after the `.frame-swatches` rule (or near the other frame controls), add:

```css
.frame-input {
  width: 100%; height: 28px; padding: 0 var(--s2);
  border: 1px solid var(--border); border-radius: var(--r1);
  background: var(--bg); color: var(--text); font-size: var(--fz-sm);
}
```

- [ ] **Step 2: Read `setChrome` and render the Window section**

In `glint/src/views/editor/FramePanel.tsx`, add to the hook reads near the top of the component:

```tsx
  const setChrome = useEditorStore((s) => s.setChrome);
  const chrome = frame.chrome;
```

Then insert the Window section **after the background pickers block** (the `{bg.type === "solid" && …}`, `{bg.type === "gradient" && …}`, and `{bg.type === "transparent" && …}` conditionals) and **immediately before** the `<Slider label="Padding" …>` line:

```tsx
      <div className="frame-row">
        <span className="frame-label">Window</span>
        <div className="frame-seg">
          {(["none", "window", "browser"] as const).map((st) => (
            <button
              key={st}
              className={`frame-seg-btn${chrome.style === st ? " is-active" : ""}`}
              onClick={() => setChrome({ style: st })}
            >
              {st}
            </button>
          ))}
        </div>
      </div>

      {chrome.style !== "none" && (
        <>
          <div className="frame-row">
            <span className="frame-label">Theme</span>
            <div className="frame-seg">
              {(["light", "dark"] as const).map((th) => (
                <button
                  key={th}
                  className={`frame-seg-btn${chrome.theme === th ? " is-active" : ""}`}
                  onClick={() => setChrome({ theme: th })}
                >
                  {th}
                </button>
              ))}
            </div>
          </div>

          {chrome.style === "window" && (
            <label className="frame-row">
              <span className="frame-label">Title</span>
              <input
                className="frame-input"
                type="text"
                value={chrome.title}
                placeholder="Window title"
                onChange={(e) => setChrome({ title: e.currentTarget.value })}
                aria-label="Window title"
              />
            </label>
          )}

          {chrome.style === "browser" && (
            <label className="frame-row">
              <span className="frame-label">URL</span>
              <input
                className="frame-input"
                type="text"
                value={chrome.url}
                placeholder="example.com"
                onChange={(e) => setChrome({ url: e.currentTarget.value })}
                aria-label="Address bar URL"
              />
            </label>
          )}
        </>
      )}
```

- [ ] **Step 3: Typecheck**

Run: `cd glint && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Full frontend test run**

Run: `cd glint && npx vitest run`
Expected: PASS (all suites).

- [ ] **Step 5: Commit**

```bash
git add glint/src/views/editor/FramePanel.tsx glint/src/views/editor/editor.css
git commit -m "feat(p13): frame-panel Window controls (style/theme/title/url)"
```

---

### Task 7: Green gate, at-screen acceptance & merge

**Files:** none (verification + merge only).

- [ ] **Step 1: Frontend gate**

Run: `cd glint && npx tsc --noEmit && npx vitest run`
Expected: tsc clean; all Vitest suites pass.

- [ ] **Step 2: Backend gate (unchanged, but the gate runs)**

Run (stop the dev exe first so the binary isn't locked):
```bash
powershell -NoProfile -Command "Stop-Process -Name glint -Force -ErrorAction SilentlyContinue; exit 0"
cd glint/src-tauri && cargo build && cargo test
```
Expected: build succeeds; all Rust tests pass.

- [ ] **Step 3: Recorder/OCR isolation greps**

Run:
```bash
cd glint/src-tauri
grep -rnE "use +crate::(capture|editor|overlay|ocr)" src/recorder/ && echo VIOLATION || echo "recorder isolation OK"
grep -rnE "use +crate::recorder" src/ocr/ && echo VIOLATION || echo "ocr isolation OK"
```
Expected: both print "… OK".

- [ ] **Step 4: At-screen acceptance (manual, with the user)**

Launch `npm run tauri dev`, open a capture in the editor, open the Frame panel, and verify:
1. **Window / light + dark:** picking "window" auto-enables the frame; a centered title appears; the title defaults to the project name (or is editable if empty); light and dark bars both read cleanly; top corners of the bar round with the card.
2. **Browser / light + dark:** back/forward/reload glyphs + a lock + the URL pill render; typing in the URL field updates the address text; long URLs truncate with an ellipsis inside the pill.
3. **Annotations** drawn after enabling chrome land on the *image*, not on the bar.
4. **Export a PNG** (Export) and a **Done → HUD** hand-off: the chrome bakes into the flattened image at native resolution (no cut-off, correct proportions).
5. **Round-trip:** save a `.glint`, reset/reopen it, and confirm the chrome style/theme/title/url are restored.
6. **Regression:** with "none" (chrome off), a framed screenshot looks identical to Phase 12.

- [ ] **Step 5: Merge to master**

After the user confirms at-screen acceptance:
```bash
cd "C:/Users/sanir/Claude Code/glint"
git checkout master
git merge --no-ff phase-13-window-chrome -m "merge: Phase 13 — OS-neutral window-frame chrome (Window + Browser, light/dark)"
git branch -d phase-13-window-chrome
```

---

## Notes for the implementer

- **Run all `npx` / `git` commands from the `glint/` directory** unless a path says otherwise. The repo root is `C:\Users\sanir\Claude Code`; the frontend lives in `glint/`, Rust in `glint/src-tauri/`.
- **Dev-server exe lock:** if `cargo build` fails to write `glint.exe`, run `Stop-Process -Name glint -Force` first (a running dev build holds the binary).
- **Do not touch** anything under `glint/src-tauri/src/recorder/` or `glint/src/recorder/` — this phase is editor-only.
- The frame is **live tweak state**: chrome changes must never push undo history (mirrors `setFrame`).
