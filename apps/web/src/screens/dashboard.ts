import type { App } from "../app.js";
import type { DemoPosition } from "../state.js";
import {
  canonicalQuantity,
  commodityFor,
  domainForSymbol,
  monogramInitials,
  type Commodity,
  type LogoResult,
} from "@cancri/data-contracts";
import { pct, clockString } from "../format.js";
import { CURRENCIES, fmtMoney0, fmtPrice } from "../currency.js";
import { spark } from "../sparkline.js";
import { openAddModal } from "./add-modal.js";

// logo | instrument | qty(+unit) | last | dayΔ | day% | trend | position | feed | actions
const COLS = "44px 1.5fr 132px 96px 110px 78px 128px 110px 86px 34px";
const UP = "#36f9d0";
const DOWN = "#ff5277";
const WARN = "#ffd23f";

interface RowRef {
  readonly id: string;
  /** Quantity in the commodity's canonical (priced) unit, else the raw count. */
  readonly valueQty: number;
  readonly priceEl: HTMLElement;
  readonly chgEl: HTMLElement;
  readonly pctEl: HTMLElement;
  readonly valEl: HTMLElement;
  readonly sparkLine: SVGPolylineElement;
  readonly sparkArea: SVGPolylineElement;
  readonly sparkHead: SVGCircleElement;
}

/** Trim float noise from a converted quantity for display/editing. */
const fmtQty = (n: number): string => String(Math.round(n * 1e4) / 1e4);

/**
 * The dashboard. Built once per dashState (cold); the rAF loop calls `update()`
 * each frame to mutate only the numeric hot cells. Everything constant within a
 * mount — freshness, connection master, logos, banners, footer live/delayed
 * counts — is rendered statically here (ADR-0011 hot/cold split).
 *
 * The book is editable in place: quantities and (for commodities) units are
 * adjustable, holdings are removable, and "+ add" overlays the intake popup —
 * all without tearing down the warm feed.
 */
export class Dashboard {
  private readonly rows: RowRef[] = [];
  private totalEl!: HTMLElement;
  private totalChgEl!: HTMLElement;
  private clockEl: HTMLElement | null = null;
  private ticksEl: HTMLElement | null = null;
  private latencyEl: HTMLElement | null = null;

  constructor(private readonly app: App) {
    this.mount();
  }

  private degraded(): boolean {
    return this.app.dashState === "degraded";
  }
  private frozen(): boolean {
    return this.app.dashState === "closed";
  }

  private effFresh(id: string): "live" | "delayed" {
    if (this.degraded()) return "delayed";
    return this.app.hot.fresh.get(id) ?? "live";
  }

  // ---- logo tiles (ADR-0014) ----

  private shimmerTile(): string {
    return `<div style="width:28px;height:28px;border-radius:7px;background:linear-gradient(90deg,#0d121b,#1a2130,#0d121b);background-size:240px 100%;animation:shimmer 1.1s linear infinite;border:1px solid #1a2130;"></div>`;
  }

  private monogramTile(p: DemoPosition): string {
    const style =
      "width:28px;height:28px;border-radius:7px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;letter-spacing:.3px;flex-shrink:0;" +
      `background:#0d121b;border:1px solid ${p.accent}66;color:${p.accent};`;
    return `<div style="${style}">${monogramInitials(p.symbol)}</div>`;
  }

  private imgTile(url: string): string {
    return `<img src="${url}" width="28" height="28" alt="" style="width:28px;height:28px;border-radius:7px;object-fit:cover;background:#0d121b;border:1px solid #1a2130;display:block;flex-shrink:0;" />`;
  }

  /** Initial tile: a known logo paints immediately, a resolvable one shimmers
   *  until `resolveLogos` swaps it in, everything else is a monogram. */
  private logoTile(p: DemoPosition): string {
    const cached = this.app.logoCache.get(p.symbol);
    if (cached?.state === "resolved") return this.imgTile(cached.url);
    const willResolve = (p.domain ?? domainForSymbol(p.symbol)) !== undefined && cached === undefined;
    if (willResolve || p.logoState === "loading") return this.shimmerTile();
    return this.monogramTile(p);
  }

