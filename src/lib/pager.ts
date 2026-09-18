/**
 * Launchpad 分页控制器。
 *
 * 触控板路径保持原生 overflow-x / CSS scroll-snap：不拦截 wheel 位移、不改
 * scrollLeft、不模拟惯性，只被动观察「边界外的推力」，用一层橡皮筋视觉位移提供
 * 拽到头的手感。鼠标路径按 pointer 位移直接写 scrollLeft，越界时同样拉伸橡皮筋；
 * 松手按「位移 + 速度」吸附翻页。这里只负责页码同步、离散跳页、拖动与橡皮筋。
 *
 * ⚠️ 橡皮筋位移写在**滚动容器自身**上，绝不写在滚动内容上：
 * 给滚动内容加 transform 会撑开 / 收紧容器的可滚动溢出区域，末页会被浏览器重新
 * 钳制并触发一次重新吸附 —— 那正是「回弹已经到位、又弹一下」的来源。
 *
 * 橡皮筋是一个状态机：
 *   idle ──(边界外推力)──▶ pulling ──(松手)──▶ returning ──▶ idle
 * 「松手」有两个来源：一是停手超过 RUBBER_IDLE_MS，二是推力衰减判定（trackPush：
 * macOS 惯性尾巴会持续几百毫秒，等它安静下来就变成「卡半秒才回弹」）。
 * returning 期间一律吞掉新的推力，避免回弹动画被打断成「到位后又弹一下」。
 */

const SAMPLE_MS = 100;
const FLING_PREDICT_S = 0.16;
const COMMIT_RATIO = 0.16;
/** 橡皮筋：最大视觉位移 / 阻尼尺度 / 停手多久后回弹 / 回弹时长 / 重拉所需累积推力 */
const RUBBER_MAX_PX = 52;
const RUBBER_RESISTANCE_PX = 110;
const RUBBER_IDLE_MS = 70;
const RUBBER_RETURN_MS = 320;
const RUBBER_TAIL_PX = 10;

/**
 * 「手指是否已离开」判据（只用于双指横滚）。
 * macOS 在手指离开后还会继续送几百毫秒的惯性尾巴，若等它彻底安静再回弹，
 * 视觉上就是「先卡半秒再弹回去」。所以改用推力衰减来提前判定松手：
 * 峰值够大 + 当前推力跌到峰值的一定比例 + 连续递减 → 认定手指已离开。
 */
const PUSH_GAP_MS = 400; // 事件间隔超过它 = 全新手势，判定清零
const PUSH_DECAY_RATIO = 0.65;
const PUSH_DECAY_HITS = 3;
const PUSH_DECAY_MIN_PX = 8;
const PUSH_GROW_HITS = 2; // 连续变大这么多次 = 又在用力推（新手势抢回控制权）

type BandState = "idle" | "pulling" | "returning";

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

export class LaunchpadPager {
  private el: HTMLElement | null = null;
  private onPage: ((page: number) => void) | null = null;
  private page = 0;
  private emittedPage = -1;
  private pageCount = 1;
  private width = 1;
  private dragging = false;
  private baseScroll = 0;
  private startClientX = 0;
  private samples: { t: number; x: number }[] = [];
  private restoreSnapTimer: number | null = null;

  /* ── 橡皮筋 ── */
  private bandState: BandState = "idle";
  /** 边界外累积推力（px）：正 = 往「上一页」方向拽 */
  private bandPull = 0;
  /** 阻尼后的实际视觉位移（px，正 = 内容右移） */
  private bandOffset = 0;
  /** 回弹结束后累积的疑似惯性尾巴（px） */
  private bandTail = 0;
  private bandTimer: number | null = null;
  private bandAnim: Animation | null = null;
  /* 推力衰减判定用的采样 */
  private pushPeak = 0;
  private lastPushMag = 0;
  private lastPushAt = 0;
  private decayHits = 0;
  private growHits = 0;
  /** 本次手势是否已判定「手指离开」（之后的推力都当作惯性尾巴） */
  private pushOver = false;

