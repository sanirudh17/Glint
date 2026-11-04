import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { LucideIcon } from "lucide-react";
import { cssTimeMs } from "../../lib/cssTime";

export interface CaptureAction {
  label: string;
  icon: LucideIcon;
  danger?: boolean;
  run: () => void | Promise<void>;
}

export function CaptureMenu({ x, y, title, groups, onClose }: {
  x: number; y: number; title: string; groups: CaptureAction[][]; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const opener = useRef(document.activeElement);
  const [closing, setClosing] = useState(false);
  const restoreFocus = useRef(false);
  const close = useCallback(() => { setClosing(true); }, []);
  useEffect(() => {
    if (!closing) return;
    const duration = matchMedia("(prefers-reduced-motion: reduce)").matches ? 0
      : cssTimeMs(getComputedStyle(document.documentElement).getPropertyValue("--dropdown-close-dur"), 150);
    const timer = setTimeout(() => {
      onClose();
      if (restoreFocus.current && opener.current instanceof HTMLElement) opener.current.focus({preventScroll:true});
    }, duration);
    return () => clearTimeout(timer);
  }, [closing, onClose]);
  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - rect.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))}px`;
    menu.querySelector<HTMLButtonElement>("button")?.focus();
  }, [x, y]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !ref.current?.contains(event.target)) close();
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Tab") { if (event.key === "Escape") event.preventDefault(); restoreFocus.current=true; close(); }
    };
    const scroll = (event: Event) => {
      if (event.target instanceof Node && !ref.current?.contains(event.target)) close();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    document.addEventListener("scroll", scroll, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      document.removeEventListener("scroll", scroll, true);
    };
  }, [close]);
  function navigate(event: KeyboardEvent) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const buttons = Array.from(ref.current?.querySelectorAll("button") ?? []);
    const current = buttons.findIndex(button => button === document.activeElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
      : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }
  return createPortal(<div ref={ref} className={`capture-menu t-dropdown ${closing ? "is-closing" : "is-open"}`} role="menu"
    aria-label="Capture actions" data-origin="top-left" style={{ left: x, top: y }}
    onKeyDown={navigate} onContextMenu={event => event.preventDefault()}>
    <div className="capture-menu-title">{title}</div>
    {groups.map((group, index) => <div key={index} className="capture-menu-group" role="group">
      {group.map(({ label, icon: Icon, danger, run }) => <button type="button" role="menuitem"
        key={label} className={danger ? "is-danger" : undefined}
        onClick={() => { close(); void run(); }}>
        <Icon size={16} strokeWidth={1.5} aria-hidden /><span>{label}</span>
      </button>)}
    </div>)}
  </div>, document.body);
}