  /** Kick off resolution for any uncached row with a domain, then paint the result
   *  in place — a verified image (preloaded to avoid a broken flash) or a monogram. */
  private resolveLogos(): void {
    for (const p of this.app.inventory) {
      const domain = p.domain ?? domainForSymbol(p.symbol);
      if (domain === undefined || this.app.logoCache.has(p.symbol)) continue;
      void this.app.resolveLogo(p.symbol, domain).then((res) => this.paintLogo(p, res));
    }
  }

  private paintLogo(p: DemoPosition, res: LogoResult | null): void {
    const slot = this.app.root.querySelector<HTMLElement>(`[data-id="${p.isin}"] .logo`);
    if (slot === null) return;
    if (res?.state === "resolved") {
      const img = new Image();
      img.onload = (): void => {
        slot.innerHTML = this.imgTile(res.url);
      };
      img.src = res.url; // monogram/shimmer stays until the image is known-good
    } else {
      slot.innerHTML = this.monogramTile(p);
    }
  }

  // ---- rows ----

  private qtyCell(p: DemoPosition, c: Commodity | undefined): string {
    const inputStyle =
      "width:100%;min-width:0;text-align:right;font-family:inherit;font-size:12px;font-weight:600;color:#eef3fa;border:1px solid #1a2130;background:#070a0f;border-radius:5px;padding:3px 7px;outline:none;font-variant-numeric:tabular-nums;";
    const input = `<input data-qty="${p.isin}" value="${fmtQty(p.quantity)}" inputmode="decimal" title="quantity" style="${inputStyle}" />`;
    if (!c) return `<div style="display:flex;justify-content:flex-end;">${input}</div>`;
    const cur = p.unit ?? c.canonicalUnit;
    const selStyle =
      "cursor:pointer;font-family:inherit;font-size:10.5px;font-weight:700;color:#9aa6b4;background:#0d121b;border:1px solid #1a2130;border-radius:5px;padding:3px 4px;outline:none;flex-shrink:0;";
    const opts = c.units
      .map((u) => `<option value="${u.id}"${u.id === cur ? " selected" : ""}>${u.label}</option>`)
      .join("");
    return `<div style="display:flex;gap:4px;justify-content:flex-end;align-items:center;"><div style="flex:1;min-width:0;">${input}</div><select data-unit="${p.isin}" title="unit" style="${selStyle}">${opts}</select></div>`;
  }

  private rowHtml(p: DemoPosition): string {
    const fresh = this.effFresh(p.isin);
    const isLive = fresh === "live";
    const fColor = isLive ? UP : WARN;
    const reduce = this.app.reduce;
    const c = commodityFor(p.symbol);
    const freshDot = `width:7px;height:7px;border-radius:50%;background:${fColor};box-shadow:0 0 8px ${fColor};${reduce ? "" : `animation:${isLive ? "pulseLive 1.8s" : "pulseDelayed 2.6s"} ease-in-out infinite;`}`;
    const rowStyle = `display:grid;grid-template-columns:${COLS};gap:10px;align-items:center;padding:9px 18px;border-bottom:1px solid #10151e;`;
    const priceBase =
      "text-align:right;align-self:center;font-size:13px;font-weight:700;color:#eef3fa;padding:6px 8px;border-radius:5px;background:transparent;font-variant-numeric:tabular-nums;";
    return `
    <div data-id="${p.isin}" style="${rowStyle}">
      <div class="logo" style="display:flex;align-items:center;">${this.logoTile(p)}</div>
      <div style="display:flex;flex-direction:column;justify-content:center;line-height:1.25;min-width:0;">
        <span style="color:#eef3fa;font-size:13px;font-weight:600;letter-spacing:.3px;">${p.symbol}</span>
        <span style="color:#6b7787;font-size:10.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${p.name}</span>
      </div>
      ${this.qtyCell(p, c)}
      <div class="px" style="${priceBase}">—</div>
      <div class="chg" style="text-align:right;align-self:center;font-size:12px;font-weight:600;display:flex;align-items:center;justify-content:flex-end;gap:4px;"></div>
      <div class="pct" style="text-align:right;align-self:center;font-size:12px;font-weight:600;"></div>
      <div style="display:flex;align-items:center;justify-content:center;">
        <svg width="116" height="32" viewBox="0 0 148 32" preserveAspectRatio="none" style="display:block;overflow:visible;">
          <polyline class="sa" points="" fill="none" stroke="none"></polyline>
          <polyline class="sl" points="" fill="none" stroke="${UP}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"></polyline>
          <circle class="sh" cx="0" cy="0" r="2" fill="${UP}"></circle>
        </svg>
      </div>
      <div class="val" style="text-align:right;align-self:center;color:#d7dee8;font-size:12.5px;font-weight:600;">—</div>
      <div style="display:flex;align-items:center;justify-content:center;gap:6px;">
        <span style="${freshDot}"></span>
        <span style="font-size:9.5px;font-weight:700;letter-spacing:1px;color:${fColor};">${isLive ? "LIVE" : "DELAYED"}</span>
      </div>
      <div style="display:flex;align-items:center;justify-content:center;">
        <button data-remove="${p.isin}" title="remove ${p.symbol}" style="cursor:pointer;font-family:inherit;font-size:13px;line-height:1;color:#5b6675;background:transparent;border:1px solid #1a2130;border-radius:6px;padding:3px 6px;">✕</button>
      </div>
    </div>`;
  }

