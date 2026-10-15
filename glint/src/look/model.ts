import { GRADIENTS } from "../editor/gradients";

export type AspectId = "auto" | "1:1" | "16:9" | "4:3" | "9:16" | "4:5" | "3:2" | "1.91:1";
export type LookBackground =
  | { type: "solid"; color: string }
  | { type: "gradient"; gradientId: string; angleDeg?: number; kind?: "linear" | "radial" | "conic" | "mesh"; stops?: { offset: number; color: string }[]; grain?: number }
  | { type: "image"; dataUrl: string }
  | { type: "transparent" };
export interface WindowChrome {
  style: "none" | "window" | "browser";
  theme: "light" | "dark";
  buttons: "none" | "mac" | "windows";
  title: string;
  url: string;
}
/** The serialized look shared by screenshots, Studio projects and named presets.
 * Optional additions preserve existing .glint documents without a migration. */
export interface LookConfig {
  enabled: boolean;
  background: LookBackground;
  padding: number;
  radius: number;
  shadow: number;
  shadowColor?: string;
  border?: { width: number; color: string; style: "solid" | "dashed" };
  aspect: AspectId;
  outputSize?: { width:number; height:number };
  watermark?: { text:string; color:string; opacity:number; size?:number; position:"bottom-left"|"bottom-right"; dataUrl:string; width:number; height:number };
  chrome: WindowChrome;
}
export const DEFAULT_LOOK: LookConfig = {
  enabled: false, background: { type: "gradient", gradientId: GRADIENTS[0].id },
  padding: 40, radius: 12, shadow: 35, aspect: "auto",
  chrome: { style: "none", theme: "light", buttons: "mac", title: "", url: "" },
};
export const cloneLook = (look: LookConfig): LookConfig => structuredClone(look);
export function hydrateLook(look?: Partial<LookConfig>): LookConfig {
  return cloneLook({ ...DEFAULT_LOOK, ...look,
    chrome: { ...DEFAULT_LOOK.chrome, ...look?.chrome },
  });
}
