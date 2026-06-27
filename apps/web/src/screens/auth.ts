import type { App } from "../app.js";
import { wire } from "../dom.js";

/**
 * Auth gate — a "secure shell" card. Phase 1 is a stub: both buttons just advance
 * to onboarding. Phase 2 wires Firebase Auth (email/pass + Google) behind these.
 */
export function renderAuth(app: App): void {
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
        <div style="font-size:12px;color:#7b5cff;letter-spacing:3px;font-weight:700;">CANCRI</div>
        <div style="font-size:11px;color:#39424f;margin-top:2px;letter-spacing:1px;">live-portfolio-terminal · v0.4</div>
        <div style="margin-top:24px;font-size:13px;color:#6b7787;">&gt; identify yourself to mount your book</div>
        <div style="margin-top:16px;display:flex;flex-direction:column;gap:10px;">
          <div style="display:flex;align-items:center;gap:10px;border:1px solid #1a2130;background:#070a0f;border-radius:7px;padding:11px 13px;">
            <span style="color:#39424f;font-size:12px;">user@</span>
            <span style="color:#d7dee8;font-size:13px;">trader</span>
            <span style="margin-left:auto;color:#39424f;font-size:11px;">login</span>
          </div>
          <div style="display:flex;align-items:center;gap:10px;border:1px solid #1a2130;background:#070a0f;border-radius:7px;padding:11px 13px;">
            <span style="color:#39424f;font-size:12px;">passphrase</span>
            <span style="color:#6b7787;font-size:13px;letter-spacing:2px;">••••••••••</span>
            <span style="display:inline-block;width:7px;height:13px;background:#36f9d0;margin-left:1px;animation:caret 1s steps(1) infinite;"></span>
          </div>
          <button data-action="connect" style="margin-top:6px;cursor:pointer;font-size:13px;font-weight:700;letter-spacing:1px;color:#05070b;background:#36f9d0;border:none;border-radius:7px;padding:12px;box-shadow:0 0 22px -4px #36f9d0aa;">[ ↵ connect ]</button>
          <button data-action="connect" style="cursor:pointer;font-size:12px;color:#7b5cff;background:transparent;border:1px solid #241d44;border-radius:7px;padding:10px;">continue with Google ⟶ firebase</button>
        </div>
        <div style="margin-top:18px;font-size:10.5px;color:#39424f;display:flex;align-items:center;gap:6px;">
          <span style="width:6px;height:6px;border-radius:50%;background:#36f9d0;box-shadow:0 0 8px #36f9d0;animation:pulseLive 1.8s ease-in-out infinite;"></span>
          secured by firebase auth · session encrypted
        </div>
      </div>
    </div>
  </div>`;

  wire(app.root, { connect: () => app.goScreen("onboard") });
}
