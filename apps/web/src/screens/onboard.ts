import type { App } from "../app.js";
import type { ProposedPosition } from "@cancri/data-contracts";
import { DEFAULT_CHAT } from "../fixtures.js";
import type { NormalizeInput } from "../functions-client.js";

const TOPBAR =
  "display:flex;align-items:center;gap:10px;padding:13px 20px;border-bottom:1px solid #1a2130;background:#0b0f16;font-size:12px;";

const ACCENT_USER = "#5ec6ff";
const ACCENT_BOT = "#7b5cff";
const TERMINAL = "#36f9d0";
const WARN = "#ff8fa3";

/**
 * Turn a failed normalise callable into a message that names the actual cause,
 * instead of always blaming a missing backend. Firebase callables reject with a
 * FirebaseError carrying a `functions/*` code; surface it so a misconfiguration
 * (not signed in, callable not deployed, emulator down) is distinguishable.
 */
function describeNormalizeError(e: unknown): string {
  const code = typeof e === "object" && e !== null ? (e as { code?: unknown }).code : undefined;
  switch (code) {
    case "functions/unauthenticated":
      return "you're signed out — sign in again, then retry.";
    case "functions/not-found":
      return "normalisation backend isn't deployed/running (callable not found).";
    case "functions/permission-denied":
      return "normalisation was rejected — your account isn't permitted.";
    case "functions/internal":
    case "functions/unavailable":
      return "couldn't reach the normalisation backend — is it running?";
    default: {
      const msg =
        typeof e === "object" && e !== null ? (e as { message?: unknown }).message : undefined;
      const suffix =
        typeof code === "string" ? ` [${code}]` : typeof msg === "string" ? ` (${msg})` : "";
      return `normalisation failed${suffix}.`;
    }
  }
}

/** A chat bubble's mutable parts: the text node to stream into and its caret. */
interface Bubble {
  readonly txt: HTMLSpanElement;
  readonly caret: HTMLSpanElement;
}

/** Append a chat bubble matching the design's two-tone styling; returns the
 *  text/caret handles so the assistant reply can be streamed in afterwards. */
function appendBubble(thread: HTMLElement, role: "user" | "bot"): Bubble {
  const me = role === "user";
  const wrap = document.createElement("div");
  wrap.style.cssText = `display:flex;flex-direction:column;gap:4px;align-items:${me ? "flex-end" : "flex-start"};`;

  const who = document.createElement("div");
  who.style.cssText = `font-size:9.5px;letter-spacing:1px;color:${me ? ACCENT_USER : ACCENT_BOT};`;
  who.textContent = me ? "you" : "portfolio assistant";

  const bubble = document.createElement("div");
  bubble.style.cssText =
    "max-width:78%;font-size:12.5px;line-height:1.55;padding:10px 13px;border-radius:9px;" +
    (me
      ? "background:#0c1a26;border:1px solid #173042;color:#cfe6f5;"
      : "background:#0f0b1e;border:1px solid #241d44;color:#d7dee8;");

  const txt = document.createElement("span");
  const caret = document.createElement("span");
  // The same block caret the boot screen uses — terminal-green, blinking.
  caret.style.cssText = `display:none;width:7px;height:13px;background:${TERMINAL};margin-left:2px;vertical-align:-2px;animation:caret 1s steps(1) infinite;box-shadow:0 0 8px ${TERMINAL};`;
  bubble.append(txt, caret);

  wrap.append(who, bubble);
  thread.append(wrap);
  return { txt, caret };
}

/** Type `full` into a bubble one character at a time — the terminal stream. With
 *  reduced motion the whole string lands at once. Resolves when the text is in. */
function streamText(
  b: Bubble,
  full: string,
  reduce: boolean,
  scroll: () => void,
): Promise<void> {
  return new Promise((resolve) => {
    if (reduce) {
      b.txt.textContent = full;
      scroll();
      resolve();
      return;
    }
    b.caret.style.display = "inline-block";
    let i = 0;
    const tick = (): void => {
      i = Math.min(full.length, i + 1);
      b.txt.textContent = full.slice(0, i);
      scroll();
      if (i < full.length) window.setTimeout(tick, 15);
      else resolve();
    };
    tick();
  });
}

