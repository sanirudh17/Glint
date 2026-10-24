import {useEffect,useRef,type ReactNode} from "react";
import { ChevronDown } from "lucide-react";
import "./ui.css";

export function ControlDisclosure({ title, children, className = "",openByDefault=false }: { title: string; children: ReactNode; className?: string;openByDefault?:boolean }) {
  const ref=useRef<HTMLDetailsElement>(null);useEffect(()=>{if(openByDefault&&ref.current)ref.current.open=true;},[openByDefault]);
  return <details ref={ref} className={`g-control-disclosure ${className}`} data-editor-control>
    <summary><span>{title}</span><ChevronDown size={14} strokeWidth={1.6} aria-hidden /></summary>
    <div className="g-control-disclosure-body">{children}</div>
  </details>;
}
