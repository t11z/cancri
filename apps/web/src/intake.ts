import type { App } from "./app.js";
import type { ProposedPosition } from "@cancri/data-contracts";
import type { NormalizeInput } from "./functions-client.js";

/**
 * Shared holdings-intake behaviour (brief §B). The same chat-stream + file-drop
 * pipeline backs two surfaces: the full-screen onboarding (`renderOnboard`) and
 * the compact add-popup on the dashboard. Each builds its own layout, then hands
 * the live elements here so the wiring lives in exactly one place.
 *
 * User-facing copy never says "normalise" — that is our internal term for the
 * pipeline, not language the user should meet (the assistant simply "reads" their
 * portfolio).
 */

const ACCENT_USER = "#5ec6ff";
const ACCENT_BOT = "#7b5cff";
const TERMINAL = "#36f9d0";
const WARN = "#ff8fa3";

/** Turn a failed intake callable into a message that names the actual cause. */
export function describeIntakeError(e: unknown): string {
  const code = typeof e === "object" && e !== null ? (e as { code?: unknown }).code : undefined;
  switch (code) {
    case "functions/unauthenticated":
      return "you're signed out — sign in again, then retry.";
    case "functions/not-found":
      return "the assistant isn't available right now (backend not deployed).";
    case "functions/permission-denied":
      return "your account isn't permitted to add holdings.";
    case "functions/internal":
    case "functions/unavailable":
      return "couldn't reach the assistant — try again in a moment.";
    default: {
      const msg =
        typeof e === "object" && e !== null ? (e as { message?: unknown }).message : undefined;
      const suffix =
        typeof code === "string" ? ` [${code}]` : typeof msg === "string" ? ` (${msg})` : "";
      return `couldn't read that${suffix} — try again.`;
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
export function appendBubble(thread: HTMLElement, role: "user" | "bot"): Bubble {
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
function streamText(b: Bubble, full: string, reduce: boolean, scroll: () => void): Promise<void> {
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

/** The live elements an intake surface must provide. */
export interface IntakeEls {
  readonly thread: HTMLElement;
  readonly chatInput: HTMLInputElement;
  readonly parseBtn: HTMLButtonElement;
  readonly fileInput: HTMLInputElement;
  readonly err: HTMLElement;
}

/**
 * Wire the chat input and file drop to the server-side pipeline. On a non-empty
 * proposal the assistant streams its reply, then we route to the confirm screen
 * (which merges into the existing book). An empty proposal keeps the surface open.
 */
export function wireIntake(app: App, els: IntakeEls): void {
  const { thread, chatInput, parseBtn, fileInput, err } = els;

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
      await streamText(reply, describeIntakeError(e), app.reduce, scroll);
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
}
