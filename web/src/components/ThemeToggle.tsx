import { setTheme, useTheme } from "@/lib/theme";

/** A visible sun/moon switch. Shows the mode you will get. */
export function ThemeToggle() {
  const theme = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      className="press inline-flex size-10 pointer-coarse:size-11 items-center justify-center rounded-lg border border-control text-ink hover:bg-muted"
    >
      {theme === "dark" ? (
        <svg key="sun" viewBox="0 0 24 24" aria-hidden className="icon-turn size-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" />
        </svg>
      ) : (
        <svg key="moon" viewBox="0 0 24 24" aria-hidden className="icon-turn size-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
        </svg>
      )}
    </button>
  );
}
