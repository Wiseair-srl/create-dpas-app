import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Keeps its content on a single line, shrinking the text to fit the available
 * width when it would otherwise overflow (never enlarges past the base size).
 * Used for KPI figures whose magnitude is unknown — a long euro amount scales
 * down instead of wrapping mid-number. Re-fits on container resize and when the
 * content changes. All measurement runs in a layout effect, so it's SSR-inert
 * (the server renders at scale 1).
 */
export function FitText({
  children,
  className,
  title,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const textRef = React.useRef<HTMLSpanElement>(null);
  const [scale, setScale] = React.useState(1);

  React.useLayoutEffect(() => {
    const container = containerRef.current;
    const text = textRef.current;
    if (!container || !text) return;
    let raf = 0;
    // scrollWidth is layout-based and ignores the applied transform, so `needed`
    // is always the true unscaled width regardless of the current scale.
    const fit = () => {
      const available = container.clientWidth;
      const needed = text.scrollWidth;
      setScale(needed > available && needed > 0 ? available / needed : 1);
    };
    const scheduleFit = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(fit);
    };
    fit();
    // The container can still be mid-layout on first paint; re-measure once it
    // settles, and again after web fonts swap (which changes text width).
    scheduleFit();
    const ro = new ResizeObserver(scheduleFit);
    ro.observe(container);
    document.fonts?.ready.then(scheduleFit).catch(() => {});
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [children]);

  return (
    <div ref={containerRef} title={title} className={cn("w-full overflow-hidden", className)}>
      <span
        ref={textRef}
        className="inline-block origin-left whitespace-nowrap"
        style={{ transform: scale < 1 ? `scale(${scale})` : undefined }}
      >
        {children}
      </span>
    </div>
  );
}
