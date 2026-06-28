import { SimSource, type SimScenario } from "@cancri/sim-source";
import {
  commodityFor,
  convertQuantity,
  type FeedStatus,
  type LogoResult,
  type Position,
  type ProposedPosition,
  type Tick,
} from "@cancri/data-contracts";
import {
  emptyHot,
  SPARK_LEN,
  type DashState,
  type DemoPosition,
  type HotState,
  type Screen,
} from "./state.js";
import { buildDemoInventory } from "./fixtures.js";
import { demoToPositions, positionsToDemo, simSeedsFromInventory } from "./inventory.js";
import { seedSeries } from "./sparkline.js";
import { onAuth, signInGoogle, signOutUser, type User } from "./auth.js";
import { db } from "./firebase.js";
import { isAllowlisted, loadInventory } from "./persistence.js";
import { callConfirm, callLogo, callNormalize, type NormalizeInput } from "./functions-client.js";
import { renderBoot } from "./screens/boot.js";
import { renderAuth } from "./screens/auth.js";
import { renderDenied } from "./screens/denied.js";
import { renderOnboard } from "./screens/onboard.js";
import { renderConfirm } from "./screens/confirm.js";
import { Dashboard } from "./screens/dashboard.js";
import { ensureReviewBar } from "./review-bar.js";

const DEFAULT_FEED: FeedStatus = {
  connection: "live",
  marketState: "open",
  latencyMs: 38,
  ticks: 0,
  feedNote: "primary: ws · realtime",
  updatedAt: 0,
};

/**
 * The single application controller (ADR-0011). Owns the screen machine, the
 * hot/cold state, the one rAF render loop, and — from Phase 2 — the Firebase auth
 * gate and per-user inventory persistence.
 */
export class App {
  readonly root: HTMLElement;
  screen: Screen = "boot";
  dashState: DashState = "normal";
  reduce: boolean;
  bootStep = 0;

  inventory: readonly DemoPosition[] = [];
  proposal: readonly ProposedPosition[] = [];
  hot: HotState = emptyHot();
  feed: FeedStatus = DEFAULT_FEED;
  source: SimSource | null = null;
  user: User | null = null;

  /** Display currency for the dashboard (USD-priced feed, re-expressed on screen). */
  currency = "USD";
  /** Memoised logo resolutions, keyed by symbol, shared across dashboard re-mounts. */
  readonly logoCache = new Map<string, LogoResult>();

  readonly now: () => number = Date.now;

  private dash: Dashboard | null = null;
  private raf = 0;
  private bootTimers: number[] = [];
  private offTick: (() => void) | null = null;
  private offStatus: (() => void) | null = null;
  private bootDone = false;
  private authReady = false;

