"use client";

import type { Theme } from "./ids.ts";
import { useTheme } from "./ThemeProvider.tsx";

/** Texts come from the caller (uz/ru): the package holds no translations. */
export interface ThemeToggleLabels {
  /** Name of the group, e.g. "Time of day". */
  group: string;
  day: string;
  night: string;
}

/** Sun with eight rays and a crescent, drawn with `currentColor`: the segment recolors them. No emoji. */
function SunIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M10 1.8v2.3M10 15.9v2.3M1.8 10h2.3M15.9 10h2.3M4.2 4.2l1.6 1.6M14.2 14.2l1.6 1.6M4.2 15.8l1.6-1.6M14.2 5.8l1.6-1.6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M15.6 12.7A6.4 6.4 0 0 1 7.3 4.4a6.4 6.4 0 1 0 8.3 8.3Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Two-button segment day/night (DESIGN_SYSTEM 3.2): `aria-pressed` marks the current one. */
export function ThemeToggleView({
  theme,
  onSelect,
  labels,
}: {
  theme: Theme;
  onSelect(theme: Theme): void;
  labels: ThemeToggleLabels;
}) {
  return (
    <fieldset className="nv-seg2 nv-tod" aria-label={labels.group}>
      <button
        type="button"
        aria-pressed={theme === "day"}
        aria-label={labels.day}
        title={labels.day}
        onClick={() => onSelect("day")}
      >
        <SunIcon />
      </button>
      <button
        type="button"
        aria-pressed={theme === "night"}
        aria-label={labels.night}
        title={labels.night}
        onClick={() => onSelect("night")}
      >
        <MoonIcon />
      </button>
    </fieldset>
  );
}

/** The segment bound to `ThemeProvider`. */
export function ThemeToggle({ labels }: { labels: ThemeToggleLabels }) {
  const { theme, setTheme } = useTheme();
  return <ThemeToggleView theme={theme} onSelect={setTheme} labels={labels} />;
}