  private mount(): void {
    const app = this.app;
    const inv = app.inventory;
    const ds = app.dashState;

    const degraded = this.degraded();
    const closed = ds === "closed";
    const isEmpty = ds === "empty";
    const isError = ds === "error";
    const isReconnect = ds === "reconnect";
    const showTable = !isEmpty && !isError;

    // live/delayed counts are constant within a mount
    let live = 0;
    let delayed = 0;
    for (const p of inv) (this.effFresh(p.isin) === "live" ? live++ : delayed++);

    const connColor = degraded ? WARN : UP;
    const connDot = `width:9px;height:9px;border-radius:50%;background:${connColor};box-shadow:0 0 10px ${connColor};${app.reduce ? "" : `animation:${degraded ? "pulseDelayed 2.6s" : "pulseLive 1.8s"} ease-in-out infinite;`}`;
    const connLabel = degraded ? "DELAYED" : "LIVE";
    const connSub = degraded ? "fallback · ~15m lag" : "primary · realtime";

    const banner = this.bannerHtml(degraded, closed);
    const colHead = `display:grid;grid-template-columns:${COLS};gap:10px;padding:8px 18px;font-size:9.5px;letter-spacing:1px;color:#39424f;border-bottom:1px solid #1a2130;background:#0b0f16;position:sticky;top:0;z-index:1;`;

    const ccyOpts = CURRENCIES.map(
      (c) => `<option value="${c.code}"${c.code === app.currency ? " selected" : ""}>${c.code}</option>`,
    ).join("");

    let body = "";
    if (isEmpty) {
      body = `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;">
        <div style="font-size:40px;color:#222b3b;">▢</div>
        <div style="font-size:14px;color:#6b7787;">no instruments loaded. the terminal is hungry.</div>
        <button data-action="feed" style="cursor:pointer;font-size:13px;font-weight:700;color:#05070b;background:#36f9d0;border:none;border-radius:8px;padding:11px 20px;">[ + feed the terminal ]</button>
      </div>`;
    } else if (isError) {
      body = `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;">
        <div style="font-size:34px;color:#ff5277;text-shadow:0 0 22px #ff527766;">⚠</div>
        <div style="font-size:14px;color:#ff8aa0;">feed error — could not reach primary source.</div>
        <div style="font-size:11px;color:#6b7787;">socket closed · code 1006 · last good tick 00:41 ago</div>
        <button data-action="retry" style="cursor:pointer;font-size:13px;font-weight:700;color:#05070b;background:#ffd23f;border:none;border-radius:8px;padding:11px 20px;">↻ retry handshake</button>
      </div>`;
    } else {
      const head = `<div style="${colHead}"><div></div><div>INSTRUMENT</div><div style="text-align:right;">QTY</div><div style="text-align:right;">LAST</div><div style="text-align:right;">DAY Δ</div><div style="text-align:right;">DAY %</div><div style="text-align:center;">5M TREND</div><div style="text-align:right;">POSITION</div><div style="text-align:center;">FEED</div><div></div></div>`;
      body = `<div style="flex:1;overflow:auto;position:relative;">${head}${inv.map((p) => this.rowHtml(p)).join("")}</div>`;
    }

    const overlay = isReconnect
      ? `<div style="position:absolute;inset:0;background:#05070bcc;backdrop-filter:blur(2px);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;z-index:6;">
          <div style="width:30px;height:30px;border:3px solid #1a2130;border-top-color:#ffd23f;border-radius:50%;animation:spin .8s linear infinite;"></div>
          <div style="font-size:14px;color:#ffd23f;">reconnecting to primary feed…</div>
          <div style="font-size:11px;color:#6b7787;letter-spacing:2px;">▰▰▰▰▱▱▱  attempt ${app.feed.reconnectAttempt ?? 2}/${app.feed.maxReconnectAttempts ?? 5}</div>
          <div style="font-size:10.5px;color:#39424f;">holding last quotes · dashboard stays warm</div>
        </div>`
      : "";

    app.root.innerHTML = `
    <div style="position:absolute;inset:0;z-index:2;display:flex;flex-direction:column;background:#070a0f;">
      <div style="display:flex;align-items:stretch;border-bottom:1px solid #1a2130;background:#0b0f16;">
        <div style="display:flex;align-items:center;gap:10px;padding:14px 20px;border-right:1px solid #1a2130;">
          <img src="/cancri-logo-mark.png" alt="cancri" width="24" height="24" style="border-radius:50%;filter:drop-shadow(0 0 8px #7b5cff55);" />
          <span style="color:#7b5cff;font-weight:800;letter-spacing:2px;font-size:14px;">CANCRI</span>
          <span style="font-size:10px;color:#39424f;border:1px solid #1a2130;border-radius:4px;padding:2px 5px;">LPT</span>
        </div>
        <div style="display:flex;flex-direction:column;justify-content:center;padding:9px 22px;border-right:1px solid #1a2130;">
          <div style="font-size:10px;color:#6b7787;letter-spacing:1.5px;">PORTFOLIO VALUE</div>
          <div class="total" style="font-size:23px;font-weight:700;color:#eef3fa;letter-spacing:.5px;text-shadow:0 0 18px #5ec6ff22;">—</div>
        </div>
        <div style="display:flex;flex-direction:column;justify-content:center;padding:9px 22px;border-right:1px solid #1a2130;">
          <div style="font-size:10px;color:#6b7787;letter-spacing:1.5px;">DAY CHANGE</div>
          <div class="totalchg" style="font-size:14px;font-weight:700;display:flex;align-items:center;gap:6px;"></div>
        </div>
        <div style="flex:1;"></div>
        <div style="display:flex;align-items:center;gap:8px;padding:9px 14px;border-left:1px solid #1a2130;">
          <span style="font-size:9.5px;color:#6b7787;letter-spacing:1px;">CCY</span>
          <select class="ccy" title="display currency · indicative FX" style="cursor:pointer;font-family:inherit;font-size:11.5px;font-weight:700;color:#d7dee8;background:#0d121b;border:1px solid #1a2130;border-radius:6px;padding:5px 7px;outline:none;">${ccyOpts}</select>
        </div>
        <div style="display:flex;align-items:center;padding:0 16px;border-left:1px solid #1a2130;">
          <button class="addbtn" title="add holdings" style="cursor:pointer;font-family:inherit;font-size:11.5px;font-weight:700;letter-spacing:.5px;color:#36f9d0;background:transparent;border:1px solid #1a3a33;border-radius:7px;padding:7px 13px;">+ add</button>
        </div>
        <div style="display:flex;align-items:center;gap:9px;padding:9px 18px;border-left:1px solid #1a2130;">
          <span style="${connDot}"></span>
          <div style="display:flex;flex-direction:column;line-height:1.25;">
            <span style="font-size:11px;font-weight:700;letter-spacing:1px;color:${connColor};">${connLabel}</span>
            <span style="font-size:9.5px;color:#39424f;">${connSub}</span>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;justify-content:center;padding:9px 20px;border-left:1px solid #1a2130;">
          <div style="font-size:10px;color:#6b7787;letter-spacing:1.5px;text-align:right;">${closed ? "CLOSED · ET" : "MARKET · ET"}</div>
          <div class="clock" style="font-size:16px;font-weight:600;color:#d7dee8;text-align:right;letter-spacing:1px;">--:--:--</div>
        </div>
      </div>
      ${banner}
      ${body}
      ${overlay}
      <div style="display:flex;align-items:center;gap:18px;padding:8px 20px;border-top:1px solid #1a2130;background:#0b0f16;font-size:10.5px;color:#6b7787;">
        <span><span style="color:#36f9d0;">${live}</span> live</span>
        <span><span style="color:#ffd23f;">${delayed}</span> delayed</span>
        <span style="color:#39424f;">·</span>
        <span>${inv.length} positions</span>
        <span style="margin-left:auto;color:#39424f;">ticks <span class="ticks">${app.feed.ticks}</span> · latency <span class="lat">${app.feed.latencyMs}</span>ms · ${app.feed.feedNote}</span>
      </div>
    </div>`;

    // cache hot refs
    this.totalEl = app.root.querySelector<HTMLElement>(".total")!;
    this.totalChgEl = app.root.querySelector<HTMLElement>(".totalchg")!;
    this.clockEl = app.root.querySelector<HTMLElement>(".clock");
    this.ticksEl = app.root.querySelector<HTMLElement>(".ticks");
    this.latencyEl = app.root.querySelector<HTMLElement>(".lat");
    this.rows.length = 0;
    if (showTable) {
      for (const p of inv) {
        const rowEl = app.root.querySelector<HTMLElement>(`[data-id="${p.isin}"]`);
        if (!rowEl) continue;
        const c = commodityFor(p.symbol);
        this.rows.push({
          id: p.isin,
          valueQty: c ? canonicalQuantity(c, p.quantity, p.unit) : p.quantity,
          priceEl: rowEl.querySelector<HTMLElement>(".px")!,
          chgEl: rowEl.querySelector<HTMLElement>(".chg")!,
          pctEl: rowEl.querySelector<HTMLElement>(".pct")!,
          valEl: rowEl.querySelector<HTMLElement>(".val")!,
          sparkLine: rowEl.querySelector<SVGPolylineElement>(".sl")!,
          sparkArea: rowEl.querySelector<SVGPolylineElement>(".sa")!,
          sparkHead: rowEl.querySelector<SVGCircleElement>(".sh")!,
        });
      }
    }

    this.wire();
    if (showTable) this.resolveLogos();
  }

