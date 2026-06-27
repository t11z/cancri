import type { App } from "../app.js";
import { DEFAULT_CHAT } from "../fixtures.js";
import { esc } from "../dom.js";
import type { NormalizeInput } from "../functions-client.js";

const TOPBAR =
  "display:flex;align-items:center;gap:10px;padding:13px 20px;border-bottom:1px solid #1a2130;background:#0b0f16;font-size:12px;";

/**
 * Onboarding intake (brief §B). Both routes — the chat input and the file drop —
 * converge on the same server-side Gemini normalisation, then the proposal screen.
 */
export function renderOnboard(app: App): void {
  const chat = DEFAULT_CHAT.map((m) => {
    const me = m.role === "user";
    const wrap = `display:flex;flex-direction:column;gap:4px;align-items:${me ? "flex-end" : "flex-start"};`;
    const who = `font-size:9.5px;letter-spacing:1px;color:${me ? "#5ec6ff" : "#7b5cff"};`;
    const bubble =
      `max-width:78%;font-size:12.5px;line-height:1.55;padding:10px 13px;border-radius:9px;` +
      (me
        ? "background:#0c1a26;border:1px solid #173042;color:#cfe6f5;"
        : "background:#0f0b1e;border:1px solid #241d44;color:#d7dee8;");
    return `<div style="${wrap}"><div style="${who}">${me ? "you" : "gemini"}</div><div style="${bubble}">${esc(m.text)}</div></div>`;
  }).join("");

  app.root.innerHTML = `
  <div style="position:absolute;inset:0;z-index:3;display:flex;flex-direction:column;">
    <div style="${TOPBAR}">
      <span style="color:#7b5cff;font-weight:700;letter-spacing:2px;">CANCRI</span>
      <span style="color:#39424f;">/</span>
      <span style="color:#6b7787;">onboarding · feed the terminal</span>
      <span style="margin-left:auto;color:#39424f;font-size:11px;">step 1 — describe or drop</span>
    </div>
    <div style="flex:1;display:grid;grid-template-columns:1.3fr 1fr;gap:0;min-height:0;">
      <div style="display:flex;flex-direction:column;min-height:0;border-right:1px solid #1a2130;">
        <div style="flex:1;overflow:auto;padding:20px 22px;display:flex;flex-direction:column;gap:14px;">
          <div style="font-size:11px;color:#39424f;letter-spacing:1px;">— gemini · portfolio intake —</div>
          ${chat}
          <div id="cc-onerr" style="display:none;color:#ff5277;font-size:11px;"></div>
        </div>
        <div style="padding:14px 18px;border-top:1px solid #1a2130;background:#0b0f16;">
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
        <div style="font-size:10.5px;color:#39424f;line-height:1.7;">↳ next: gemini normalises your input into a structured inventory. <span style="color:#7b5cff;">the machine proposes — you dispose.</span></div>
      </div>
    </div>
  </div>`;

  const chatInput = app.root.querySelector<HTMLInputElement>("#cc-chat")!;
  const parseBtn = app.root.querySelector<HTMLButtonElement>("#cc-parse")!;
  const fileInput = app.root.querySelector<HTMLInputElement>("#cc-file")!;
  const err = app.root.querySelector<HTMLDivElement>("#cc-onerr")!;

  const fail = (m: string): void => {
    err.textContent = m;
    err.style.display = "block";
  };
  const busy = (b: boolean): void => {
    parseBtn.disabled = b;
    parseBtn.textContent = b ? "parsing…" : "parse ↵";
  };

  const run = async (input: NormalizeInput): Promise<void> => {
    err.style.display = "none";
    busy(true);
    try {
      await app.parseInput(input);
    } catch {
      fail("normalisation failed — is the functions backend running?");
      busy(false);
    }
  };

  const parseChat = (): void => {
    const content = chatInput.value.trim();
    if (content === "") {
      fail("describe your portfolio first");
      return;
    }
    void run({ kind: "text", content });
  };

  parseBtn.addEventListener("click", parseChat);
  chatInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") parseChat();
  });

  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const lower = file.name.toLowerCase();
    const isExcel = lower.endsWith(".xlsx") || lower.endsWith(".xls");
    const reader = new FileReader();
    reader.onload = () => {
      if (isExcel) {
        const bytes = new Uint8Array(reader.result as ArrayBuffer);
        let binary = "";
        for (const b of bytes) binary += String.fromCharCode(b);
        void run({ kind: "xlsx", content: btoa(binary) });
      } else {
        void run({ kind: "csv", content: String(reader.result) });
      }
    };
    reader.onerror = () => fail("could not read that file");
    if (isExcel) reader.readAsArrayBuffer(file);
    else reader.readAsText(file);
  });

  chatInput.focus();
}