  private onScroll = () => {
    if (!this.el) return;
    this.page = clamp(Math.round(this.el.scrollLeft / this.width), 0, this.pageCount - 1);
    this.emit(this.page);
  };

  attach(el: HTMLElement, onPage: (page: number) => void) {
    this.el = el;
    this.onPage = onPage;
    this.width = el.clientWidth || 1;
    el.addEventListener("scroll", this.onScroll, { passive: true });
  }

  destroy() {
    if (this.restoreSnapTimer !== null) window.clearTimeout(this.restoreSnapTimer);
    this.settleBand();
    this.el?.removeEventListener("scroll", this.onScroll);
    this.el = null;
    this.onPage = null;
  }

  get currentPage() {
    return this.page;
  }

  setLayout(pageCount: number, width?: number) {
    this.pageCount = Math.max(1, pageCount);
    if (width && width > 0) this.width = width;
    this.page = clamp(this.page, 0, this.pageCount - 1);
    this.settleBand();
    if (this.el) this.el.scrollLeft = this.page * this.width;
    this.emit(this.page);
  }

  goTo(page: number) {
    const target = clamp(Math.round(page), 0, this.pageCount - 1);
    this.page = target;
    // 橡皮筋自己回弹（动画），页翻动画同时进行：两者分别作用在容器与内容上，不冲突。
    if (this.bandState !== "returning" && this.bandPull !== 0) this.startBandReturn();
    this.el?.scrollTo({ left: target * this.width, behavior: "smooth" });
    this.emit(target);
  }

  /**
   * 被动观察原生横向 wheel：只有首尾页继续向外推时才施加橡皮筋；
   * 中间页完全不写样式，保留浏览器原生合成器滚动。
   */
  feedNativeWheel(dx: number) {
    if (!this.el || dx === 0 || this.pageCount < 2) return;
    // 回弹进行中：剩余惯性尾巴一律吞掉，绝不把回弹打断成「再弹一下」。
    if (this.bandState === "returning") return;

    const max = (this.pageCount - 1) * this.width;
    const atFirst = this.el.scrollLeft <= 1;
    const atLast = this.el.scrollLeft >= max - 1;
    const outward = (atFirst && dx < 0) || (atLast && dx > 0);

    if (!outward) {
      // 反向拉回：说明手指仍在动，判定清零；只消掉已有拉伸，不制造反向位移。
      this.resetPushTrack(Math.abs(dx));
      if (this.bandPull !== 0) this.setBandPull(0);
      return;
    }

    const gone = this.trackPush(dx);

    if (this.bandPull === 0) {
      // 已判定手指离开：之后的惯性尾巴直接忽略，免得回弹完又被顶起来一下。
      if (gone) return;
      this.bandTail += Math.abs(dx);
      if (this.bandTail < RUBBER_TAIL_PX) return;
      const seeded = this.bandTail;
      this.bandTail = 0;
      this.setBandPull(-Math.sign(dx) * seeded);
    } else {
      this.setBandPull(this.bandPull - dx);
    }

    // 手指已离开 → 立刻回弹，不等惯性尾巴跑完（否则看起来像「卡了半秒」）
    if (gone) {
      this.startBandReturn();
      return;
    }
    this.armBandReturn();
  }

  /**
   * 观察推力大小，判断手指是否离开（双指横滚的松手判定）。
   * 返回 true 表示本次手势已收尾，后续推力都按惯性尾巴处理。
   */
  private trackPush(dx: number): boolean {
    const now = performance.now();
    const mag = Math.abs(dx);
    if (now - this.lastPushAt > PUSH_GAP_MS) {
      // 间隔够久 → 新手势
      this.resetPushTrack(mag);
    } else if (mag > this.pushPeak) {
      // 推力仍在变大 → 手指还在加速推
      this.pushPeak = mag;
      this.decayHits = 0;
      this.growHits = 0;
      this.pushOver = false;
    } else if (mag > this.lastPushMag) {
      this.growHits += 1;
      this.decayHits = 0;
      if (this.growHits >= PUSH_GROW_HITS) this.resetPushTrack(mag);
    } else if (mag < this.lastPushMag) {
      this.growHits = 0;
      this.decayHits += 1;
    } else {
      this.growHits = 0;
      this.decayHits = 0;
    }
    this.lastPushMag = mag;
    this.lastPushAt = now;

    if (
      !this.pushOver &&
      this.pushPeak >= PUSH_DECAY_MIN_PX &&
      mag < this.pushPeak * PUSH_DECAY_RATIO &&
      this.decayHits >= PUSH_DECAY_HITS
    ) {
      this.pushOver = true;
    }
    return this.pushOver;
  }

