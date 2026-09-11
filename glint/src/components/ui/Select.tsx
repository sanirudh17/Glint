import { useState, useRef, useEffect, useId } from "react";
import { ChevronDown, Check } from "lucide-react";
import "./ui.css";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  /** Accessible name for the underlying select control when there's no visible <label for>. */
  ariaLabel?: string;
  /** When true, the control is inert and styled as unavailable. */
  disabled?: boolean;
  className?: string;
}

export function Select({
  value,
  options,
  onChange,
  ariaLabel,
  disabled = false,
  className = "",
}: SelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [placement, setPlacement] = useState<"bottom" | "top">("bottom");
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  const selectedOption = options.find((o) => o.value === value) ?? options[0];

  // Close when clicking outside or when window loses focus
  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleWindowBlur = () => {
      setIsOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    window.addEventListener("blur", handleWindowBlur);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [isOpen]);

  // Keep highlighted option scrolled into view
  useEffect(() => {
    if (isOpen && highlightedIndex >= 0 && listRef.current) {
      const item = listRef.current.children[highlightedIndex] as HTMLElement | undefined;
      item?.scrollIntoView({ block: "nearest" });
    }
  }, [isOpen, highlightedIndex]);

  const handleOpen = () => {
    if (disabled) return;

    // Detect if trigger is near viewport bottom and flip open upwards if needed
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      if (spaceBelow < 200 && rect.top > 200) {
        setPlacement("top");
      } else {
        setPlacement("bottom");
      }
    }

    const currentIndex = options.findIndex((o) => o.value === value);
    setHighlightedIndex(currentIndex >= 0 ? currentIndex : 0);
    setIsOpen(true);
  };

  const handleToggle = () => {
    if (disabled) return;
    if (isOpen) {
      setIsOpen(false);
    } else {
      handleOpen();
    }
  };

  const handleSelect = (val: string) => {
    onChange(val);
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;

    if (!isOpen) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        handleOpen();
      }
      return;
    }

    switch (e.key) {
      case "Escape":
      case "Tab":
        e.preventDefault();
        setIsOpen(false);
        triggerRef.current?.focus();
        break;
      case "ArrowDown": {
        e.preventDefault();
        setHighlightedIndex((prev) => (prev < options.length - 1 ? prev + 1 : 0));
        break;
      }
      case "ArrowUp": {
        e.preventDefault();
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : options.length - 1));
        break;
      }
      case "Enter":
      case " ": {
        e.preventDefault();
        if (highlightedIndex >= 0 && highlightedIndex < options.length) {
          handleSelect(options[highlightedIndex].value);
        }
        break;
      }
    }
  };

  return (
    <div
      ref={wrapRef}
      className={`g-select-wrap ${isOpen ? "g-select-wrap--open" : ""} ${disabled ? "g-select-wrap--disabled" : ""} ${className}`.trim()}
      onKeyDown={handleKeyDown}
    >
      <button
        ref={triggerRef}
        type="button"
        className="g-select-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listId : undefined}
        disabled={disabled}
        onClick={handleToggle}
      >
        <span className="g-select-value">{selectedOption?.label ?? ""}</span>
        <span className="g-select-chevron" aria-hidden="true">
          <ChevronDown size={14} strokeWidth={1.5} />
        </span>
      </button>

      {isOpen && (
        <div
          ref={listRef}
          id={listId}
          className={`g-select-dropdown ${placement === "top" ? "g-select-dropdown--top" : ""}`}
          role="listbox"
          aria-label={ariaLabel}
        >
          {options.map((opt, index) => {
            const isSelected = opt.value === value;
            const isHighlighted = index === highlightedIndex;
            return (
              <div
                key={opt.value}
                role="option"
                aria-selected={isSelected}
                className={`g-select-option ${isSelected ? "g-select-option--selected" : ""} ${isHighlighted ? "g-select-option--highlighted" : ""}`}
                onClick={() => handleSelect(opt.value)}
                onMouseEnter={() => setHighlightedIndex(index)}
              >
                <span className="g-select-option-label">{opt.label}</span>
                {isSelected && (
                  <span className="g-select-option-check" aria-hidden="true">
                    <Check size={13} strokeWidth={2.2} />
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
