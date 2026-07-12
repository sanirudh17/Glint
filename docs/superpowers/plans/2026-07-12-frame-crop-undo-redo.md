# Frame & Crop Undo/Redo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make editor Frame edits (background/chrome/padding/radius/shadow/aspect) and the Reset frame / Reset crop / Frame-toggle actions reversible through the existing undo/redo, coalescing continuous gestures to one step.

**Architecture:** Extend the undo/redo history snapshot from `{ annotations, crop }` to `{ annotations, crop, frame }` behind one `snapshot()` helper in the Zustand store; add guarded history checkpoints to `resetFrame`/`resetCrop`/`toggleFrame`; and add per-gesture checkpoints in `FramePanel.tsx` (slider pointer-down, discrete-click, text focus) so one gesture is one undo step. `setFrame`/`setChrome` themselves stay history-free — the UI decides gesture boundaries.

**Tech Stack:** TypeScript, React, Zustand (`create`), Vitest. Editor-only (`glint/src/editor`, `glint/src/views/editor`); no Rust, no new dependencies.

## Global Constraints

- Base branch is `master` (NOT `main`); work on a branch, `--no-ff` merge only after at-screen acceptance.
- Recorder isolation: zero diff under `src-tauri` / `src/recorder`.
- No hardcoded values that belong in tokens (N/A here — logic only).
- Green gate before merge: from `glint/`, `npx tsc --noEmit` and `npx vitest run` both clean.
- Every commit ends with the footer:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01XjyYSmzX6b1SHQeqJQiX9n
  ```

## File Structure

- `glint/src/editor/useEditorStore.ts` — Zustand store; owns `DocSnapshot`, the new `snapshot()` helper, all history push/restore sites, and the guarded `resetFrame`/`resetCrop`/`toggleFrame`. (Tasks 1 & 2)
- `glint/src/editor/useEditorStore.test.ts` — store unit tests. (Tasks 1 & 2)
- `glint/src/views/editor/FramePanel.tsx` — Frame controls; adds gesture checkpoints. (Task 3)

---

### Task 1: Frame joins the undo/redo snapshot

**Files:**
- Modify: `glint/src/editor/useEditorStore.ts`
- Test: `glint/src/editor/useEditorStore.test.ts`

**Interfaces:**
- Consumes: existing `FrameConfig`, `Crop`, `Annotation`, `EditorState`, `freshFrame()`.
- Produces: `interface DocSnapshot { annotations: Annotation[]; crop: Crop | null; frame: FrameConfig }` and `const snapshot = (s: EditorState): DocSnapshot => …`, used by Task 2.

- [ ] **Step 1: Write the failing tests**

Add these two tests inside the `describe("useEditorStore", …)` block in `glint/src/editor/useEditorStore.test.ts` (e.g. right after the existing `"frame changes do NOT push history"` test at line 145):

```ts
  it("undo restores frame changes; redo re-applies them", () => {
    const s = useEditorStore.getState();
    s.setFrame({ padding: 20 });
    s.pushHistory(); // checkpoint at padding 20 (as a slider pointer-down would)
    s.setFrame({ padding: 80 });
    expect(useEditorStore.getState().frame.padding).toBe(80);
    s.undo();
    expect(useEditorStore.getState().frame.padding).toBe(20);
    s.redo();
    expect(useEditorStore.getState().frame.padding).toBe(80);
  });

  it("one undo step restores frame, crop, and annotations together", () => {
    const s = useEditorStore.getState();
    s.add(rect("a"));
    s.pushHistory(); // checkpoint: [a], crop null, default frame
    s.setFrame({ shadow: 90 });
    s.setCrop({ x: 0, y: 0, w: 10, h: 10 });
    s.add(rect("b"));
    s.undo();
    const st = useEditorStore.getState();
    expect(st.annotations.map((a) => a.id)).toEqual(["a"]);
    expect(st.crop).toBeNull();
    expect(st.frame.shadow).toBe(DEFAULT_FRAME.shadow);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd glint && npx vitest run src/editor/useEditorStore.test.ts`
Expected: FAIL — `undo restores frame changes` fails because `undo()` does not restore `frame` (padding stays 80 after undo).

- [ ] **Step 3: Extend the snapshot to carry frame**

In `glint/src/editor/useEditorStore.ts`:

(a) Change the `DocSnapshot` interface (currently around line 55):

```ts
/** One step of undo/redo history: annotations + the structural crop + the frame together. */
interface DocSnapshot { annotations: Annotation[]; crop: Crop | null; frame: FrameConfig }
```

(b) Add a `snapshot()` helper immediately after the `INITIAL` object (just before `export const useEditorStore = …`):

```ts
/** The full reversible doc state for one undo/redo step (annotations + crop + frame). */
const snapshot = (s: EditorState): DocSnapshot => ({
  annotations: s.annotations,
  crop: s.crop,
  frame: s.frame,
});
```

(c) Replace every existing snapshot literal `{ annotations: s.annotations, crop: s.crop }` with `snapshot(s)`. There are eight sites — in `duplicate`, `bringForward`, `sendBackward`, `nudge`, `pushHistory`, `clearAll`, `undo` (the `future:` push), and `redo` (the `past:` push). For example:

- `pushHistory`:
  ```ts
  pushHistory: () => set((s) => ({ past: [...s.past, snapshot(s)], future: [] })),
  ```
- `duplicate` / `bringForward` / `sendBackward` / `nudge` / `clearAll`: change their `past: [...s.past, { annotations: s.annotations, crop: s.crop }]` to `past: [...s.past, snapshot(s)]`.
- `undo`: change `future: [{ annotations: s.annotations, crop: s.crop }, ...s.future]` to `future: [snapshot(s), ...s.future]`.
- `redo`: change `past: [...s.past, { annotations: s.annotations, crop: s.crop }]` to `past: [...s.past, snapshot(s)]`.

The restore paths in `undo`/`redo` already spread the stored snapshot (`...s.past[s.past.length - 1]` and `...s.future[0]`), so once the snapshot includes `frame`, undo/redo restore it automatically — no change needed there.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd glint && npx vitest run src/editor/useEditorStore.test.ts`
Expected: PASS — both new tests green, and all pre-existing store tests still pass (in the older tests `frame` is default throughout, so it rides along unchanged).

- [ ] **Step 5: Commit**

```bash
git add glint/src/editor/useEditorStore.ts glint/src/editor/useEditorStore.test.ts
git commit -m "$(cat <<'EOF'
feat(editor): frame joins the undo/redo history snapshot

DocSnapshot now carries { annotations, crop, frame } behind a single
snapshot() helper, so undo/redo restore the frame alongside annotations
and crop. setFrame stays history-free (the UI checkpoints gestures).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XjyYSmzX6b1SHQeqJQiX9n
EOF
)"
```

---

### Task 2: Reset frame / Reset crop / Frame toggle become undoable (guarded)

**Files:**
- Modify: `glint/src/editor/useEditorStore.ts`
- Test: `glint/src/editor/useEditorStore.test.ts`

**Interfaces:**
- Consumes: `snapshot()` and the extended `DocSnapshot` from Task 1; existing `freshFrame()`.
- Produces: `resetFrame`, `resetCrop`, `toggleFrame` that push a guarded history checkpoint (no dead step on a no-op). Signatures unchanged: `resetFrame(): void`, `resetCrop(): void`, `toggleFrame(on?: boolean): void`.

- [ ] **Step 1: Write the failing tests**

Add these three tests inside the `describe("useEditorStore", …)` block (after the tests from Task 1):

```ts
  it("resetFrame is undoable and no-ops when already default", () => {
    const s = useEditorStore.getState();
    s.resetFrame(); // frame already default → records no history
    expect(useEditorStore.getState().past).toHaveLength(0);
    s.setFrame({ padding: 88 });
    s.resetFrame();
    expect(useEditorStore.getState().frame.padding).toBe(DEFAULT_FRAME.padding);
    s.undo();
    expect(useEditorStore.getState().frame.padding).toBe(88);
  });

  it("resetCrop is undoable and no-ops when there is no crop", () => {
    const s = useEditorStore.getState();
    s.resetCrop(); // crop already null → records no history
    expect(useEditorStore.getState().past).toHaveLength(0);
    s.setCrop({ x: 0, y: 0, w: 10, h: 10 });
    s.resetCrop();
    expect(useEditorStore.getState().crop).toBeNull();
    s.undo();
    expect(useEditorStore.getState().crop).toEqual({ x: 0, y: 0, w: 10, h: 10 });
  });

  it("toggleFrame is undoable", () => {
    const s = useEditorStore.getState();
    expect(useEditorStore.getState().frame.enabled).toBe(false);
    s.toggleFrame();
    expect(useEditorStore.getState().frame.enabled).toBe(true);
    s.undo();
    expect(useEditorStore.getState().frame.enabled).toBe(false);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd glint && npx vitest run src/editor/useEditorStore.test.ts`
Expected: FAIL — e.g. `resetFrame is undoable` fails because after `undo()` the padding is `DEFAULT_FRAME.padding`, not the restored `88` (resetFrame currently pushes no history).

- [ ] **Step 3: Add guarded checkpoints to the three methods**

In `glint/src/editor/useEditorStore.ts`, replace the existing `resetCrop`, `toggleFrame`, and `resetFrame` implementations with these:

```ts
  resetCrop: () =>
    set((s) => (s.crop === null ? s : { past: [...s.past, snapshot(s)], future: [], crop: null, dirty: true })),
```

```ts
  toggleFrame: (on) =>
    set((s) => {
      const enabled = on ?? !s.frame.enabled;
      if (enabled === s.frame.enabled) return s; // no-op → no dead undo step
      return { past: [...s.past, snapshot(s)], future: [], frame: { ...s.frame, enabled }, dirty: true };
    }),
```

```ts
  resetFrame: () =>
    set((s) => {
      const fresh = freshFrame();
      // Already default → no change and no dead undo step.
      if (JSON.stringify(s.frame) === JSON.stringify(fresh)) return s;
      return { past: [...s.past, snapshot(s)], future: [], frame: fresh, dirty: true };
    }),
```

Leave `setFrame` and `setChrome` unchanged (still history-free — the FramePanel checkpoints gestures in Task 3).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd glint && npx vitest run src/editor/useEditorStore.test.ts`
Expected: PASS — the three new tests green. The pre-existing `"setFrame merges, toggleFrame flips enabled, resetFrame restores defaults"` and `"frame changes do NOT push history"` tests still pass (they assert frame *values* and that `setFrame` specifically pushes nothing — both remain true).

- [ ] **Step 5: Commit**

```bash
git add glint/src/editor/useEditorStore.ts glint/src/editor/useEditorStore.test.ts
git commit -m "$(cat <<'EOF'
feat(editor): make Reset frame / Reset crop / Frame toggle undoable

Each now pushes a history checkpoint before mutating, guarded so an
already-default reset / already-null crop / no-op toggle records no
dead undo step.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XjyYSmzX6b1SHQeqJQiX9n
EOF
)"
```

---

### Task 3: FramePanel gesture checkpoints (one gesture = one undo step)

**Files:**
- Modify: `glint/src/views/editor/FramePanel.tsx`

**Interfaces:**
- Consumes: `pushHistory` from the store (via `useEditorStore((s) => s.pushHistory)`); the extended history from Tasks 1–2.
- Produces: no new exports. Behavior: each Frame control checkpoints once at the start of its gesture, so undo backs out one gesture at a time.

This task is a DOM/pointer interaction (not unit-testable in node) — verified by `tsc`, the existing vitest suite (regression), and at-screen. There is no failing-test step; the deliverable is the wired-up panel plus a green gate.

- [ ] **Step 1: Grab `pushHistory` in the component**

In `glint/src/views/editor/FramePanel.tsx`, inside `FramePanel()`, add alongside the other store selectors (after line 29, `const resetCrop = …`):

```ts
  const pushHistory = useEditorStore((s) => s.pushHistory);
```

Also update the component doc comment (lines 17–22) — replace the "Frame styling is live (not undoable)" sentence with:

```ts
/**
 * Right-docked frame controls: background type (solid/gradient/transparent),
 * the matching color/gradient picker, padding/radius/shadow sliders, an aspect
 * preset selector, and Reset affordances. Each control checkpoints history at the
 * start of its gesture (slider pointer-down, discrete click, text focus) so undo
 * backs out one gesture at a time; crop is reset here too.
 */
```

- [ ] **Step 2: Checkpoint the three sliders on pointer-down**

Update the local `Slider` component (lines 253–272) to accept and wire an `onPointerDown`, then pass `pushHistory` to each frame slider.

Change the `Slider` signature + input:

```tsx
function Slider({
  label,
  value,
  min = 0,
  max = 100,
  onChange,
  onPointerDown,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
  onPointerDown?: () => void;
}) {
  return (
    <label className="frame-slider">
      <span className="frame-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onPointerDown={onPointerDown}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
      />
    </label>
  );
}
```

Then update the three slider usages (lines 178–180):

```tsx
      <Slider label="Padding" value={frame.padding} onPointerDown={pushHistory} onChange={(v) => setFrame({ padding: v })} />
      <Slider label="Radius" value={frame.radius} onPointerDown={pushHistory} onChange={(v) => setFrame({ radius: v })} />
      <Slider label="Shadow" value={frame.shadow} onPointerDown={pushHistory} onChange={(v) => setFrame({ shadow: v })} />
```

- [ ] **Step 3: Checkpoint the discrete background/chrome/aspect controls**

Wrap each discrete control's mutation with a `pushHistory()` at the start of the gesture, guarded so re-selecting the current value records nothing.

(a) Background type segmented buttons (lines 41–58) — checkpoint only when switching type:

```tsx
          {(["solid", "gradient", "transparent"] as const).map((t) => (
            <button
              key={t}
              className={`frame-seg-btn${bg.type === t ? " is-active" : ""}`}
              onClick={() => {
                if (bg.type !== t) pushHistory();
                setFrame({
                  background:
                    t === "solid"
                      ? { type: "solid", color: BG_SOLIDS[0] }
                      : t === "gradient"
                        ? { type: "gradient", gradientId: GRADIENTS[0].id }
                        : { type: "transparent" },
                });
              }}
            >
              {t}
            </button>
          ))}
```

(b) Solid swatches (lines 64–73) — checkpoint only when the color actually changes:

```tsx
          {BG_SOLIDS.map((c) => (
            <button
              key={c}
              className={`editor-swatch${bg.color.toLowerCase() === c.toLowerCase() ? " editor-swatch--active" : ""}`}
              style={{ background: c }}
              title={c}
              aria-label={`Background ${c}`}
              onClick={() => {
                if (bg.color.toLowerCase() !== c.toLowerCase()) pushHistory();
                setFrame({ background: { type: "solid", color: c } });
              }}
            />
          ))}
```

(c) Custom color `<label>` (lines 74–81) — checkpoint at the start of interaction (pointer-down opens the OS picker; the value arrives later via `onChange`):

```tsx
          <label
            className="editor-swatch editor-swatch--custom"
            style={{ background: bg.color }}
            title="Custom color"
            onPointerDown={() => pushHistory()}
          >
            <input
              type="color"
              value={bg.color}
              onChange={(e) => setFrame({ background: { type: "solid", color: e.currentTarget.value } })}
              aria-label="Custom background color"
            />
          </label>
```

(d) Gradient swatches (lines 87–96) — checkpoint only when the gradient changes:

```tsx
          {GRADIENTS.map((g) => (
            <button
              key={g.id}
              title={g.label}
              aria-label={g.label}
              className={`frame-grad${bg.gradientId === g.id ? " is-active" : ""}`}
              style={{ background: `linear-gradient(135deg, ${g.stops[0].color}, ${g.stops[g.stops.length - 1].color})` }}
              onClick={() => {
                if (bg.gradientId !== g.id) pushHistory();
                setFrame({ background: { type: "gradient", gradientId: g.id } });
              }}
            />
          ))}
```

(e) Window style buttons (lines 103–111) — checkpoint only when the style changes:

```tsx
          {(["none", "window", "browser"] as const).map((st) => (
            <button
              key={st}
              className={`frame-seg-btn${chrome.style === st ? " is-active" : ""}`}
              onClick={() => {
                if (chrome.style !== st) pushHistory();
                setChrome({ style: st });
              }}
            >
              {st}
            </button>
          ))}
```

(f) Theme buttons (lines 120–128):

```tsx
              {(["light", "dark"] as const).map((th) => (
                <button
                  key={th}
                  className={`frame-seg-btn${chrome.theme === th ? " is-active" : ""}`}
                  onClick={() => {
                    if (chrome.theme !== th) pushHistory();
                    setChrome({ theme: th });
                  }}
                >
                  {th}
                </button>
              ))}
```

(g) Buttons cluster (lines 135–144):

```tsx
              {([["none", "None"], ["mac", "macOS"], ["windows", "Windows"]] as const).map(([val, label]) => (
                <button
                  key={val}
                  className={`frame-seg-btn${chrome.buttons === val ? " is-active" : ""}`}
                  style={{ textTransform: "none" }}
                  onClick={() => {
                    if (chrome.buttons !== val) pushHistory();
                    setChrome({ buttons: val });
                  }}
                >
                  {label}
                </button>
              ))}
```

(h) Aspect buttons (lines 188–196):

```tsx
          {ASPECTS.map((a) => (
            <button
              key={a}
              className={`frame-seg-btn${frame.aspect === a ? " is-active" : ""}`}
              onClick={() => {
                if (frame.aspect !== a) pushHistory();
                setFrame({ aspect: a });
              }}
            >
              {a}
            </button>
          ))}
```

- [ ] **Step 4: Checkpoint the Title / URL text fields on focus**

One undo step per editing session (not per keystroke). Add `onFocus={() => pushHistory()}` to both inputs.

Title input (lines 151–158):

```tsx
              <input
                className="frame-input"
                type="text"
                value={chrome.title}
                placeholder="Window title"
                onFocus={() => pushHistory()}
                onChange={(e) => setChrome({ title: e.currentTarget.value })}
                aria-label="Window title"
              />
```

URL input (lines 165–172):

```tsx
              <input
                className="frame-input"
                type="text"
                value={chrome.url}
                placeholder="example.com"
                onFocus={() => pushHistory()}
                onChange={(e) => setChrome({ url: e.currentTarget.value })}
                aria-label="Address bar URL"
              />
```

(The Reset frame / Reset crop buttons need no change — the checkpoint moved into the store in Task 2.)

- [ ] **Step 5: Typecheck and run the full suite**

Run: `cd glint && npx tsc --noEmit && npx vitest run`
Expected: `tsc` clean; all vitest tests pass (the new store tests from Tasks 1–2 plus the existing suite — a regression check that the FramePanel changes didn't break the store contract).

- [ ] **Step 6: Commit**

```bash
git add glint/src/views/editor/FramePanel.tsx
git commit -m "$(cat <<'EOF'
feat(editor): checkpoint Frame gestures for undo (one gesture = one step)

FramePanel now pushes one history checkpoint at the start of each
gesture — slider pointer-down, discrete background/chrome/aspect click
(guarded against no-ops), and title/URL focus — so undo backs out a
whole frame adjustment at a time instead of nothing.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XjyYSmzX6b1SHQeqJQiX9n
EOF
)"
```

---

## At-screen acceptance (before `--no-ff` merge)

Manual checks in the running editor (user drives; dev server already running):

1. Enable Frame, drag **Radius** 12→full, press **Ctrl+Z** → the drag reverts in one step; **Ctrl+Shift+Z** re-applies.
2. Change **background** (Solid→Gradient), pick a gradient, switch **Window**→Browser, type a URL — each Ctrl+Z peels back one gesture.
3. Click **Reset frame** → Ctrl+Z restores the tweaked frame; click **Reset crop** (after a crop) → Ctrl+Z restores the crop.
4. Toggle the **Frame** header button off → Ctrl+Z brings the frame back.
5. Undo/redo via the ↶ ↷ tool-rail buttons behaves identically to the keyboard.
```
