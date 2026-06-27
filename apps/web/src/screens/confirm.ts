import type { App } from "../app.js";
import type { ProposedPosition } from "@cancri/data-contracts";
import { esc } from "../dom.js";
import {
  demoToPositions,
  mergeInventory,
  proposalToPositions,
  type MergeChoice,
} from "../inventory.js";

const TOPBAR =
  "display:flex;align-items:center;gap:10px;padding:13px 20px;border-bottom:1px solid #1a2130;background:#0b0f16;font-size:12px;";

// Shared grid template — header and rows must stay in lockstep.
const COLS = "26px 1.4fr 1fr 0.9fr 1.1fr 132px";

/**
 * Confirm inventory — "the machine proposes, you dispose" (brief §B). Renders the
 * proposal from app state; quantities are editable. When the proposal adds an
 * instrument that is already in the book (same ISIN, else symbol), the row offers
 * a per-instrument choice — replace the existing position or add to its quantity —
 * so the user, not the machine, disposes of the conflict. Locking persists the
 * merged book server-side and goes live.
 */
export function renderConfirm(app: App): void {
  const proposal = app.proposal;
  const flaggedCount = proposal.filter((c) => c.confidence < 0.7).length;

  // The book this proposal folds into. Empty on first-run onboarding → no
  // conflicts, identical to the original single-shot flow.
  const book = demoToPositions(app.inventory);
  const bookByKey = new Map(book.map((p) => [p.isin || p.symbol, p] as const));
  const keyOfRow = (c: ProposedPosition): string => c.isin ?? c.symbol;
  const conflictCount = proposal.filter((c) => bookByKey.has(keyOfRow(c))).length;

  const rows = proposal
    .map((c, i) => {
      const flagged = c.confidence < 0.7;
      const key = keyOfRow(c);
      const prior = bookByKey.get(key);
      const col = c.confidence >= 0.9 ? "#36f9d0" : c.confidence >= 0.7 ? "#7b5cff" : "#ffd23f";
      const rowStyle =
        `display:grid;grid-template-columns:${COLS};gap:0;align-items:center;padding:11px 14px;border-bottom:1px solid #10151e;` +
        (prior ? "background:#0a1622;" : flagged ? "background:#1a1505;" : "");
      const dot = `width:7px;height:7px;border-radius:50%;background:${col};box-shadow:0 0 7px ${col};`;
      const qtyStyle = `width:100%;text-align:right;font-family:inherit;font-size:12.5px;font-weight:600;color:#eef3fa;border:1px solid ${flagged ? "#4a3d0a" : "#1a2130"};background:#070a0f;border-radius:5px;padding:4px 9px;outline:none;`;
      const barStyle = `height:100%;width:${Math.round(c.confidence * 100)}%;background:${col};box-shadow:0 0 8px ${col};`;
      const confLabel = flagged ? "review" : `${Math.round(c.confidence * 100)}%`;
      const confTxt = `font-size:10px;font-weight:700;letter-spacing:.5px;color:${col};min-width:40px;text-align:right;`;
      const note = c.uncertaintyNote ? esc(c.uncertaintyNote) : "";
      const title = prior
        ? ` title="already in your book: ${esc(String(prior.quantity))}${note ? ` · ${note}` : ""}"`
        : note
          ? ` title="${note}"`
          : "";

      // Last cell: source for new instruments; a replace/add toggle for ones
      // already in the book. The toggle's container carries the merge choice.
      const btn = (which: MergeChoice, label: string): string =>
        `<button type="button" data-choice-btn="${which}" style="cursor:pointer;font-family:inherit;font-size:10px;font-weight:700;letter-spacing:.3px;border:1px solid #1a2130;border-radius:5px;padding:3px 7px;background:transparent;color:#5b6675;">${label}</button>`;
      const lastCell = prior
        ? `<div data-choice="replace" data-key="${esc(key)}" style="display:flex;gap:4px;justify-content:flex-end;">${btn("replace", "replace")}${btn("add", "+add")}</div>`
        : `<div style="text-align:right;color:#6b7787;font-size:11px;">${esc(c.source)}</div>`;

      return `
      <div style="${rowStyle}"${title}>
        <div style="${dot}"></div>
        <div style="color:#d7dee8;font-size:12.5px;">${esc(c.name)}${prior ? ` <span style="color:#5ec6ff;font-size:9.5px;letter-spacing:.5px;">· IN BOOK</span>` : ""}</div>
        <div style="color:#5ec6ff;font-size:12.5px;font-weight:600;">${esc(c.symbol)}</div>
        <div style="text-align:right;"><input id="cc-qty-${i}" value="${esc(String(c.quantity))}" inputmode="decimal" style="${qtyStyle}" /></div>
        <div style="display:flex;align-items:center;gap:8px;">
          <div style="flex:1;height:5px;border-radius:3px;background:#141a26;overflow:hidden;"><div style="${barStyle}"></div></div>
          <span style="${confTxt}">${confLabel}</span>
        </div>
        ${lastCell}
      </div>`;
    })
    .join("");

  const empty =
    proposal.length === 0
      ? `<div style="padding:30px 0;text-align:center;color:#6b7787;font-size:12px;">no proposal yet — go back and describe or drop your portfolio.</div>`
      : "";

  const conflictHint =
    conflictCount > 0
      ? ` · <span style="color:#5ec6ff;">${conflictCount} already in your book</span> — choose replace or add`
      : "";

  app.root.innerHTML = `
  <div style="position:absolute;inset:0;z-index:3;display:flex;flex-direction:column;">
    <div style="${TOPBAR}">
      <img src="/cancri-logo-mark.png" alt="cancri" width="22" height="22" style="border-radius:50%;filter:drop-shadow(0 0 7px #7b5cff55);" />
      <span style="color:#7b5cff;font-weight:700;letter-spacing:2px;">CANCRI</span>
      <span style="color:#39424f;">/</span>
      <span style="color:#6b7787;">proposed inventory · review &amp; confirm</span>
      <span style="margin-left:auto;color:#ffd23f;font-size:11px;">step 2 — the machine proposes, you dispose</span>
    </div>
    <div style="flex:1;overflow:auto;padding:22px 26px;">
      <div style="font-size:12px;color:#6b7787;margin-bottom:14px;">parsed <span style="color:#36f9d0;">${proposal.length} instruments</span> · <span style="color:#ffd23f;">${flaggedCount} flagged for your eye</span>${conflictHint}. edit anything, then lock it in.</div>
      <div style="border:1px solid #1a2130;border-radius:10px;overflow:hidden;">
        <div style="display:grid;grid-template-columns:${COLS};gap:0;font-size:10.5px;color:#39424f;letter-spacing:1px;background:#0d121b;border-bottom:1px solid #1a2130;padding:10px 14px;">
          <div></div><div>INSTRUMENT</div><div>SYMBOL</div><div style="text-align:right;">QUANTITY</div><div>CONFIDENCE</div><div style="text-align:right;">SOURCE</div>
        </div>
        ${rows}${empty}
      </div>
      <div style="display:flex;align-items:center;gap:12px;margin-top:20px;">
        <button id="cc-lock" style="cursor:pointer;font-family:inherit;font-size:13px;font-weight:700;letter-spacing:.5px;color:#05070b;background:#36f9d0;border:none;border-radius:8px;padding:12px 22px;box-shadow:0 0 22px -6px #36f9d0;">✓ lock inventory &amp; go live</button>
        <button id="cc-back" style="cursor:pointer;font-family:inherit;font-size:12px;color:#6b7787;background:transparent;border:1px solid #1a2130;border-radius:8px;padding:11px 18px;">‹ back to intake</button>
        <span id="cc-cferr" style="margin-left:auto;font-size:11px;color:#39424f;">nothing streams until you confirm.</span>
      </div>
    </div>
  </div>`;

  const lockBtn = app.root.querySelector<HTMLButtonElement>("#cc-lock")!;
  const backBtn = app.root.querySelector<HTMLButtonElement>("#cc-back")!;

  backBtn.addEventListener("click", () => app.goScreen("onboard"));

  // Wire each conflict's replace/add toggle: clicking a button sets the group's
  // choice and repaints the segmented control.
  app.root.querySelectorAll<HTMLElement>("[data-choice]").forEach((group) => {
    const btns = group.querySelectorAll<HTMLButtonElement>("[data-choice-btn]");
    const paint = (): void => {
      const cur = group.dataset["choice"];
      btns.forEach((b) => {
        const on = b.dataset["choiceBtn"] === cur;
        b.style.background = on ? "#173042" : "transparent";
        b.style.color = on ? "#9fdcff" : "#5b6675";
        b.style.borderColor = on ? "#2a5573" : "#1a2130";
      });
    };
    btns.forEach((b) =>
      b.addEventListener("click", () => {
        group.dataset["choice"] = b.dataset["choiceBtn"] ?? "replace";
        paint();
      }),
    );
    paint();
  });

  lockBtn.addEventListener("click", () => {
    // collect edited quantities back into the proposal
    const edited: ProposedPosition[] = proposal.map((c, i) => {
      const input = app.root.querySelector<HTMLInputElement>(`#cc-qty-${i}`);
      const q = input ? Number.parseFloat(input.value) : c.quantity;
      return { ...c, quantity: Number.isFinite(q) ? q : c.quantity };
    });
    app.proposal = edited;

    // collect the per-conflict merge choices
    const choiceByKey = new Map<string, MergeChoice>();
    app.root.querySelectorAll<HTMLElement>("[data-choice]").forEach((group) => {
      const k = group.dataset["key"];
      const ch = group.dataset["choice"];
      if (k && (ch === "add" || ch === "replace")) choiceByKey.set(k, ch);
    });

    const merged = mergeInventory(book, proposalToPositions(edited), (k) =>
      choiceByKey.get(k) ?? "replace",
    );

    lockBtn.disabled = true;
    lockBtn.textContent = "locking…";
    void app.confirmAndGoLive(merged).catch(() => {
      lockBtn.disabled = false;
      lockBtn.textContent = "✓ lock inventory & go live";
    });
  });
}