  constructor(root: HTMLElement) {
    this.root = root;
    this.reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  start(): void {
    onAuth((user) => this.handleAuth(user));
    this.runBoot();
    this.loop();
  }

  // ---- auth gate ----

  private handleAuth(user: User | null): void {
    const wasSignedIn = this.user !== null;
    this.user = user;
    this.authReady = true;
    if (user === null && wasSignedIn) {
      // signed out: tear down the live feed and return to the gate
      this.teardownSource();
      this.inventory = [];
      this.hot = emptyHot();
    }
    this.tryRoute();
  }

  /** Route once both the boot animation and the initial auth state have resolved. */
  private tryRoute(): void {
    if (!this.bootDone || !this.authReady) return;
    if (this.user === null) {
      this.goScreen("auth");
      return;
    }
    void this.enterSignedIn();
  }

  /** Signed in: gate on the invite-allowlist, then load the book; go live if it
   *  exists, else onboard. (ADR-0012 — authenticating is not authorisation.) */
  private async enterSignedIn(): Promise<void> {
    const uid = this.user?.uid;
    const email = this.user?.email;
    if (uid === undefined) return;
    if (email === null || email === undefined || !(await isAllowlisted(db, email))) {
      this.goScreen("denied");
      return;
    }
    let positions = null;
    try {
      positions = await loadInventory(db, uid);
    } catch {
      positions = null;
    }
    if (positions && positions.length > 0) {
      this.goLiveWith(positionsToDemo(positions));
    } else {
      this.goScreen("onboard");
    }
  }

  async signInGoogle(): Promise<void> {
    await signInGoogle();
  }

  async signOut(): Promise<void> {
    await signOutUser();
  }

  // ---- boot sequence ----

  private runBoot(): void {
    this.clearBootTimers();
    this.screen = "boot";
    this.bootStep = 0;
    this.bootDone = false;
    this.render();
    if (this.reduce) {
      this.bootStep = 6;
      renderBoot(this);
      this.bootTimers.push(window.setTimeout(() => this.finishBoot(), 250));
      return;
    }
    for (let i = 1; i <= 6; i++) {
      this.bootTimers.push(
        window.setTimeout(() => {
          this.bootStep = i;
          if (this.screen === "boot") renderBoot(this);
        }, i * 340),
      );
    }
    this.bootTimers.push(window.setTimeout(() => this.finishBoot(), 6 * 340 + 700));
  }

  private finishBoot(): void {
    this.bootDone = true;
    this.tryRoute();
  }

  private clearBootTimers(): void {
    for (const t of this.bootTimers) clearTimeout(t);
    this.bootTimers = [];
  }

  // ---- navigation ----

  goScreen(s: Screen): void {
    if (s === "boot") {
      this.runBoot();
      return;
    }
    this.clearBootTimers();
    this.screen = s;
    if (s !== "dash") this.dash = null;
    this.render();
  }

  /** Onboarding: send raw input to the server-side normaliser and store the
   *  proposal (brief §B). The caller drives the chat stream and the transition to
   *  the proposal screen. Throws on failure so the caller can surface it. */
  async normalizeInput(input: NormalizeInput): Promise<readonly ProposedPosition[]> {
    this.proposal = await callNormalize(input);
    return this.proposal;
  }

  /** Confirm "lock inventory & go live": persist the confirmed book server-side
   *  (with re-validation), then stream. The caller passes the full intended book
   *  — for an add, that is the existing book merged with the new holdings (the
   *  confirm screen resolves any per-instrument conflicts first). */
  async confirmAndGoLive(positions: readonly Position[]): Promise<void> {
    try {
      await callConfirm(positions);
    } catch {
      // Server persistence failure shouldn't block the demo; surfaced later.
    }
    this.goLiveWith(positionsToDemo(positions));
  }

  /** Start (or restart) the live feed for a given inventory. */
  goLiveWith(inv: readonly DemoPosition[]): void {
    this.inventory = inv;
    this.hot = emptyHot();
    this.teardownSource();
    const src = new SimSource(simSeedsFromInventory(inv));
    this.source = src;
    this.offTick = src.onTick((t) => this.onTick(t));
    this.offStatus = src.onStatus((s) => {
      this.feed = s;
    });
    src.subscribe(inv.map((p) => p.isin));
    src.start();
    this.dashState = "normal";
    this.goScreen("dash");
  }

  /** Drive a dashboard secondary state (onboarding flow + dev review bar). */
  goState(s: DashState): void {
    if (!this.source) {
      this.goLiveWith(this.inventory.length > 0 ? this.inventory : buildDemoInventory());
    }
    this.dashState = s;
    const scenario: SimScenario = s === "empty" ? "normal" : s;
    this.source?.setScenario(scenario);
    this.screen = "dash";
    this.render();
  }

  toggleReduce(): void {
    this.reduce = !this.reduce;
    this.render();
  }

  // ---- live inventory edits (dashboard) ----

  /** Apply an edited book without tearing down the warm feed: keep prices and
   *  sparklines, re-subscribe to current ids, persist best-effort, re-render. */
  private applyInventory(inv: readonly DemoPosition[]): void {
    this.inventory = inv;
    this.source?.subscribe(inv.map((p) => p.isin));
    void callConfirm(demoToPositions(inv)).catch(() => {
      // Persistence failure shouldn't block the live edit; the book stays in memory.
    });
    if (this.screen === "dash") this.render();
  }

  /** Drop a holding from the book and stop streaming it. */
  removePosition(isin: string): void {
    this.source?.unsubscribe([isin]);
    this.applyInventory(this.inventory.filter((p) => p.isin !== isin));
  }

  /** Set a holding's quantity (in its current unit). Ignores non-finite input. */
  setQuantity(isin: string, quantity: number): void {
    if (!Number.isFinite(quantity) || quantity < 0) return;
    this.applyInventory(this.inventory.map((p) => (p.isin === isin ? { ...p, quantity } : p)));
  }

  /** Switch a commodity holding's unit, converting the quantity so the physical
   *  amount (and value) is preserved — 10 ozt becomes 311.03 g, not 10 g. */
  setUnit(isin: string, unitId: string): void {
    this.applyInventory(
      this.inventory.map((p) => {
        if (p.isin !== isin) return p;
        const c = commodityFor(p.symbol);
        if (!c) return p;
        const quantity = convertQuantity(c, p.quantity, p.unit, unitId);
        return { ...p, unit: unitId, quantity };
      }),
    );
  }

  /** Change the display currency and repaint (the feed stays USD-priced). */
  setCurrency(code: string): void {
    this.currency = code;
    if (this.screen === "dash") this.render();
  }

  /** Resolve a brand logo, memoised per symbol. Returns null on any failure so the
   *  caller simply keeps the monogram. */
  async resolveLogo(symbol: string, domain: string): Promise<LogoResult | null> {
    const cached = this.logoCache.get(symbol);
    if (cached) return cached;
    try {
      const res = await callLogo(symbol, domain);
      this.logoCache.set(symbol, res);
      return res;
    } catch {
      return null;
    }
  }

  // ---- tick hot-path ----

  private onTick(t: Tick): void {
    const id = t.instrumentId;
    const old = this.hot.price.get(id);
    this.hot.price.set(id, t.lastPrice);
    this.hot.prev.set(id, t.previousClose);
    this.hot.fresh.set(id, t.freshness);
    if (!this.hot.disp.has(id)) this.hot.disp.set(id, t.lastPrice);

    const series = this.hot.series.get(id);
    if (!series) {
      this.hot.series.set(id, seedSeries(t.previousClose, t.lastPrice, SPARK_LEN));
    } else {
      series.push(t.lastPrice);
      if (series.length > SPARK_LEN) series.shift();
    }

    if (old !== undefined && old !== t.lastPrice) {
      this.hot.flash.set(id, { dir: t.lastPrice >= old ? "up" : "down", t: this.now() });
    }
  }

  // ---- render + loop ----

  private render(): void {
    switch (this.screen) {
      case "boot":
        renderBoot(this);
        break;
      case "auth":
        renderAuth(this);
        break;
      case "denied":
        renderDenied(this);
        break;
      case "onboard":
        renderOnboard(this);
        break;
      case "confirm":
        renderConfirm(this);
        break;
      case "dash":
        this.dash = new Dashboard(this);
        break;
    }
    if (import.meta.env.DEV) ensureReviewBar(this);
  }

  private readonly loop = (): void => {
    const ease = this.reduce ? 1 : 0.16;
    for (const [id, target] of this.hot.price) {
      const d = this.hot.disp.get(id) ?? target;
      this.hot.disp.set(id, d + (target - d) * ease);
    }
    if (this.dash) this.dash.update();
    this.raf = requestAnimationFrame(this.loop);
  };

  private teardownSource(): void {
    this.offTick?.();
    this.offStatus?.();
    this.source?.stop();
    this.offTick = null;
    this.offStatus = null;
    this.source = null;
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.clearBootTimers();
    this.teardownSource();
  }
}
