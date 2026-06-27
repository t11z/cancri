import type { App } from "../app.js";
import { BOOT_LINES } from "../fixtures.js";
import { esc } from "../dom.js";

export function renderBoot(app: App): void {
  const lines = BOOT_LINES.slice(0, app.bootStep)
    .map((ln) => {
      const okStyle = ln.ok ? "color:#36f9d0;" : "display:none;";
      const anim = app.reduce ? "none" : "bootline .35s ease both";
      return (
        `<div style="animation:${anim};">` +
        `<span style="color:#39424f;">${esc(ln.tag)}</span> ${esc(ln.text)}` +
        `<span style="${okStyle}"> ${esc(ln.ok)}</span></div>`
      );
    })
    .join("");

  const caret = app.bootStep >= 6 ? "mounting workspace…" : "booting…";

  app.root.innerHTML = `
  <div style="position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:0 8vw;background:#05070b;z-index:5;">
    <div style="font-size:13px;line-height:1.9;color:#6b7787;max-width:760px;">${lines}</div>
    <div style="margin-top:26px;font-size:13px;color:#36f9d0;text-shadow:0 0 14px #36f9d066;">${esc(caret)}<span style="display:inline-block;width:9px;height:15px;background:#36f9d0;margin-left:3px;vertical-align:-2px;animation:caret 1s steps(1) infinite;box-shadow:0 0 10px #36f9d0;"></span></div>
  </div>`;
}
