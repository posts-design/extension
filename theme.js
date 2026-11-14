"use strict";

// The theme (owner, 2026-11-12): System, Light or Dark from Settings, kept in this browser. It runs
// before the page paints, so a tab never flashes the other theme, and follows the system while the
// choice is System. newtab.js uses the same three names.
const THEME_KEY = "posts-design-newtab:theme:v1";
const systemDark = matchMedia("(prefers-color-scheme: dark)");

function themeChoice() {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch { return "system"; }
}

function applyTheme(choice = themeChoice()) {
  const dark = choice === "dark" || (choice === "system" && systemDark.matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

/** Keeps the reader's choice (System clears it) and applies it at once. */
function chooseTheme(choice) {
  try {
    if (choice === "system") localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, choice);
  } catch { /* Without storage the theme still changes, for this tab only. */ }
  applyTheme(choice);
}

applyTheme();
systemDark.addEventListener("change", () => applyTheme());
// A choice made in another new tab reaches this one too.
addEventListener("storage", (event) => { if (event.key === THEME_KEY || event.key === null) applyTheme(); });