  private resetPushTrack(peak: number) {
    this.pushPeak = peak;
    this.decayHits = 0;
    this.growHits = 0;
    this.pushOver = false;
  }

  beginDrag(clientX: number) {
    if (!this.el || this.pageCount < 2) return;
    if (this.restoreSnapTimer !== null) window.clearTimeout(this.restoreSnapTimer);
    this.restoreSnapTimer = null;
    // 拖动必须从「干净状态」开始：残留的橡皮筋位移会让拖拽看起来偏了一截。
    this.settleBand();
    this.dragging = true;
    // 鼠标拖动应严格跟着 cursor，不被原生 snap 中途拉走。
    this.el.style.scrollSnapType = "none";
    this.el.style.scrollBehavior = "auto";
    // 基准必须是整页：上一轮翻页动画还没跑完就按下时，若按半页位置起算，
    // 松手的落点判定会跳错方向。这里直接落到当前页（与原生 snap 的目标一致）。
    if (Math.abs(this.el.scrollLeft - this.page * this.width) > 1) {
      this.el.scrollLeft = this.page * this.width;
    }
    this.baseScroll = this.el.scrollLeft;
    this.startClientX = clientX;
    this.samples = [{ t: performance.now(), x: this.baseScroll }];
  }

  moveDrag(clientX: number) {
    if (!this.el || !this.dragging) return;
    const max = (this.pageCount - 1) * this.width;
    const want = this.baseScroll - (clientX - this.startClientX);
    const bounded = clamp(want, 0, max);
    if (bounded === want) {
      if (this.bandPull !== 0) this.setBandPull(0);
    } else {
      // 拽到边界：滚动停在边界上，多出来的位移变成阻尼橡皮筋。
      this.setBandPull(bounded - want);
      if (this.bandTimer !== null) {
        window.clearTimeout(this.bandTimer);
        this.bandTimer = null;
      }
    }
    this.el.scrollLeft = bounded;
    this.pushSample();
  }

  endDrag() {
    if (!this.el || !this.dragging) return;
    this.dragging = false;
    // 越界拉伸先自己弹回（动画），与页翻动画并行。
    if (this.bandState === "pulling") this.startBandReturn();
    const max = (this.pageCount - 1) * this.width;
    const travel = clamp(this.el.scrollLeft, 0, max) - this.baseScroll;
    const velocity = this.velocity();
    const start = clamp(Math.round(this.baseScroll / this.width), 0, this.pageCount - 1);
    const dir = Math.sign(travel);
    let target: number;
    if (Math.abs(travel) >= this.width * COMMIT_RATIO) {
      target = start + dir;
    } else {
      // 速度预测落点，但方向必须与拖拽方向一致：绝不朝反方向翻页。
      const projected = Math.round((this.el.scrollLeft + velocity * FLING_PREDICT_S) / this.width);
      target = dir > 0 ? Math.max(projected, start) : dir < 0 ? Math.min(projected, start) : start;
    }
    this.goTo(clamp(target, start - 1, start + 1));
    this.restoreSnapAfterScroll();
  }

  /* ── 橡皮筋实现 ── */

  private setBandPull(raw: number) {
    if (!this.el) return;
    // 阻尼曲线：越往外推越沉，最大视觉位移固定，不会把下一页拉出来。
    this.bandPull = clamp(raw, -520, 520);
    const amount = Math.abs(this.bandPull);
    this.bandOffset =
      amount === 0
        ? 0
        : Math.sign(this.bandPull) * RUBBER_MAX_PX * (1 - Math.exp(-amount / RUBBER_RESISTANCE_PX));
    this.bandAnim?.cancel();
    this.bandAnim = null;
    this.bandState = amount === 0 ? "idle" : "pulling";
    if (amount === 0) this.el.style.removeProperty("transform");
    else this.el.style.transform = `translate3d(${this.bandOffset}px, 0, 0)`;
  }

