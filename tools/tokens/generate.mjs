#!/usr/bin/env node
// Generate design tokens from the handover into apps/web/src/generated/.
// The handover JSON is the single source of truth for colour + motion (ADR-0011);
// this script is the only thing that turns it into code/CSS. Never hand-edit the
// generated files — re-run `pnpm tokens` instead.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const handoverPath = resolve(repoRoot, "design/cancri.handover.json");
const outDir = resolve(repoRoot, "apps/web/src/generated");

const handover = JSON.parse(readFileSync(handoverPath, "utf8"));
const c = handover.tokens.color;
const d = handover.tokens.motion.duration_ms;

const color = {
  app: c.bg.app,
  surface: c.bg.surface,
  panel: c.bg.panel,
  panelRaised: c.bg.panel_raised,
  input: c.bg.input,
  rowAltFlagged: c.bg.row_alt_flagged,
  hairline: c.line.hairline,
  border: c.line.border,
  borderStrong: c.line.border_strong,
  textPrimary: c.text.primary,
  textBody: c.text.body,
  textMuted: c.text.muted,
  textDim: c.text.dim,
  textFaint: c.text.faint,
  textGhost: c.text.ghost,
  up: c.accent.up.hex,
  down: c.accent.down.hex,
  info: c.accent.info.hex,
  warn: c.accent.warn.hex,
  cyan: c.accent.cyan.hex,
};

// Numeric motion durations straight from the handover; the rAF tween factor is a
// motion_spec constant (number_roll: "ease factor 0.16/frame").
const motion = {
  flashMs: d.flash,
  pulseLiveMs: d.pulse_live,
  pulseDelayedMs: d.pulse_delayed,
  shimmerMs: d.shimmer,
  spinnerMs: d.spinner,
  bootLineMs: d.boot_line,
  bootStaggerMs: d.boot_stagger,
  flashBgTransitionMs: d.flash_bg_transition,
  caretMs: d.caret_blink,
  numberRollLerp: 0.16,
};

const kebab = (s) => s.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());

const cssVars = Object.entries(color)
  .map(([k, v]) => `  --c-${kebab(k)}: ${v};`)
  .join("\n");

const cssMotion = Object.entries(motion)
  .filter(([k]) => k !== "numberRollLerp")
  .map(([k, v]) => `  --m-${kebab(k)}: ${v}ms;`)
  .join("\n");

// Keyframes are part of the handover's motion language; pinned to the reference build.
const keyframes = `@keyframes pulseLive { 0%, 100% { opacity: .35; transform: scale(.85); } 50% { opacity: 1; transform: scale(1.15); } }
@keyframes pulseDelayed { 0%, 55%, 100% { opacity: .45; } 60% { opacity: 1; } }
@keyframes shimmer { 0% { background-position: -120px 0; } 100% { background-position: 120px 0; } }
@keyframes caret { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }
@keyframes bootline { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }
@keyframes spin { to { transform: rotate(360deg); } }`;

const css = `/* AUTO-GENERATED from design/cancri.handover.json by tools/tokens. Do not edit. */
:root {
${cssVars}
${cssMotion}
}

${keyframes}
`;

const tsLines = [
  "// AUTO-GENERATED from design/cancri.handover.json by tools/tokens. Do not edit.",
  "// Re-run `pnpm tokens` after changing the handover.",
  "",
  `export const COLOR = ${JSON.stringify(color, null, 2)} as const;`,
  "",
  `export const MOTION = ${JSON.stringify(motion, null, 2)} as const;`,
  "",
  `export const ACCENT_PALETTE = ${JSON.stringify(c.accent_palette)} as const;`,
  "",
  "export type ColorToken = keyof typeof COLOR;",
  "",
];

mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, "tokens.css"), css);
writeFileSync(resolve(outDir, "tokens.ts"), tsLines.join("\n"));
console.log("tokens: wrote apps/web/src/generated/{tokens.css,tokens.ts}");