/** A terminal-style précis of the proposal, streamed back as the assistant reply. */
function summarise(proposal: readonly ProposedPosition[]): string {
  const n = proposal.length;
  if (n === 0) {
    return 'couldn\'t read any holdings there — try naming them, e.g. "12 AAPL, 0.5 BTC, 100 MSFT".';
  }
  const head = `parsed ${n} instrument${n === 1 ? "" : "s"}.`;
  const flagged = proposal.filter((p) => p.confidence < 0.7);
  const tail = "opening the proposal to review before anything goes live…";
  if (flagged.length === 0) return `${head} all clear — ${tail}`;
  const syms = flagged.map((p) => p.symbol).join(", ");
  return `${head} ${flagged.length} need${flagged.length === 1 ? "s" : ""} your eye → ${syms}. ${tail}`;
}

/**
 * Onboarding intake (brief §B). Both routes — the chat input and the file drop —
 * converge on the same server-side normalisation; the assistant streams its reply
 * back into the thread (terminal animation) before the proposal screen opens.
 */
export function renderOnboard(app: App): void {
  app.root.innerHTML = `
  <div style="position:absolute;inset:0;z-index:3;display:flex;flex-direction:column;">
    <div style="${TOPBAR}">
      <img src="/cancri-logo-mark.png" alt="cancri" width="22" height="22" style="border-radius:50%;filter:drop-shadow(0 0 7px #7b5cff55);" />
      <span style="color:#7b5cff;font-weight:700;letter-spacing:2px;">CANCRI</span>
      <span style="color:#39424f;">/</span>
      <span style="color:#6b7787;">onboarding · feed the terminal</span>
      <span style="margin-left:auto;color:#39424f;font-size:11px;">step 1 — describe or drop</span>
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
        <div style="font-size:10.5px;color:#39424f;line-height:1.7;">↳ next: the assistant normalises your input into a structured inventory. <span style="color:#7b5cff;">the machine proposes — you dispose.</span></div>
      </div>
    </div>
  </div>`;

  const thread = app.root.querySelector<HTMLDivElement>("#cc-thread")!;
  const chatInput = app.root.querySelector<HTMLInputElement>("#cc-chat")!;
  const parseBtn = app.root.querySelector<HTMLButtonElement>("#cc-parse")!;
  const fileInput = app.root.querySelector<HTMLInputElement>("#cc-file")!;
  const err = app.root.querySelector<HTMLDivElement>("#cc-onerr")!;

  // Render any seed messages (none by default) through the shared bubble styling.
  for (const m of DEFAULT_CHAT) appendBubble(thread, m.role).txt.textContent = m.text;

  const scroll = (): void => {
    thread.scrollTop = thread.scrollHeight;
  };
  const fail = (m: string): void => {
    err.textContent = m;
    err.style.display = "block";
  };
  let busy = false;
  const setBusy = (b: boolean): void => {
    busy = b;
    parseBtn.disabled = b;
    chatInput.disabled = b;
    fileInput.disabled = b;
    parseBtn.textContent = b ? "parsing…" : "parse ↵";
  };

  const submit = async (input: NormalizeInput, echo: string): Promise<void> => {
    if (busy) return;
    err.style.display = "none";
    setBusy(true);

    appendBubble(thread, "user").txt.textContent = echo;
    scroll();
    const reply = appendBubble(thread, "bot");
    reply.caret.style.display = "inline-block"; // thinking…
    scroll();

    try {
      const proposal = await app.normalizeInput(input);
      await streamText(reply, summarise(proposal), app.reduce, scroll);
      reply.caret.style.display = "none";
      if (proposal.length > 0) {
        window.setTimeout(() => app.goScreen("confirm"), app.reduce ? 0 : 500);
      } else {
        setBusy(false);
        chatInput.focus();
      }
    } catch (e) {
      reply.txt.style.color = WARN;
      await streamText(reply, describeNormalizeError(e), app.reduce, scroll);
      reply.caret.style.display = "none";
      setBusy(false);
      chatInput.focus();
    }
  };

  const parseChat = (): void => {
    const content = chatInput.value.trim();
    if (content === "") {
      fail("describe your portfolio first");
      return;
    }
    chatInput.value = "";
    void submit({ kind: "text", content }, content);
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
        void submit({ kind: "xlsx", content: btoa(binary) }, `↑ ${file.name}`);
      } else {
        void submit({ kind: "csv", content: String(reader.result) }, `↑ ${file.name}`);
      }
    };
    reader.onerror = () => fail("could not read that file");
    if (isExcel) reader.readAsArrayBuffer(file);
    else reader.readAsText(file);
  });

  chatInput.focus();
}
