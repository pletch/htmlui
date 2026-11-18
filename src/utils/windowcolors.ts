// Reports the colours of the current theme to KopiaUI, which gives the window
// title bar the same colours as the sidebar, whatever the Windows theme is.

interface KopiaUIWindowColors {
  setWindowColors?: (colors: { caption: string; text: string }) => Promise<unknown>;
}

/** Converts any CSS colour to "#rrggbb" as the browser resolves it, or "" when it cannot. */
export function cssColorToHex(value: string): string {
  if (!value) {
    return "";
  }

  const probe = document.createElement("span");
  probe.style.color = value;

  if (!probe.style.color) {
    return "";
  }

  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();

  if (/^#[0-9a-fA-F]{6}$/.test(resolved)) {
    return resolved.toLowerCase();
  }

  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(resolved);
  if (!m) {
    return "";
  }

  return "#" + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("");
}

/**
 * Tells KopiaUI the colours of the theme just applied: the sidebar's
 * background for the title bar, the body text for its title. Outside KopiaUI
 * it does nothing.
 */
export function reportWindowColors(): void {
  const kopiaUI = (window as unknown as { kopiaUI?: KopiaUIWindowColors }).kopiaUI;
  if (!kopiaUI?.setWindowColors) {
    return;
  }

  // after the theme's class has taken effect
  window.requestAnimationFrame(() => {
    const style = getComputedStyle(document.documentElement);
    const caption = cssColorToHex(
      style.getPropertyValue("--color-sidebar-bg").trim() || style.getPropertyValue("--background-color").trim(),
    );
    const text = cssColorToHex(style.getPropertyValue("--color-text-body").trim());

    if (caption && text) {
      kopiaUI.setWindowColors!({ caption, text }).catch(() => {});
    }
  });
}
