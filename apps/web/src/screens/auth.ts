import type { App } from "../app.js";

/**
 * Auth gate — the "secure shell" card, now functional (Phase 2). Email/passphrase
 * (auto-registers on first use) plus Google, both via Firebase Auth. Keeps the
 * handover's terminal aesthetic; the rows hold real inputs.
 */
export function renderAuth(app: App): void {
  const row =
    "display:flex;align-items:center;gap:10px;border:1px solid #1a2130;background:#070a0f;border-radius:7px;padding:11px 13px;";
  const input =
    "flex:1;min-width:0;background:transparent;border:none;outline:none;color:#d7dee8;font-family:inherit;font-size:13px;";

  app.root.innerHTML = `
  <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;z-index:4;">
    <div style="width:460px;max-width:90vw;border:1px solid #1a2130;background:#0b0f16;border-radius:10px;overflow:hidden;box-shadow:0 30px 80px -30px #000;">
      <div style="display:flex;align-items:center;gap:8px;padding:11px 14px;border-bottom:1px solid #1a2130;background:#0d121b;">
        <span style="width:9px;height:9px;border-radius:50%;background:#ff5277;"></span>
        <span style="width:9px;height:9px;border-radius:50%;background:#ffd23f;"></span>
        <span style="width:9px;height:9px;border-radius:50%;background:#36f9d0;"></span>
        <span style="margin-left:8px;font-size:11px;color:#6b7787;letter-spacing:.5px;">cancri@auth — secure shell</span>
      </div>
      <div style="padding:30px 28px 26px;">
        <img src="/cancri-logo-mark.png" alt="cancri" width="88" height="88" style="display:block;margin:0 auto 16px;border-radius:50%;filter:drop-shadow(0 0 26px #7b5cff44);" />
        <div style="font-size:12px;color:#7b5cff;letter-spacing:3px;font-weight:700;">CANCRI</div>
        <div style="font-size:11px;color:#39424f;margin-top:2px;letter-spacing:1px;">live-portfolio-terminal · v0.4</div>
        <div style="margin-top:24px;font-size:13px;color:#6b7787;">&gt; identify yourself to mount your book</div>
        <div style="margin-top:16px;display:flex;flex-direction:column;gap:10px;">
          <div style="${row}">
            <span style="color:#39424f;font-size:12px;">user@</span>
            <input id="cc-email" type="email" autocomplete="username" placeholder="trader@host" style="${input}" />
            <span style="color:#39424f;font-size:11px;">login</span>
          </div>
          <div style="${row}">
            <span style="color:#39424f;font-size:12px;">passphrase</span>
            <input id="cc-pass" type="password" autocomplete="current-password" placeholder="••••••••" style="${input}letter-spacing:2px;" />
          </div>
          <div id="cc-err" style="display:none;color:#ff5277;font-size:11px;letter-spacing:.3px;"></div>
          <button id="cc-connect" style="margin-top:6px;cursor:pointer;font-size:13px;font-weight:700;letter-spacing:1px;color:#05070b;background:#36f9d0;border:none;border-radius:7px;padding:12px;box-shadow:0 0 22px -4px #36f9d0aa;">[ ↵ connect ]</button>
          <button id="cc-google" style="cursor:pointer;font-size:12px;color:#7b5cff;background:transparent;border:1px solid #241d44;border-radius:7px;padding:10px;">continue with Google ⟶ firebase</button>
        </div>
        <div style="margin-top:18px;font-size:10.5px;color:#39424f;display:flex;align-items:center;gap:6px;">
          <span style="width:6px;height:6px;border-radius:50%;background:#36f9d0;box-shadow:0 0 8px #36f9d0;animation:pulseLive 1.8s ease-in-out infinite;"></span>
          secured by firebase auth · session encrypted
        </div>
      </div>
    </div>
  </div>`;

  const email = app.root.querySelector<HTMLInputElement>("#cc-email")!;
  const pass = app.root.querySelector<HTMLInputElement>("#cc-pass")!;
  const err = app.root.querySelector<HTMLDivElement>("#cc-err")!;
  const connectBtn = app.root.querySelector<HTMLButtonElement>("#cc-connect")!;
  const googleBtn = app.root.querySelector<HTMLButtonElement>("#cc-google")!;

  const fail = (m: string): void => {
    err.textContent = m;
    err.style.display = "block";
    connectBtn.disabled = false;
    connectBtn.style.opacity = "1";
  };

  const connect = async (): Promise<void> => {
    err.style.display = "none";
    const e = email.value.trim();
    const p = pass.value;
    if (!e || !p) {
      fail("enter user and passphrase");
      return;
    }
    connectBtn.disabled = true;
    connectBtn.style.opacity = "0.6";
    try {
      await app.signIn(e, p);
    } catch (ex) {
      fail(authMessage(ex));
    }
  };

  connectBtn.addEventListener("click", () => void connect());
  pass.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") void connect();
  });
  googleBtn.addEventListener("click", () => {
    err.style.display = "none";
    void app.signInGoogle().catch((ex: unknown) => fail(authMessage(ex)));
  });
  email.focus();
}

function authMessage(ex: unknown): string {
  const code = (ex as { code?: string }).code ?? "";
  if (code.includes("invalid-credential") || code.includes("wrong-password")) return "wrong passphrase";
  if (code.includes("invalid-email")) return "invalid user — use an email address";
  if (code.includes("weak-password")) return "passphrase too weak — min 6 characters";
  if (code.includes("popup-closed") || code.includes("cancelled")) return "google sign-in cancelled";
  if (code.includes("network")) return "network error reaching firebase auth";
  return "auth failed — see the console";
}
