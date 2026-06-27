import type { App } from "./app.js";
import type { DashState, Screen } from "./state.js";

/**
 * The "// review" navigator from the handover reference. Per the handover this is
 * a DESIGN-HANDOFF AID ONLY — it is gated behind `import.meta.env.DEV` and is never
 * part of a production build. It lets you jump to any screen / dashboard state and
 * toggle the in-app MOTION (reduced-motion) override.
 */
let container: HTMLDivElement | null = null;

const SCREENS: ReadonlyArray<[Screen, string]> = [
  ["boot", "BOOT"],
  ["auth", "AUTH"],
  ["onboard", "ONBOARD"],
  ["confirm", "CONFIRM"],
  ["dash", "DASH"],
];

const STATES: ReadonlyArray<[DashState, string]> = [
  ["normal", "LIVE"],
  ["degraded", "DEGRADED"],
  ["reconnect", "RECONNECT"],
  ["closed", "CLOSED"],
  ["empty", "EMPTY"],
  ["error", "ERROR"],
];

function navBtn(active: boolean): string {
  return (
    "cursor:pointer;font-family:inherit;font-size:10px;letter-spacing:.5px;border-radius:6px;padding:5px 8px;" +
    `border:1px solid ${active ? "#36f9d0" : "#222b3b"};background:${active ? "#0e2a26" : "transparent"};color:${active ? "#36f9d0" : "#6b7787"};`
  );
}

export function ensureReviewBar(app: App): void {
  if (!container) {
    container = document.createElement("div");
    document.body.appendChild(container);
    container.addEventListener("click", (e) => {
      const target = (e.target as HTMLElement).closest<HTMLElement>("[data-go]");
      if (!target) return;
      const go = target.dataset["go"];
      if (!go) return;
      if (go === "reduce") app.toggleReduce();
      else if (go === "logout") void app.signOut();
      else if (go.startsWith("screen:")) app.goScreen(go.slice(7) as Screen);
      else if (go.startsWith("state:")) app.goState(go.slice(6) as DashState);
    });
  }
  render(app, container);
}

function render(app: App, c: HTMLDivElement): void {
  const screens = SCREENS.map(([id, label]) => {
    // The DASH screen button drives a live dashboard, so route it through goState.
    const go = id === "dash" ? "state:normal" : `screen:${id}`;
    const active = app.screen === id;
    return `<button data-go="${go}" style="${navBtn(active)}">${label}</button>`;
  }).join("");

  const states = STATES.map(([id, label]) => {
    const active = app.screen === "dash" && app.dashState === id;
    return `<button data-go="state:${id}" style="${navBtn(active)}">${label}</button>`;
  }).join("");

  const reduceStyle =
    navBtn(false) + (app.reduce ? "color:#ffd23f;border-color:#4a3d0a;" : "");

  c.innerHTML = `
  <div style="position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:40;display:flex;align-items:center;gap:4px;font-family:'JetBrains Mono',monospace;background:#0b0f16ee;border:1px solid #222b3b;border-radius:10px;padding:6px 8px;box-shadow:0 16px 50px -20px #000;backdrop-filter:blur(6px);max-width:94vw;flex-wrap:wrap;justify-content:center;">
    <span style="font-size:9.5px;color:#39424f;letter-spacing:1px;padding:0 6px;">// review</span>
    ${screens}
    <span style="width:1px;height:16px;background:#222b3b;margin:0 3px;"></span>
    ${states}
    <span style="width:1px;height:16px;background:#222b3b;margin:0 3px;"></span>
    <button data-go="reduce" style="${reduceStyle}">${app.reduce ? "MOTION: off" : "MOTION: on"}</button>
    <span style="width:1px;height:16px;background:#222b3b;margin:0 3px;"></span>
    <button data-go="logout" style="${navBtn(false)}">LOGOUT</button>
  </div>`;
}
