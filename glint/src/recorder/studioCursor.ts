import type { CursorConfig, InputEvent, StudioEvents } from "./studioModel";
import type { Layout } from "../editor/composition";
export interface CursorPoint { t: number; x: number; y: number; movedAt: number }
/** Time-based follower; independent of event rate, pause length or preview FPS. */
export function smoothPath(events: InputEvent[], intensity: number): CursorPoint[] {
  const points = events.filter((e) => e.kind === "cursor" && Number.isFinite(e.x) && Number.isFinite(e.y)).sort((a, b) => a.t - b.t);
  let x = points[0]?.x ?? 0, y = points[0]?.y ?? 0, movedAt = points[0]?.t ?? 0;
  return points.map((p, i) => {
    const prev = points[i - 1];
    if (prev && (Math.abs(p.x! - prev.x!) > .75 || Math.abs(p.y! - prev.y!) > .75)) movedAt = p.t;
    const dt = Math.max(0, p.t - (prev?.t ?? p.t));
    const alpha = intensity <= 0 || !prev ? 1 : 1 - Math.exp(-dt / (.02 + .18 * intensity));
    x += (p.x! - x) * alpha; y += (p.y! - y) * alpha;
    return { t: p.t, x, y, movedAt };
  });
}
export function cursorAt(path: CursorPoint[], t: number): CursorPoint | null {
  if (!path.length) return null;
  let lo = 0, hi = path.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (path[mid].t <= t) lo = mid + 1; else hi = mid; }
  const a = path[Math.max(0, lo - 1)], b = path[Math.min(path.length - 1, lo)];
  const f = b.t > a.t ? Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t))) : 0;
  return { t, x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, movedAt: a.movedAt };
}
/** A zoom mark is activity even when the pointer has been stationary. */
export function cursorForFrame(path:CursorPoint[],t:number,events:StudioEvents):CursorPoint|null {
  const point=cursorAt(path,t),marker=[...events.events].reverse().find(e=>e.kind==='marker'&&e.t<=t&&t-e.t<1.1);
  if(!marker)return point;
  const g=events.geometry,inside=point&&point.x>=g.x&&point.x<g.x+g.width&&point.y>=g.y&&point.y<g.y+g.height;
  return {t,x:inside?point.x:Math.max(g.x,Math.min(g.x+g.width-1,marker.x??g.x+g.width/2)),y:inside?point.y:Math.max(g.y,Math.min(g.y+g.height-1,marker.y??g.y+g.height/2)),movedAt:Math.max(point?.movedAt??0,marker.t)};
}
export function sourcePoint(x: number, y: number, events: StudioEvents, width: number, height: number) {
  const g = events.geometry;
  return { x: (x - g.x) * width / g.width, y: (y - g.y) * height / g.height };
}
export function followSourcePoint(path: CursorPoint[], t:number, events:StudioEvents, width:number, height:number) {
  const positions = Array.from({length:5},(_,i)=>cursorAt(path,Math.max(0,t-i*.035))).filter(p=>p!==null);
  if(!positions.length)return null;
  const latest=sourcePoint(positions[0].x,positions[0].y,events,width,height);
  return {...sourcePoint(positions.reduce((sum,p)=>sum+p.x,0)/positions.length,positions.reduce((sum,p)=>sum+p.y,0)/positions.length,events,width,height),latestX:latest.x,latestY:latest.y};
}
export function recordedCursor(config:CursorConfig,events:StudioEvents,time:number):CursorConfig {
  if(config.recordedEffects===false)return config;
  for(let i=events.events.length-1;i>=0;i--){const event=events.events[i];if(event.kind==='effects'&&event.t<=time)return {...config,clicks:config.clicks&&event.clicks!==false,keystrokes:config.keystrokes&&event.keystrokes!==false,spotlight:!!config.spotlight&&event.spotlight!==false};}
  return config;
}
export function drawCursorLayer(ctx: CanvasRenderingContext2D, t: number, path: CursorPoint[], events: StudioEvents, config: CursorConfig, layout: Layout, width: number, height: number) {
  config=recordedCursor(config,events,t);
  const l = layout;
  const inside = (p: { x: number; y: number }) => p.x >= l.cropX && p.x < l.cropX + l.contentW && p.y >= l.cropY && p.y < l.cropY + l.contentH;
  const xy = (x: number, y: number) => { const p = sourcePoint(x, y, events, width, height); return { ...p, outX: l.contentX + p.x - l.cropX, outY: l.contentY + p.y - l.cropY }; };
  ctx.save(); ctx.beginPath(); ctx.rect(l.contentX, l.contentY, l.contentW, l.contentH); ctx.clip();
  const point = cursorForFrame(path, t,events);
  if(point&&config.spotlight){const p=xy(point.x,point.y);if(inside(p)){ctx.save();ctx.fillStyle='rgba(255,235,160,.22)';ctx.beginPath();ctx.arc(p.outX,p.outY,48,0,Math.PI*2);ctx.fill();ctx.restore();}}
  if (point && config.visible && (!config.hideIdle || t - point.movedAt < config.idleSeconds)) {
    const p = xy(point.x, point.y);
    if (inside(p)) {
      ctx.save(); ctx.translate(p.outX, p.outY); ctx.fillStyle = "#ffffff"; ctx.strokeStyle = "#171a20"; ctx.lineWidth = Math.max(1, config.size / 16);
      ctx.beginPath();
      if (config.style === "dot") ctx.arc(0, 0, config.size / 4, 0, Math.PI * 2);
      else { const s = config.size; ctx.moveTo(0, 0); ctx.lineTo(0, s); ctx.lineTo(s * .24, s * .74); ctx.lineTo(s * .42, s * 1.08); ctx.lineTo(s * .6, s * .98); ctx.lineTo(s * .4, s * .65); ctx.lineTo(s * .76, s * .65); ctx.closePath(); }
      ctx.fill(); ctx.stroke(); ctx.restore();
    }
  }
  if (config.clicks) for (const event of events.events) {
    const age = t - event.t;
    if (event.kind !== "click" || age < 0 || age > .45) continue;
    const p = xy(event.x!, event.y!); if (!inside(p)) continue;
    ctx.globalAlpha = 1 - age / .45; ctx.beginPath(); ctx.arc(p.outX, p.outY, config.clickSize * (.3 + age / .45 * .7), 0, Math.PI * 2); ctx.strokeStyle = event.button === "right" ? "#ffb660" : "#4faeff"; ctx.lineWidth = 3; ctx.stroke();
  }
  ctx.globalAlpha = 1;
  if (config.keystrokes) {
    const event = [...events.events].reverse().find((e) => e.kind === "key" && e.down && !e.isModifier && e.t <= t && t - e.t < .9);
    if (event) {
      const text = [...(event.modifiers ?? []), event.text ?? ""].join(" + ");
      ctx.font = "24px sans-serif"; const w = Math.min(l.contentW - 24, ctx.measureText(text).width + 32), x = l.contentX + (l.contentW - w) / 2, y = l.contentY + l.contentH - 64;
      ctx.fillStyle = "#171a20"; ctx.beginPath(); ctx.roundRect(x, y, w, 42, 8); ctx.fill(); ctx.fillStyle = "#ffffff"; ctx.textAlign = "center"; ctx.fillText(text, x + w / 2, y + 29, w - 16);
    }
  }
  ctx.restore();
}
