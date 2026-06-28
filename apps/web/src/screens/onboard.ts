import type { App } from "../app.js";
import { DEFAULT_CHAT } from "../fixtures.js";
import { appendBubble, wireIntake } from "../intake.js";

const TOPBAR =
  "display:flex;align-items:center;gap:10px;padding:13px 20px;border-bottom:1px solid #1a2130;background:#0b0f16;font-size:12px;";

/**
 * Holdings intake (brief §B). The same screen serves the first-run case (an empty
 * book) and adding to an existing book later — onboarding is just "add into an
 * empty book". Both routes — the chat input and the file drop — converge on the
 * same server-side pipeline (see `wireIntake`); the assistant streams its reply
 * back into the thread before the proposal screen opens. When a book already
 * exists, a way back to the dashboard is offered so intake is never a dead end.
 */
export function renderOnboard(app: App): void {
  const adding = app.inventory.length > 0;
  const crumb = adding ? "add holdings" : "feed the terminal";
  const back = adding
    ? `<button id="cc-toback" style="margin-left:auto;cursor:pointer;font-family:inherit;font-size:11px;color:#6b7787;background:transparent;border:1px solid #1a2130;border-radius:6px;padding:5px 11px;">‹ dashboard</button>`
    : `<span style="margin-left:auto;color:#39424f;font-size:11px;">step 1 — describe or drop</span>`;
  app.root.innerHTML = `
  <div style="position:absolute;inset:0;z-index:3;display:flex;flex-direction:column;">
    <div style="${TOPBAR}">
      <img src="/cancri-logo-mark.png" alt="cancri" width="22" height="22" style="border-radius:50%;filter:drop-shadow(0 0 7px #7b5cff55);" />
      <span style="color:#7b5cff;font-weight:700;letter-spacing:2px;">CANCRI</span>
      <span style="color:#39424f;">/</span>
      <span style="color:#6b7787;">${crumb}</span>
      ${back}
    </div>
    <div style="flex:1;display:grid;grid-template-columns:1.3fr 1fr;gap:0;min-height:0;">
      <div style="display:flex;flex-direction:column;min-height:0;border-right:1px solid #1a2130;">
        <div id="cc-thread" style="flex:1;overflow:auto;padding:20px 22px;display:flex;flex-direction:column;gap:14px;">
          <div style="font-size:11px;color:#39424f;letter-spacing:1px;">— portfolio assistant · intake —</div>
        </div>
        <div style="padding:14px 18px;border-top:1px solid #1a2130;background:#0b0f16;">
          <div id="cc-onerr" style="display:none;color:#ff5277;font-size:11px;margin-bottom:8px;"></div>
          <div style="display:flex;align-items:center;gap:10px;border:1px solid #222b3b;background:#070a0f;border-radius:8px;padding:11px 13px;">
            <span style="color:#36f9d0;">&gt;</span>
            <input id="cc-chat" type="text" placeholder="e.g. 12 AAPL, 0.5 BTC, 100 msft, ~30 nvidia…" style="flex:1;min-width:0;background:transparent;border:none;outline:none;color:#d7dee8;font-family:inherit;font-size:12.5px;" />
            <button id="cc-parse" style="cursor:pointer;font-family:inherit;font-size:11.5px;font-weight:700;color:#05070b;background:#36f9d0;border:none;border-radius:6px;padding:7px 12px;">parse ↵</button>
          </div>
        </div>
      </div>
      <div style="padding:22px;display:flex;flex-direction:column;gap:16px;min-height:0;">
        <div style="font-size:11px;color:#39424f;letter-spacing:1px;">— or drop a file —</div>
        <label for="cc-file" style="cursor:pointer;flex:1;border:1.5px dashed #2a3446;border-radius:12px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:#080b11;text-align:center;padding:20px;">
          <div style="font-size:34px;color:#7b5cff;text-shadow:0 0 26px #7b5cff66;">⤓</div>
          <div style="font-size:13px;color:#d7dee8;">drop <span style="color:#36f9d0;">CSV</span> · <span style="color:#5ec6ff;">XLSX</span> · or paste text</div>
          <div style="font-size:11px;color:#6b7787;max-width:230px;line-height:1.6;">messy is fine. the machine reconciles tickers, quantities &amp; names — you confirm before anything goes live.</div>
          <input id="cc-file" type="file" accept=".csv,.xlsx,.xls,.txt,text/plain" style="display:none;" />
        </label>
        <div style="font-size:10.5px;color:#39424f;line-height:1.7;">↳ next: the assistant reads your input and lays it out as a structured inventory. <span style="color:#7b5cff;">the machine proposes — you dispose.</span></div>
      </div>
    </div>
  </div>`;

  const thread = app.root.querySelector<HTMLDivElement>("#cc-thread")!;
  const chatInput = app.root.querySelector<HTMLInputElement>("#cc-chat")!;

  // When adding to an existing book, the dashboard is one click away — the live
  // feed kept running underneath, so returning is just a re-render.
  app.root
    .querySelector<HTMLButtonElement>("#cc-toback")
    ?.addEventListener("click", () => app.goScreen("dash"));

  // Render any seed messages (none by default) through the shared bubble styling.
  for (const m of DEFAULT_CHAT) appendBubble(thread, m.role).txt.textContent = m.text;

  wireIntake(app, {
    thread,
    chatInput,
    parseBtn: app.root.querySelector<HTMLButtonElement>("#cc-parse")!,
    fileInput: app.root.querySelector<HTMLInputElement>("#cc-file")!,
    err: app.root.querySelector<HTMLDivElement>("#cc-onerr")!,
  });

  chatInput.focus();
}
