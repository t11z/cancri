import { SimSource, type SimScenario } from "@cancri/sim-source";
import type { FeedStatus, Tick } from "@cancri/data-contracts";
import {
  emptyHot,
  SPARK_LEN,
  type DashState,
  type DemoPosition,
  type HotState,
  type Screen,
} from "./state.js";
import { buildDemoInventory, buildSimSeeds } from "./fixtures.js";
import { seedSeries } from "./sparkline.js";
import { renderBoot } from "./screens/boot.js";
import { renderAuth } from "./screens/auth.js";
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
 * hot/cold state, and the one rAF render loop. The dashboard is the only screen
 * with a per-frame hot path; the rest are cold renders.
 */
export class App {
  readonly root: HTMLElement;
  screen: Screen = "boot";
  dashState: DashState = "normal";
  reduce: boolean;
  bootStep = 0;

  inventory: readonly DemoPosition[] = [];
  hot: HotState = emptyHot();
  feed: FeedStatus = DEFAULT_FEED;
  source: SimSource | null = null;

  readonly now: () => number = Date.now;

  private dash: Dashboard | null = null;
  private raf = 0;
  private bootTimers: number[] = [];
  private offTick: (() => void) | null = null;
  private offStatus: (() => void) | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    this.reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  start(): void {
    this.runBoot();
    this.loop();
  }

  // ---- boot sequence ----

  private runBoot(): void {
    this.clearBootTimers();
    this.screen = "boot";
    this.bootStep = 0;
    this.render();
    if (this.reduce) {
      this.bootStep = 6;
      renderBoot(this);
      this.bootTimers.push(window.setTimeout(() => this.goScreen("auth"), 250));
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
    this.bootTimers.push(window.setTimeout(() => this.goScreen("auth"), 6 * 340 + 700));
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

  /** Lock the (demo) inventory and start the live feed. */
  goLive(): void {
    this.inventory = buildDemoInventory();
    this.hot = emptyHot();
    this.teardownSource();
    const src = new SimSource(buildSimSeeds());
    this.source = src;
    this.offTick = src.onTick((t) => this.onTick(t));
    this.offStatus = src.onStatus((s) => {
      this.feed = s;
    });
    src.subscribe(this.inventory.map((p) => p.isin));
    src.start();
    this.dashState = "normal";
    this.goScreen("dash");
  }

  /** Drive a dashboard secondary state (used by onboarding flow + dev review bar). */
  goState(s: DashState): void {
    if (!this.source) this.goLive();
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

  /** Stop everything (not used in Phase 1 but keeps the lifecycle honest). */
  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.clearBootTimers();
    this.teardownSource();
  }
}
