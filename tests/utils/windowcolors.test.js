import { afterEach, describe, expect, test, vi } from "vitest";
import { cssColorToHex, reportWindowColors } from "../../src/utils/windowcolors";

afterEach(() => {
  delete window.kopiaUI;
  document.documentElement.removeAttribute("style");
  vi.restoreAllMocks();
});

describe("windowcolors", () => {
  test("converts CSS colors to #rrggbb", () => {
    expect(cssColorToHex("#0F1012")).toBe("#0f1012");
    expect(cssColorToHex("rgb(34, 34, 34)")).toBe("#222222");
    expect(cssColorToHex("white")).toBe("#ffffff");
    expect(cssColorToHex("")).toBe("");
    expect(cssColorToHex("not a color")).toBe("");
  });

  test("reports the sidebar and text colors to KopiaUI", () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 0;
    });
    window.kopiaUI = { setWindowColors: vi.fn(() => Promise.resolve()) };
    document.documentElement.style.setProperty("--background-color", "#222222");
    document.documentElement.style.setProperty("--color-text-body", "#cfcfcf");

    reportWindowColors();

    expect(window.kopiaUI.setWindowColors).toHaveBeenCalledWith({ caption: "#222222", text: "#cfcfcf" });

    // the sidebar's own background wins over the page's
    document.documentElement.style.setProperty("--color-sidebar-bg", "#0f1012");
    reportWindowColors();

    expect(window.kopiaUI.setWindowColors).toHaveBeenLastCalledWith({ caption: "#0f1012", text: "#cfcfcf" });
  });

  test("does nothing outside KopiaUI", () => {
    expect(() => reportWindowColors()).not.toThrow();
  });
});
