import type { App } from "../app.js";
import { wireIntake } from "../intake.js";

/**
 * Add-holdings popup. The dashboard's "+ add" no longer throws the user back to
 * the full intake screen; it overlays this compact modal — the same chat assistant
 * and CSV/XLSX/text drop, in place, over the still-live terminal. On a successful
 * parse `wireIntake` routes to the confirm screen (which merges into the book),
 * which re-renders the root and so disposes of the modal.
 */
export function openAddModal(app: App): void {
  // One at a time.
  app.root.querySelector("#cc-addmodal")?.remove();

  const overlay = document.createElement("div");
  overlay.id = "cc-addmodal";
  overlay.style.cssText =
    "position:absolute;inset:0;z-index:20;display:flex;align-items:center;justify-content:center;background:#05070bcc;backdrop-filter:blur(2px);padding:24px;";

  overlay.innerHTML = `
    <div role="dialog" aria-label="add holdings" style="width:min(680px,100%);max-height:100%;display:flex;flex-direction:column;background:#0b0f16;border:1px solid #1a2130;border-radius:14px;overflow:hidden;box-shadow:0 24px 80px -20px #000;">
      <div style="display:flex;align-items:center;gap:10px;padding:13px 16px;border-bottom:1px solid #1a2130;font-size:12px;">
        <span style="color:#36f9d0;font-weight:700;letter-spacing:.5px;">+ add holdings</span>
        <span style="color:#39424f;">/</span>
        <span style="color:#6b7787;">describe or drop — you confirm before anything streams</span>
        <button id="cc-addclose" title="close" style="margin-left:auto;cursor:pointer;font-family:inherit;font-size:14px;line-height:1;color:#6b7787;background:transparent;border:1px solid #1a2130;border-radius:6px;padding:4px 9px;">✕</button>
      </div>
      <div id="cc-thread" style="flex:1;min-height:170px;max-height:320px;overflow:auto;padding:16px 18px;display:flex;flex-direction:column;gap:12px;">
        <div style="font-size:11px;color:#39424f;letter-spacing:1px;">— portfolio assistant · intake —</div>
      </div>
      <div style="padding:13px 16px;border-top:1px solid #1a2130;background:#0b0f16;display:flex;flex-direction:column;gap:11px;">
        <div id="cc-onerr" style="display:none;color:#ff5277;font-size:11px;"></div>
        <div style="display:flex;align-items:center;gap:10px;border:1px solid #222b3b;background:#070a0f;border-radius:8px;padding:10px 12px;">
          <span style="color:#36f9d0;">&gt;</span>
          <input id="cc-chat" type="text" placeholder="e.g. 12 AAPL, 0.5 BTC, 25 g XAU…" style="flex:1;min-width:0;background:transparent;border:none;outline:none;color:#d7dee8;font-family:inherit;font-size:12.5px;" />
          <button id="cc-parse" style="cursor:pointer;font-family:inherit;font-size:11.5px;font-weight:700;color:#05070b;background:#36f9d0;border:none;border-radius:6px;padding:7px 12px;">parse ↵</button>
        </div>
        <label for="cc-file" style="cursor:pointer;border:1.5px dashed #2a3446;border-radius:10px;display:flex;align-items:center;justify-content:center;gap:10px;background:#080b11;padding:12px;text-align:center;">
          <span style="font-size:18px;color:#7b5cff;">⤓</span>
          <span style="font-size:11.5px;color:#9aa6b4;">drop <span style="color:#36f9d0;">CSV</span> · <span style="color:#5ec6ff;">XLSX</span> · or paste text — messy is fine</span>
          <input id="cc-file" type="file" accept=".csv,.xlsx,.xls,.txt,text/plain" style="display:none;" />
        </label>
      </div>
    </div>`;

  app.root.append(overlay);

  const close = (): void => overlay.remove();
  overlay.querySelector<HTMLButtonElement>("#cc-addclose")!.addEventListener("click", close);
  // Click on the dimmed backdrop (not the dialog) closes.
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      close();
      window.removeEventListener("keydown", onKey);
    }
  };
  window.addEventListener("keydown", onKey);

  const chatInput = overlay.querySelector<HTMLInputElement>("#cc-chat")!;
  wireIntake(app, {
    thread: overlay.querySelector<HTMLDivElement>("#cc-thread")!,
    chatInput,
    parseBtn: overlay.querySelector<HTMLButtonElement>("#cc-parse")!,
    fileInput: overlay.querySelector<HTMLInputElement>("#cc-file")!,
    err: overlay.querySelector<HTMLDivElement>("#cc-onerr")!,
  });
  chatInput.focus();
}
