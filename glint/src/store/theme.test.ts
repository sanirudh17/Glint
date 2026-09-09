import { describe, it, expect, beforeEach, vi } from "vitest";

// Minimal DOM mock for node environment
const styleStore = new Map<string, string>();
const fakeDocument = {
  documentElement: {
    dataset: {} as Record<string, string>,
    style: {
      setProperty: (k: string, v: string) => styleStore.set(k, v),
      getPropertyValue: (k: string) => styleStore.get(k) || "",
      removeProperty: (k: string) => styleStore.delete(k),
    },
  },
};

const storageStore = new Map<string, string>();
const fakeLocalStorage = {
  getItem: (k: string) => storageStore.get(k) ?? null,
  setItem: (k: string, v: string) => storageStore.set(k, v),
  clear: () => storageStore.clear(),
};

vi.stubGlobal("document", fakeDocument);
vi.stubGlobal("localStorage", fakeLocalStorage);

import { applyTheme, applyAccent, THEME_STORAGE_KEY } from "./useAppStore";

describe("applyTheme", () => {
  beforeEach(() => {
    fakeDocument.documentElement.dataset = {};
    styleStore.clear();
    storageStore.clear();
  });

  it("applies dark theme and synchronizes --bg", () => {
    applyTheme("dark");
    expect(fakeDocument.documentElement.dataset.theme).toBe("dark");
    expect(fakeDocument.documentElement.style.getPropertyValue("--bg")).toBe("#0C0D0F");
    expect(fakeLocalStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("applies light theme and synchronizes --bg", () => {
    applyTheme("light");
    expect(fakeDocument.documentElement.dataset.theme).toBe("light");
    expect(fakeDocument.documentElement.style.getPropertyValue("--bg")).toBe("#F6F7F9");
    expect(fakeLocalStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  it("resolves system theme based on prefers-color-scheme media query", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockImplementation((query: string) => ({
      matches: query === "(prefers-color-scheme: dark)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));

    applyTheme("system");
    expect(fakeDocument.documentElement.dataset.theme).toBe("dark");
    expect(fakeDocument.documentElement.style.getPropertyValue("--bg")).toBe("#0C0D0F");
    expect(fakeLocalStorage.getItem(THEME_STORAGE_KEY)).toBe("system");
  });
});

describe("applyAccent", () => {
  beforeEach(() => {
    styleStore.clear();
    storageStore.clear();
  });

  it("applies a palette accent and its subtle variant", () => {
    applyAccent("#7C6EFA");
    expect(fakeDocument.documentElement.style.getPropertyValue("--accent")).toBe("#7C6EFA");
    expect(fakeDocument.documentElement.style.getPropertyValue("--accent-subtle")).toBe("rgba(124, 110, 250, 0.12)");
  });
});
