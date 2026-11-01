import { useEffect, useState } from "react";
import { describeFunction } from "./manual";
// A single overlay serves toolbar controls, including lazily mounted viewport buttons.
export function Tooltips() {
  const [tip, setTip] = useState<{
    title: string;
    description: string;
    x: number;
    y: number;
  } | null>(null);
  useEffect(() => {
    let active: HTMLElement | null = null,
      timer: ReturnType<typeof setTimeout> | undefined;
    const hide = () => {
      clearTimeout(timer);
      if (active?.getAttribute("aria-describedby") === "workspace-tooltip")
        active.removeAttribute("aria-describedby");
      active = null;
      setTip(null);
    };
    const show = (event: Event) => {
      const element = (event.target as Element)?.closest<HTMLElement>(
        "button[title],button[data-tip]",
      );
      if (!element || element === active) return;
      hide();
      active = element;
      timer = setTimeout(() => {
        if (!element.isConnected) return;
        const label = element.dataset.tip ?? element.title;
        const [title, extra] = label.split(" — ");
        const rect = element.getBoundingClientRect();
        element.setAttribute("aria-describedby", "workspace-tooltip");
        setTip({
          title,
          description: extra ?? describeFunction(title),
          x: Math.max(8, Math.min(innerWidth - 312, rect.left)),
          y:
            rect.bottom + 128 > innerHeight
              ? Math.max(8, rect.top - 125)
              : rect.bottom + 8,
        });
      }, 250);
    };
    const out = (event: Event) => {
      if (active && !(event as MouseEvent).relatedTarget) return hide();
      if (
        active &&
        !active.contains((event as MouseEvent).relatedTarget as Node)
      )
        hide();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    document.addEventListener("pointerover", show);
    document.addEventListener("focusin", show);
    document.addEventListener("pointerout", out);
    document.addEventListener("focusout", out);
    document.addEventListener("keydown", key);
    document.addEventListener("pointerdown", hide);
    window.addEventListener("resize", hide);
    window.addEventListener("scroll", hide, true);
    return () => {
      hide();
      document.removeEventListener("pointerover", show);
      document.removeEventListener("focusin", show);
      document.removeEventListener("pointerout", out);
      document.removeEventListener("focusout", out);
      document.removeEventListener("keydown", key);
      document.removeEventListener("pointerdown", hide);
      window.removeEventListener("resize", hide);
      window.removeEventListener("scroll", hide, true);
    };
  }, []);
  return tip ? (
    <div
      id="workspace-tooltip"
      role="tooltip"
      className="workspace-tooltip"
      style={{ left: tip.x, top: tip.y }}
    >
      <strong>{tip.title}</strong>
      {tip.description && <span>{tip.description}</span>}
    </div>
  ) : null;
}
