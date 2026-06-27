import type { App } from "../app.js";

/**
 * Access gate (ADR-0012). The user authenticated successfully but their email is
 * not on the invite-allowlist, so no book can be mounted. Honest about the state —
 * this is access-pending, not an error — and offers a way back to the auth gate.
 */
export function renderDenied(app: App): void {
  const email = app.user?.email ?? "your account";

  app.root.innerHTML = `
  <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;z-index:4;">
    <div style="width:460px;max-width:90vw;border:1px solid #1a2130;background:#0b0f16;border-radius:10px;overflow:hidden;box-shadow:0 30px 80px -30px #000;">
      <div style="display:flex;align-items:center;gap:8px;padding:11px 14px;border-bottom:1px solid #1a2130;background:#0d121b;">
        <span style="width:9px;height:9px;border-radius:50%;background:#ff5277;"></span>
        <span style="width:9px;height:9px;border-radius:50%;background:#ffd23f;"></span>
        <span style="width:9px;height:9px;border-radius:50%;background:#36f9d0;"></span>
        <span style="margin-left:8px;font-size:11px;color:#6b7787;letter-spacing:.5px;">cancri@auth — access pending</span>
      </div>
      <div style="padding:30px 28px 26px;">
        <div style="font-size:12px;color:#ffd23f;letter-spacing:3px;font-weight:700;">NOT ON THE ALLOWLIST</div>
        <div style="margin-top:14px;font-size:13px;color:#6b7787;line-height:1.6;">
          &gt; signed in as <span style="color:#d7dee8;">${escapeHtml(email)}</span><br />
          &gt; this terminal is invite-only — your account is not yet authorised to mount a book.<br />
          &gt; ask the operator to add you, then sign in again.
        </div>
        <div style="margin-top:20px;display:flex;flex-direction:column;gap:10px;">
          <button id="cc-signout" style="cursor:pointer;font-size:12px;color:#7b5cff;background:transparent;border:1px solid #241d44;border-radius:7px;padding:10px;">⟵ sign out</button>
        </div>
        <div style="margin-top:18px;font-size:10.5px;color:#39424f;display:flex;align-items:center;gap:6px;">
          <span style="width:6px;height:6px;border-radius:50%;background:#ffd23f;box-shadow:0 0 8px #ffd23f;"></span>
          access gated by firebase auth · invite allowlist
        </div>
      </div>
    </div>
  </div>`;

  const signOutBtn = app.root.querySelector<HTMLButtonElement>("#cc-signout")!;
  signOutBtn.addEventListener("click", () => void app.signOut());
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}