  /** Bind header controls and per-row edit controls. */
  private wire(): void {
    const app = this.app;

    app.root.querySelector<HTMLButtonElement>(".addbtn")?.addEventListener("click", () => openAddModal(app));
    app.root.querySelector<HTMLSelectElement>(".ccy")?.addEventListener("change", (e) => {
      app.setCurrency((e.target as HTMLSelectElement).value);
    });

    // body buttons (empty/error states)
    app.root.querySelectorAll<HTMLElement>("[data-action]").forEach((el) => {
      const a = el.dataset["action"];
      if (a === "feed") el.addEventListener("click", () => app.goScreen("onboard"));
      if (a === "retry") el.addEventListener("click", () => app.goState("normal"));
    });

    // per-row remove
    app.root.querySelectorAll<HTMLButtonElement>("[data-remove]").forEach((btn) => {
      btn.addEventListener("click", () => app.removePosition(btn.dataset["remove"]!));
    });

    // per-row quantity edit — commit on change (blur/Enter), not per keystroke
    app.root.querySelectorAll<HTMLInputElement>("[data-qty]").forEach((inp) => {
      const commit = (): void => app.setQuantity(inp.dataset["qty"]!, Number.parseFloat(inp.value));
      inp.addEventListener("change", commit);
      inp.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") inp.blur();
      });
    });

    // per-row unit switch (commodities)
    app.root.querySelectorAll<HTMLSelectElement>("[data-unit]").forEach((sel) => {
      sel.addEventListener("change", () => app.setUnit(sel.dataset["unit"]!, sel.value));
    });
  }

  private bannerHtml(degraded: boolean, closed: boolean): string {
    const base =
      "display:flex;align-items:center;gap:10px;padding:9px 20px;font-size:12px;font-weight:600;letter-spacing:.3px;";
    if (degraded) {
      return `<div style="${base}background:#2a2306;color:#ffd23f;border-bottom:1px solid #4a3d0a;"><span style="width:8px;height:8px;border-radius:50%;background:#ffd23f;box-shadow:0 0 8px #ffd23f;"></span>PRIMARY SOURCE LOST — showing DELAYED quotes. dashboard stays warm; values may lag ~15 min.</div>`;
    }
    if (closed) {
      return `<div style="${base}background:#10131c;color:#7b8aa3;border-bottom:1px solid #1a2130;"><span style="width:8px;height:8px;border-radius:50%;background:#7b5cff;"></span>MARKET CLOSED — last close shown. live ticks resume at next open (09:30 ET).</div>`;
    }
    return "";
  }

  /** Per-frame hot update — numeric cells only. */
  update(): void {
    const app = this.app;
    const hot = app.hot;
    const reduce = app.reduce;
    const frozen = this.frozen();
    const now = app.now();
    const ccy = app.currency;

    let total = 0;
    let totalPrev = 0;

    for (const r of this.rows) {
      const price = hot.price.get(r.id) ?? 0;
      const prevClose = hot.prev.get(r.id) ?? price;
      const dp = frozen ? price : (hot.disp.get(r.id) ?? price);
      total += r.valueQty * price;
      totalPrev += r.valueQty * prevClose;

      const chgAbs = price - prevClose;
      const up = chgAbs >= 0;
      const col = up ? UP : DOWN;
      const chgPct = prevClose !== 0 ? (chgAbs / prevClose) * 100 : 0;

      // price + directional flash background
      r.priceEl.textContent = fmtPrice(dp, ccy);
      let bg = "transparent";
      const fl = hot.flash.get(r.id);
      if (fl && !reduce && !frozen) {
        const a = Math.max(0, 1 - (now - fl.t) / 650);
        const rgb = fl.dir === "up" ? "54,249,208" : "255,82,119";
        bg = `rgba(${rgb},${(a * 0.16).toFixed(3)})`;
      }
      r.priceEl.style.background = bg;

      r.chgEl.style.color = col;
      r.chgEl.innerHTML = `<span style="font-size:10px;">${up ? "▲" : "▼"}</span> ${up ? "+" : "−"}${fmtPrice(Math.abs(chgAbs), ccy)}`;
      r.pctEl.style.color = col;
      r.pctEl.textContent = pct(chgPct);
      r.valEl.textContent = fmtMoney0(r.valueQty * price, ccy);

      const series = hot.series.get(r.id);
      if (series && series.length > 0) {
        const sp = spark(series);
        r.sparkLine.setAttribute("points", sp.pts);
        r.sparkLine.setAttribute("stroke", col);
        r.sparkArea.setAttribute("points", sp.area);
        r.sparkArea.setAttribute("fill", up ? "#36f9d014" : "#ff527714");
        r.sparkHead.setAttribute("cx", sp.hx.toFixed(1));
        r.sparkHead.setAttribute("cy", sp.hy.toFixed(1));
        r.sparkHead.setAttribute("fill", col);
      }
    }

    // header aggregate
    const tChg = total - totalPrev;
    const tPct = totalPrev !== 0 ? (tChg / totalPrev) * 100 : 0;
    const tUp = tChg >= 0;
    this.totalEl.textContent = fmtMoney0(total, ccy);
    this.totalChgEl.style.color = tUp ? UP : DOWN;
    this.totalChgEl.style.textShadow = `0 0 14px ${tUp ? UP : DOWN}33`;
    this.totalChgEl.innerHTML = `<span>${tUp ? "▲" : "▼"}</span> ${tUp ? "+" : "−"}${fmtMoney0(Math.abs(tChg), ccy)} <span style="opacity:.8;">(${pct(tPct)})</span>`;

    if (this.clockEl) this.clockEl.textContent = frozen ? "16:00:00" : clockString(new Date());
    if (this.ticksEl) this.ticksEl.textContent = String(app.feed.ticks);
    if (this.latencyEl) this.latencyEl.textContent = String(app.feed.latencyMs);
  }
}
