/**
 * icons — Glint's single icon source: Hugeicons free "Stroke Rounded" set.
 * Each export keeps the familiar component name used across the app, so call
 * sites keep their stable sizes (16px / 1.5 stroke) while the glyphs come
 * from one consistent premium family.
 */
import { forwardRef, type FunctionComponent, type SVGProps } from "react";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import * as H from "@hugeicons/core-free-icons";

export type IconProps = Omit<SVGProps<SVGSVGElement>, "ref"> & {
  size?: number;
  strokeWidth?: number;
  color?: string;
};
export type IconComponent = FunctionComponent<IconProps>;
/** Kept so existing `icon: LucideIcon` prop types keep compiling. */
export type LucideIcon = IconComponent;

function make(glyph: IconSvgElement, name: string): IconComponent {
  const C = forwardRef<SVGSVGElement, IconProps>(({ size = 24, strokeWidth = 1.5, color, stroke, className, ...rest }, ref) => (
    <HugeiconsIcon
      ref={ref}
      icon={glyph}
      size={size}
      strokeWidth={strokeWidth}
      color={color ?? (typeof stroke === "string" ? stroke : "currentColor")}
      className={className ? `g-icon ${className}` : "g-icon"}
      aria-hidden={rest["aria-label"] ? undefined : true}
      focusable={false}
      {...rest}
    />
  ));
  C.displayName = name;
  return C as unknown as IconComponent;
}