  private armBandReturn() {
    if (this.bandState !== "pulling") return;
    if (this.bandTimer !== null) window.clearTimeout(this.bandTimer);
    this.bandTimer = window.setTimeout(() => {
      this.bandTimer = null;
      this.startBandReturn();
    }, RUBBER_IDLE_MS);
  }

  /** 回弹：一次性动画到 0 即停，不使用 y>1 的缓动，避免到位后再反向弹一次 */
  private startBandReturn() {
    const el = this.el;
    if (!el) return;
    if (this.bandTimer !== null) {
      window.clearTimeout(this.bandTimer);
      this.bandTimer = null;
    }
    this.bandAnim?.cancel();
    this.bandAnim = null;
    const from = this.bandOffset;
    this.bandPull = 0;
    this.bandOffset = 0;
    this.bandTail = 0;
    if (Math.abs(from) < 0.5) {
      this.bandState = "idle";
      el.style.removeProperty("transform");
      return;
    }
    this.bandState = "returning";
    const animation = el.animate(
      [{ transform: `translate3d(${from}px, 0, 0)` }, { transform: "translate3d(0, 0, 0)" }],
      { duration: RUBBER_RETURN_MS, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "forwards" }
    );
    this.bandAnim = animation;
    animation.onfinish = () => {
      // 回弹途中若被新的手势接管，这里就不再回收。
      if (this.bandAnim !== animation) return;
      this.bandAnim = null;
      this.bandState = "idle";
      el.style.removeProperty("transform");
      animation.cancel();
    };
  }

  /** 立即归零（无动画）：布局变化 / 新拖动开始 / 销毁时用 */
  private settleBand() {
    if (this.bandTimer !== null) {
      window.clearTimeout(this.bandTimer);
      this.bandTimer = null;
    }
    this.bandAnim?.cancel();
    this.bandAnim = null;
    this.bandPull = 0;
    this.bandOffset = 0;
    this.bandTail = 0;
    this.bandState = "idle";
    this.pushPeak = 0;
    this.lastPushMag = 0;
    this.lastPushAt = 0;
    this.decayHits = 0;
    this.growHits = 0;
    this.pushOver = false;
    this.el?.style.removeProperty("transform");
  }

  /**
   * 不能在 goTo 前恢复 snap：浏览器会先吸回旧页，再开始目标页动画。
   * 等目标滚动完成后恢复，下一次触控板手势仍使用原生 snap。
   */
  private restoreSnapAfterScroll() {
    if (!this.el) return;
    const el = this.el;
    let restored = false;
    const restore = () => {
      if (restored) return;
      restored = true;
      el.style.removeProperty("scroll-snap-type");
      el.style.removeProperty("scroll-behavior");
      el.removeEventListener("scrollend", restore);
      if (this.restoreSnapTimer !== null) window.clearTimeout(this.restoreSnapTimer);
      this.restoreSnapTimer = null;
    };
    el.addEventListener("scrollend", restore, { once: true });
    // Chrome 旧版本或极短位移未产生 scrollend 时的安全兜底。
    this.restoreSnapTimer = window.setTimeout(restore, 650);
  }

  private pushSample() {
    if (!this.el) return;
    const now = performance.now();
    this.samples.push({ t: now, x: this.el.scrollLeft });
    while (this.samples.length > 2 && now - this.samples[0].t > SAMPLE_MS) this.samples.shift();
  }

  private velocity() {
    if (this.samples.length < 2) return 0;
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    const dt = last.t - first.t;
    return dt > 0 ? ((last.x - first.x) / dt) * 1000 : 0;
  }

  private emit(page: number) {
    if (page === this.emittedPage) return;
    this.emittedPage = page;
    this.onPage?.(page);
  }
}
