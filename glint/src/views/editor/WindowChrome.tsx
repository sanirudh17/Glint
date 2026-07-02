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

/** Three-segment polyline tracing a padlock shackle (an inverted U) above the body. */
function lockShacklePoints(lockX: number, pillY: number, pillH: number, lockSize: number): number[] {
  const cx = lockX + lockSize / 2;
  const bodyTop = pillY + Math.round(pillH * 0.5) - Math.round(lockSize * 0.15);
  const topY = bodyTop - Math.round(lockSize * 0.32);
  const halfW = Math.round(lockSize * 0.26);
  return [cx - halfW, bodyTop, cx - halfW, topY, cx + halfW, topY, cx + halfW, bodyTop];
}
