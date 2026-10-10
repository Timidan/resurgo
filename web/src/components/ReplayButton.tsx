import { cn } from "@/lib/utils";

export type ActionState = "idle" | "loading" | "done";

/**
 * A button that morphs idle -> working -> done in place. The three labels share one
 * grid cell, so the button's width never changes while its content does.
 */
export function ActionButton({
  state,
  idle,
  loading,
  done,
  idleGlyph = "▶",
  doneGlyph = "✓",
  onClick,
  className,
}: {
  state: ActionState;
  idle: string;
  loading: string;
  done: string;
  idleGlyph?: string;
  doneGlyph?: string;
  onClick: () => void;
  className?: string;
}) {
  const layer =
    "col-start-1 row-start-1 inline-flex items-center justify-center gap-2.5 whitespace-nowrap transition-[opacity,transform] duration-300 ease-out motion-reduce:transition-none";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-busy={state === "loading"}
      disabled={state === "loading"}
      className={cn(
        "grid min-h-12 cursor-pointer place-items-center rounded-lg border px-6 text-base font-semibold transition-colors duration-300",
        "disabled:cursor-progress",
        state === "done"
          ? "border-foreground bg-transparent text-foreground hover:bg-accent"
          : "border-foreground bg-foreground text-background hover:bg-foreground/90",
        state === "loading" && "bg-accent text-foreground border-border",
        className,
      )}
    >
      <span aria-hidden={state !== "idle"} className={cn(layer, state !== "idle" && "pointer-events-none -translate-y-1.5 opacity-0")}>
        <span aria-hidden className="font-mono text-sm">{idleGlyph}</span>
        {idle}
      </span>
      <span aria-hidden={state !== "loading"} className={cn(layer, state !== "loading" && "pointer-events-none translate-y-1.5 opacity-0")}>
        <span aria-hidden className="inline-block size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" />
        {loading}
      </span>
      <span aria-hidden={state !== "done"} className={cn(layer, state !== "done" && "pointer-events-none translate-y-1.5 opacity-0")}>
        <span aria-hidden className="font-mono text-sm">{doneGlyph}</span>
        {done}
      </span>
      <span className="sr-only" aria-live="polite">
        {state === "loading" ? loading : state === "done" ? done : ""}
      </span>
    </button>
  );
}
