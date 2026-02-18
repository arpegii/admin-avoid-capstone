import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useDarkMode } from "./useDarkMode";

describe("useDarkMode", () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.classList.remove("dark");
  });

  afterEach(() => {
    localStorage.clear();
    document.body.classList.remove("dark");
  });

  it("initializes from localStorage", () => {
    localStorage.setItem("darkMode", "enabled");
    const { result } = renderHook(() => useDarkMode());

    expect(result.current.isDarkMode).toBe(true);
    expect(document.body.classList.contains("dark")).toBe(true);
  });

  it("toggles and persists dark mode", () => {
    const { result } = renderHook(() => useDarkMode());

    expect(result.current.isDarkMode).toBe(false);
    expect(localStorage.getItem("darkMode")).toBe("disabled");

    act(() => {
      result.current.toggleDarkMode();
    });

    expect(result.current.isDarkMode).toBe(true);
    expect(document.body.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("darkMode")).toBe("enabled");
  });
});