export const AlertCircle = make(H.AlertCircleIcon, "AlertCircle");
export const AppWindow = make(H.BrowserIcon, "AppWindow");
export const ArrowDown = make(H.ArrowDown01Icon, "ArrowDown");
export const ArrowLeftRight = make(H.ArrowDataTransferHorizontalIcon, "ArrowLeftRight");
export const ArrowRight = make(H.ArrowRight02Icon, "ArrowRight");
export const ArrowUp = make(H.ArrowUp01Icon, "ArrowUp");
export const ArrowUpCircle = make(H.CircleArrowUp01Icon, "ArrowUpCircle");
export const ArrowUpRight = make(H.ArrowUpRight01Icon, "ArrowUpRight");
export const Check = make(H.Tick02Icon, "Check");
export const CheckCheck = make(H.TickDouble02Icon, "CheckCheck");
export const ChevronDown = make(H.ArrowDown01Icon, "ChevronDown");
export const ChevronRight = make(H.ArrowRight01Icon, "ChevronRight");
export const ChevronsLeft = make(H.ArrowLeftDoubleIcon, "ChevronsLeft");
export const ChevronsRight = make(H.ArrowRightDoubleIcon, "ChevronsRight");
export const ChevronUp = make(H.ArrowUp01Icon, "ChevronUp");
export const Circle = make(H.CircleIcon, "Circle");
export const CircleSlash = make(H.UnavailableIcon, "CircleSlash");
export const Copy = make(H.Copy01Icon, "Copy");
export const Crop = make(H.CropIcon, "Crop");
export const Crosshair = make(H.Target02Icon, "Crosshair");
export const Download = make(H.Download04Icon, "Download");
export const Droplet = make(H.DropletIcon, "Droplet");
export const Eraser = make(H.EraserIcon, "Eraser");
export const ExternalLink = make(H.LinkSquare02Icon, "ExternalLink");
export const EyeOff = make(H.ViewOffSlashIcon, "EyeOff");
export const FileText = make(H.File01Icon, "FileText");
export const Focus = make(H.CenterFocusIcon, "Focus");
export const FolderOpen = make(H.Folder03Icon, "FolderOpen");
export const Frame = make(H.FrameIcon, "Frame");
export const GripVertical = make(H.DragDropVerticalIcon, "GripVertical");
export const HardDrive = make(H.HardDriveIcon, "HardDrive");
export const Hash = make(H.GridIcon, "Hash");
export const Highlighter = make(H.HighlighterIcon, "Highlighter");
export const Home = make(H.Home01Icon, "Home");
export const Image = make(H.Image01Icon, "Image");
export const ImageOff = make(H.ImageNotFound01Icon, "ImageOff");
export const ImagePlus = make(H.ImageAdd01Icon, "ImagePlus");
export const Images = make(H.Album02Icon, "Images");
export const Keyboard = make(H.CommandIcon, "Keyboard"); // free set's keyboard glyph reads as a face at 16px
export const Link2 = make(H.Link01Icon, "Link2");
export const Lock = make(H.SquareLock02Icon, "Lock");
export const Maximize2 = make(H.ArrowExpand01Icon, "Maximize2");
export const Mic = make(H.Mic01Icon, "Mic");
export const MicOff = make(H.MicOff01Icon, "MicOff");
export const Minus = make(H.MinusSignIcon, "Minus");
export const Monitor = make(H.ComputerIcon, "Monitor");
export const MousePointer2 = make(H.Cursor02Icon, "MousePointer2");
export const MousePointerClick = make(H.CursorPointer02Icon, "MousePointerClick");
export const Move = make(H.ArrowAllDirectionIcon, "Move");
export const MoveUpRight = make(H.ArrowUpRight01Icon, "MoveUpRight");
export const MoveVertical = make(H.ArrowUpDownIcon, "MoveVertical");
export const Palette = make(H.PaintBoardIcon, "Palette");
export const Pause = make(H.PauseIcon, "Pause");
export const Pen = make(H.PenTool01Icon, "Pen");
export const Pencil = make(H.Edit02Icon, "Pencil");
export const Pin = make(H.PinIcon, "Pin");
export const Pipette = make(H.ColorPickerIcon, "Pipette");
export const Play = make(H.PlayIcon, "Play");
export const Plus = make(H.PlusSignIcon, "Plus");
export const RectangleHorizontal = make(H.RectangularIcon, "RectangleHorizontal");
export const Redo2 = make(H.Redo03Icon, "Redo2");
export const RefreshCw = make(H.RefreshIcon, "RefreshCw");
export const RotateCcw = make(H.Undo02Icon, "RotateCcw");
export const Save = make(H.SaveIcon, "Save");
export const ScanLine = make(H.ScanIcon, "ScanLine");
export const ScanText = make(H.ScanTextIcon, "ScanText");
export const Scissors = make(H.ScissorIcon, "Scissors");
export const Search = make(H.Search01Icon, "Search");
export const SearchX = make(H.SearchRemoveIcon, "SearchX");
export const Settings = make(H.Settings01Icon, "Settings");
export const Shapes = make(H.ShapesIcon, "Shapes");
export const Share2 = make(H.Share08Icon, "Share2");
export const SkipBack = make(H.PreviousIcon, "SkipBack");
export const SlidersHorizontal = make(H.SlidersHorizontalIcon, "SlidersHorizontal");
export const Square = make(H.StopIcon, "Square");
export const SquareRoundCorner = make(H.SquareIcon, "SquareRoundCorner");
export const Sun = make(H.Sun03Icon, "Sun");
export const Tag = make(H.InputTextIcon, "Tag");
export const Trash2 = make(H.Delete02Icon, "Trash2");
export const Type = make(H.TextIcon, "Type");
export const Undo2 = make(H.Undo03Icon, "Undo2");
export const Video = make(H.Video01Icon, "Video");
export const VideoOff = make(H.VideoOffIcon, "VideoOff");
export const Volume2 = make(H.VolumeHighIcon, "Volume2");
export const VolumeX = make(H.VolumeOffIcon, "VolumeX");
export const WandSparkles = make(H.MagicWand01Icon, "WandSparkles");
export const X = make(H.Cancel01Icon, "X");
export const ZoomIn = make(H.ZoomInIcon, "ZoomIn");
export const ZoomOut = make(H.ZoomOutIcon, "ZoomOut");
export const FileClock = make(H.PencilEdit02Icon, "FileClock"); // Resume project: "continue editing"
export const Spotlight = make(H.SpotlightIcon, "Spotlight");
