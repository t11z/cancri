import type { App } from "../app.js";
import { DEFAULT_PROPOSAL } from "../fixtures.js";
import { esc, wire } from "../dom.js";

const TOPBAR =
  "display:flex;align-items:center;gap:10px;padding:13px 20px;border-bottom:1px solid #1a2130;background:#0b0f16;font-size:12px;";

/**
 * Confirm inventory — "the machine proposes, you dispose". Phase 1 renders the
 * proposed rows with confidence styling; the lock button starts the live (sim)
 * feed. Phase 3 makes quantities editable and gates lock on verified ISINs.
 */
export function renderConfirm(app: App): void {
  const flaggedCount = DEFAULT_PROPOSAL.filter((c) => c.confidence < 0.7).length;

  const rows = DEFAULT_PROPOSAL.map((c) => {
    const flagged = c.confidence < 0.7;
    const col = c.confidence >= 0.9 ? "#36f9d0" : c.confidence >= 0.7 ? "#7b5cff" : "#ffd23f";
    const rowStyle =
      "display:grid;grid-template-columns:26px 1.4fr 1fr 0.9fr 1.3fr 90px;gap:0;align-items:center;padding:11px 14px;border-bottom:1px solid #10151e;" +
      (flagged ? "background:#1a1505;" : "");
    const dot = `width:7px;height:7px;border-radius:50%;background:${col};box-shadow:0 0 7px ${col};`;
    const qtyStyle =
      `font-size:12.5px;font-weight:600;color:#eef3fa;border:1px solid ${flagged ? "#4a3d0a" : "#1a2130"};background:#070a0f;border-radius:5px;padding:4px 9px;`;
    const barStyle = `height:100%;width:${Math.round(c.confidence * 100)}%;background:${col};box-shadow:0 0 8px ${col};`;
    const confLabel = flagged ? "review" : Math.round(c.confidence * 100) + "%";
    const confTxt = `font-size:10px;font-weight:700;letter-spacing:.5px;color:${col};min-width:40px;text-align:right;`;
    return `
      <div style="${rowStyle}">
        <div style="${dot}"></div>
        <div style="color:#d7dee8;font-size:12.5px;">${esc(c.name)}</div>
        <div style="color:#5ec6ff;font-size:12.5px;font-weight:600;">${esc(c.symbol)}</div>
        <div style="text-align:right;"><span style="${qtyStyle}">${esc(String(c.quantity))}</span></div>
        <div style="display:flex;align-items:center;gap:8px;">
          <div style="flex:1;height:5px;border-radius:3px;background:#141a26;overflow:hidden;"><div style="${barStyle}"></div></div>
          <span style="${confTxt}">${confLabel}</span>
        </div>
        <div style="text-align:right;color:#6b7787;font-size:11px;">${esc(c.source)}</div>
      </div>`;
  }).join("");

  app.root.innerHTML = `
  <div style="position:absolute;inset:0;z-index:3;display:flex;flex-direction:column;">
    <div style="${TOPBAR}">
      <span style="color:#7b5cff;font-weight:700;letter-spacing:2px;">CANCRI</span>
      <span style="color:#39424f;">/</span>
      <span style="color:#6b7787;">proposed inventory · review &amp; confirm</span>
      <span style="margin-left:auto;color:#ffd23f;font-size:11px;">step 2 — the machine proposes, you dispose</span>
    </div>
    <div style="flex:1;overflow:auto;padding:22px 26px;">
      <div style="font-size:12px;color:#6b7787;margin-bottom:14px;">gemini parsed <span style="color:#36f9d0;">${DEFAULT_PROPOSAL.length} instruments</span> · <span style="color:#ffd23f;">${flaggedCount} flagged for your eye</span>. edit anything, then lock it in.</div>
      <div style="border:1px solid #1a2130;border-radius:10px;overflow:hidden;">
        <div style="display:grid;grid-template-columns:26px 1.4fr 1fr 0.9fr 1.3fr 90px;gap:0;font-size:10.5px;color:#39424f;letter-spacing:1px;background:#0d121b;border-bottom:1px solid #1a2130;padding:10px 14px;">
          <div></div><div>INSTRUMENT</div><div>SYMBOL</div><div style="text-align:right;">QUANTITY</div><div>CONFIDENCE</div><div style="text-align:right;">SOURCE</div>
        </div>
        ${rows}
      </div>
      <div style="display:flex;align-items:center;gap:12px;margin-top:20px;">
        <button data-action="lock" style="cursor:pointer;font-size:13px;font-weight:700;letter-spacing:.5px;color:#05070b;background:#36f9d0;border:none;border-radius:8px;padding:12px 22px;box-shadow:0 0 22px -6px #36f9d0;">✓ lock inventory &amp; go live</button>
        <button data-action="back" style="cursor:pointer;font-size:12px;color:#6b7787;background:transparent;border:1px solid #1a2130;border-radius:8px;padding:11px 18px;">‹ back to intake</button>
        <span style="margin-left:auto;font-size:11px;color:#39424f;">nothing streams until you confirm.</span>
      </div>
    </div>
  </div>`;

  wire(app.root, {
    lock: () => app.goLive(),
    back: () => app.goScreen("onboard"),
  });
}
