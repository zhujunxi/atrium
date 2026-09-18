/**
 * Launchpad 分页控制器。
 *
 * 触控板路径完全是原生 overflow-x / CSS scroll-snap：不监听 wheel、不改
 * scrollLeft、不模拟惯性。浏览器合成器因此能保持 macOS 触控板的跟手与回弹。
 * 这里只处理页码同步、离散跳页和鼠标按住拖动。
 */

const SAMPLE_MS = 100;
const FLING_PREDICT_S = 0.16;
const COMMIT_RATIO = 0.16;

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
    if (this.el) this.el.scrollLeft = this.page * this.width;
    this.emit(this.page);
  }

  goTo(page: number) {
    const target = clamp(Math.round(page), 0, this.pageCount - 1);
    this.page = target;
    this.el?.scrollTo({ left: target * this.width, behavior: "smooth" });
    this.emit(target);
  }

  beginDrag(clientX: number) {
    if (!this.el || this.pageCount < 2) return;
    if (this.restoreSnapTimer !== null) window.clearTimeout(this.restoreSnapTimer);
    this.restoreSnapTimer = null;
    this.dragging = true;
    this.baseScroll = this.el.scrollLeft;
    this.startClientX = clientX;
    this.samples = [{ t: performance.now(), x: this.baseScroll }];
    // 鼠标拖动应严格跟着 cursor，不被原生 snap 中途拉走。
    this.el.style.scrollSnapType = "none";
    this.el.style.scrollBehavior = "auto";
  }

  moveDrag(clientX: number) {
    if (!this.el || !this.dragging) return;
    this.el.scrollLeft = clamp(
      this.baseScroll - (clientX - this.startClientX),
      0,
      (this.pageCount - 1) * this.width
    );
    this.pushSample();
  }

  endDrag() {
    if (!this.el || !this.dragging) return;
    this.dragging = false;
    const travel = this.el.scrollLeft - this.baseScroll;
    const velocity = this.velocity();
    const start = clamp(Math.round(this.baseScroll / this.width), 0, this.pageCount - 1);
    const target =
      Math.abs(travel) >= this.width * COMMIT_RATIO
        ? start + Math.sign(travel)
        : Math.round((this.el.scrollLeft + velocity * FLING_PREDICT_S) / this.width);
    this.goTo(clamp(target, start - 1, start + 1));
    this.restoreSnapAfterScroll();
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
