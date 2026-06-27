// Tiny DOM helpers. Cold screens render via innerHTML templates; the dashboard
// hot-path caches node refs and mutates them per frame (ADR-0011).

const ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escape user/fixture text before interpolating into an innerHTML template. */
export const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ENTITIES[c] as string);

/** Bind click handlers to elements carrying a matching [data-action] attribute. */
export function wire(root: HTMLElement, handlers: Record<string, (e: Event) => void>): void {
  root.querySelectorAll<HTMLElement>("[data-action]").forEach((elm) => {
    const action = elm.dataset["action"];
    if (action === undefined) return;
    const handler = handlers[action];
    if (handler) elm.addEventListener("click", handler);
  });
}
