import { Group, Rect, Text, Line, Circle } from "react-konva";

interface Props {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
  style: "window" | "browser";
  theme: "light" | "dark";
  buttons: "none" | "mac" | "windows";
  title: string;
  url: string;
}

const SANS = "system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
const MAC_COLORS = ["#ff5f57", "#febc2e", "#28c840"];

/**
 * Konva painter for the OS-neutral window chrome band that sits above the
 * screenshot inside the framed card. Purely decorative (listening=false); never
 * clickable. "window" → centered title; "browser" → back/forward/reload glyphs +
 * a lock + URL address pill. Optional window-control buttons: macOS traffic
 * lights (left) or Windows caption buttons (right). Top corners round to match
 * the card; the bottom edge butts flat against the image.
 */
export function WindowChrome({ x, y, width, height, radius, style, theme, buttons, title, url }: Props) {
  const dark = theme === "dark";
  // Light bar is a touch grey (not near-white) so a white browser pill stands out.
  const barFill = dark ? "#2b2b2b" : "#e8e8ea";
  const textColor = dark ? "#e6e6e6" : "#3c3c3c";
  const dividerColor = dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.10)";
  const pad = Math.round(height * 0.28);
  const font = Math.max(9, Math.round(height * 0.36));
  const topRounded = [radius, radius, 0, 0];

  // macOS traffic-light dots (left cluster).
  const dotR = Math.max(3, Math.round(height * 0.09));
  const dotGap = Math.round(height * 0.26);
  const dotX0 = Math.round(height * 0.45);
  const macW = dotX0 + dotGap * 2 + dotR + Math.round(height * 0.2); // cluster right edge + pad
  // Windows caption buttons (right cluster).
  const btnCell = Math.round(height * 0.92);
  const winW = btnCell * 3;

  // Content (title / browser bits) is inset past whichever button cluster is present.
  const leftInset = pad + (buttons === "mac" ? macW : 0);
  const rightInset = pad + (buttons === "windows" ? winW : 0);

  return (
    <Group x={x} y={y} listening={false}>
      <Rect x={0} y={0} width={width} height={height} fill={barFill} cornerRadius={topRounded} />
      <Line points={[0, height - 0.5, width, height - 0.5]} stroke={dividerColor} strokeWidth={1} />

      {buttons === "mac" &&
        MAC_COLORS.map((c, i) => (
          <Circle
            key={c}
            x={dotX0 + i * dotGap}
            y={Math.round(height / 2)}
            radius={dotR}
            fill={c}
            stroke="rgba(0,0,0,0.12)"
            strokeWidth={Math.max(0.5, dotR * 0.12)}
          />
        ))}

      {buttons === "windows" && renderWinButtons({ width, height, btnCell, textColor })}

      {style === "window" && title.trim() !== "" && (
        <Text
          x={leftInset}
          y={0}
          width={Math.max(0, width - leftInset - rightInset)}
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

      {style === "browser" &&
        renderBrowser({ width, height, pad, font, textColor, dark, url, leftInset, rightInset })}
    </Group>
  );
}

/** Windows caption buttons — minimize / maximize / close glyphs at the right. */
function renderWinButtons({
  width, height, btnCell, textColor,
}: {
  width: number; height: number; btnCell: number; textColor: string;
}) {
  const glyphs = ["—", "□", "✕"];
  const startX = width - btnCell * 3;
  const gfont = Math.max(8, Math.round(height * 0.3));
  return (
    <Group>
      {glyphs.map((g, i) => (
        <Text
          key={g}
          x={startX + i * btnCell}
          y={0}
          width={btnCell}
          height={height}
          text={g}
          fontFamily={SANS}
          fontSize={gfont}
          fill={textColor}
          align="center"
          verticalAlign="middle"
          wrap="none"
        />
      ))}
    </Group>
  );
}

function renderBrowser({
  width, height, pad, font, textColor, dark, url, leftInset, rightInset,
}: {
  width: number; height: number; pad: number; font: number; textColor: string;
  dark: boolean; url: string; leftInset: number; rightInset: number;
}) {
  const navFont = Math.round(font * 1.15);
  const navGap = Math.round(height * 0.42);
  const navX = leftInset;
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
  const pillRight = width - rightInset;
  const pillW = Math.max(0, pillRight - pillX);
  const pillFill = dark ? "#1e1e1e" : "#ffffff";
  // A visible border so the pill doesn't merge into the bar (light theme especially).
  const pillStroke = dark ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.18)";
  const lockSize = Math.round(pillH * 0.5);
  const lockX = pillX + Math.round(pillH * 0.32);
  const urlX = lockX + lockSize + Math.round(pillH * 0.18);
  const urlW = Math.max(0, pillX + pillW - urlX - Math.round(pillH * 0.3));

  return (
    <Group>
      {navCells}
      <Rect
        x={pillX}
        y={pillY}
        width={pillW}
        height={pillH}
        fill={pillFill}
        stroke={pillStroke}
        strokeWidth={1}
        cornerRadius={pillH / 2}
      />
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

/** Three-segment polyline tracing a padlock shackle (an inverted U) above the body. */
function lockShacklePoints(lockX: number, pillY: number, pillH: number, lockSize: number): number[] {
  const cx = lockX + lockSize / 2;
  const bodyTop = pillY + Math.round(pillH * 0.5) - Math.round(lockSize * 0.15);
  const topY = bodyTop - Math.round(lockSize * 0.32);
  const halfW = Math.round(lockSize * 0.26);
  return [cx - halfW, bodyTop, cx - halfW, topY, cx + halfW, topY, cx + halfW, bodyTop];
}
