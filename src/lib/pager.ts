/**
 * Launchpad 风格横向分页控制器（纯物理，直接写 DOM transform，不经过 React 渲染）：
 * - 指针/触控拖拽 1:1 跟手；
 * - 首尾页橡皮筋阻尼拉伸，松手弹簧回位（回弹）；
 * - 松手按「位置 + 速度」预测落点吸附翻页（甩动可连续翻页）；
 * - 触控板双指横滑（wheel deltaX）跟手 + 惯性吸附；
 * - 临界阻尼弹簧，快速贴页、无过冲。
 */

const RUBBER_C = 0.55; // 橡皮筋阻尼系数（iOS 同款）
const SPRING_K = 380; // 弹簧刚度
const SPRING_C = 2 * Math.sqrt(SPRING_K); // 临界阻尼（质量=1）
const SETTLE_PX = 0.4; // 停稳判定：位移
const SETTLE_V = 12; // 停稳判定：速度 px/s
const SAMPLE_MS = 120; // 速度采样窗口
const WHEEL_IDLE_MS = 140; // 滚轮停止多久后吸附
const FLING_PREDICT_S = 0.22; // 甩动落点预测时长
/** 触控板果断快滑判定：累计位移 + 短窗速度双门槛，触发后立即翻页并吞掉惯性尾巴 */
const FLICK_ACC_PX = 48;
const FLICK_V_PX_S = 650;
const FLICK_MAX_V = 2400; // 翻页初速度钳制，防止过冲太夸张

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

export class LaunchpadPager {
  private el: HTMLElement | null = null;
  private onPage: ((page: number) => void) | null = null;
  private onActive: ((active: boolean) => void) | null = null;

  private x = 0; // 当前位移（<=0，px）
  private v = 0; // px/s
  private target = 0;
  private raf: number | null = null;
  private lastT = 0;
  private applyScheduled = false;
  private active = false;

  private page = 0;
  private emittedPage = -1;
  private pageCount = 1;
  private width = 1;

  private dragging = false;
  private baseX = 0;
  private startClientX = 0;
  private samples: { t: number; x: number }[] = [];
  private wheelTimer: number | null = null;
  /** 滚轮手势状态：一轮连续滚动（含 macOS 惯性尾巴） */
  private wheelGesture = false;
  private gestureStartPage = 0;
  private gestureAcc = 0; // 手势累计 deltaX（正=内容左移=下一页方向）
  /** 果断快滑已触发翻页动画：锁定期吞掉惯性尾巴与中途输入 */
  private chainLock = false;

  attach(el: HTMLElement, onPage: (page: number) => void, onActive?: (active: boolean) => void) {
    this.el = el;
    this.onPage = onPage;
    this.onActive = onActive ?? null;
    this.width = el.clientWidth || 1;
  }

  destroy() {
    this.stopSpring();
    this.stopWheelSnap();
    this.el = null;
    this.onPage = null;
    this.onActive = null;
  }

  get currentPage() {
    return this.page;
  }

  /** 页数/宽度变化：立即对齐到当前页（不做动画），页码越界自动夹紧 */
  setLayout(pageCount: number, width?: number) {
    this.pageCount = Math.max(1, pageCount);
    if (width && width > 0) this.width = width;
    this.page = clamp(this.page, 0, this.pageCount - 1);
    this.stopSpring();
    this.chainLock = false;
    this.wheelGesture = false;
    this.x = -this.page * this.width;
    this.apply();
    this.emit(this.page);
    this.setActive(false);
  }

  /** 跳到指定页（弹簧动画，自动夹紧范围） */
  goTo(page: number) {
    const t = clamp(Math.round(page), 0, this.pageCount - 1);
    this.page = t;
    this.animateTo(-t * this.width, this.v);
    this.emit(t);
  }

  beginDrag(clientX: number) {
    if (this.pageCount < 2) return;
    this.stopWheelSnap();
    this.stopSpring();
    this.chainLock = false;
    this.wheelGesture = false;
    this.dragging = true;
    this.baseX = this.x;
    this.startClientX = clientX;
    this.samples = [{ t: performance.now(), x: this.x }];
    this.setActive(true);
  }

  moveDrag(clientX: number) {
    if (!this.dragging) return;
    this.x = this.bounded(this.baseX + (clientX - this.startClientX));
    this.pushSample();
    this.scheduleApply();
    this.emit(clamp(Math.round(-this.x / this.width), 0, this.pageCount - 1));
  }

  endDrag() {
    if (!this.dragging) return;
    this.dragging = false;
    const v = this.velocity();
    const t = this.snapTarget(v);
    this.page = t;
    this.animateTo(-t * this.width, v);
    this.emit(t);
  }

  /**
   * 触控板双指横滑 / 鼠标横滚。
   * 慢推：deltaX 1:1 跟手，停轮后按「位置+速度」吸附；
   * 果断快滑：达到「累计位移+短窗速度」双门槛立即翻一整页，并锁定吞掉
   * macOS 惯性尾巴（否则页面在尾巴里慢慢爬行几百毫秒，又慢又卡）。
   */
  feedWheel(dx: number) {
    if (this.pageCount < 2) return;

    // 翻页动画进行中：惯性尾巴与中途输入一律吞掉，动画结束自动解锁
    if (this.chainLock) return;

    this.stopSpring();
    if (!this.wheelGesture) {
      this.wheelGesture = true;
      this.gestureStartPage = this.page;
      this.gestureAcc = 0;
    }
    this.x = this.bounded(this.x - dx);
    this.gestureAcc += dx;
    this.pushSample();
    this.scheduleApply();
    this.setActive(true);
    this.emit(clamp(Math.round(-this.x / this.width), 0, this.pageCount - 1));

    // 果断快滑：立即从手势起始页翻一页，弹簧带上甩动速度，干净利落地贴页
    const v = this.velocity();
    if (Math.abs(this.gestureAcc) > FLICK_ACC_PX && Math.abs(v) > FLICK_V_PX_S) {
      // 方向取甩动速度（而非累计位移）：先推后快速反向拉回时，尊重反向意图
      const dir = v < 0 ? 1 : -1; // x 向左（v<0）= 下一页
      this.startChainFlip(this.gestureStartPage + dir, v);
      return;
    }

    // 慢推：停轮后吸附
    if (this.wheelTimer !== null) window.clearTimeout(this.wheelTimer);
    this.wheelTimer = window.setTimeout(() => {
      this.wheelTimer = null;
      this.wheelGesture = false;
      const vv = this.velocity();
      const t = this.snapTarget(vv);
      this.page = t;
      this.animateTo(-t * this.width, vv);
      this.emit(t);
    }, WHEEL_IDLE_MS);
  }

  /** 快滑翻页：锁定输入直到弹簧停稳 */
  private startChainFlip(targetPage: number, v: number) {
    this.stopWheelSnap();
    this.wheelGesture = false;
    this.chainLock = true;
    const t = clamp(targetPage, 0, this.pageCount - 1);
    this.page = t;
    this.animateTo(-t * this.width, clamp(v, -FLICK_MAX_V, FLICK_MAX_V));
    this.emit(t);
  }

  /* ---------- 内部 ---------- */

  private minX() {
    return -(this.pageCount - 1) * this.width;
  }

  /** iOS 式橡皮筋：超出边界的距离按对数压缩，越拉越沉 */
  private rubber(overshoot: number) {
    const d = this.width;
    return (1 - 1 / ((Math.abs(overshoot) * RUBBER_C) / d + 1)) * d * Math.sign(overshoot);
  }

  private bounded(x: number) {
    const min = this.minX();
    if (x > 0) return this.rubber(x);
    if (x < min) return min + this.rubber(x - min);
    return x;
  }

  private apply() {
    if (this.el) this.el.style.transform = `translate3d(${this.x}px, 0, 0)`;
  }

  /** 高频事件（pointermove/wheel 可达 120Hz+）合并到每帧最多写一次 transform */
  private scheduleApply() {
    if (this.applyScheduled) return;
    this.applyScheduled = true;
    requestAnimationFrame(() => {
      this.applyScheduled = false;
      this.apply();
    });
  }

  /** 运动开始/结束通知（供外层降级昂贵特效，如 backdrop-filter 真折射） */
  private setActive(active: boolean) {
    if (this.active === active) return;
    this.active = active;
    this.onActive?.(active);
  }

  private emit(page: number) {
    if (page === this.emittedPage) return;
    this.emittedPage = page;
    this.onPage?.(page);
  }

  private pushSample() {
    const now = performance.now();
    this.samples.push({ t: now, x: this.x });
    while (this.samples.length > 2 && now - this.samples[0].t > SAMPLE_MS) this.samples.shift();
  }

  /** 采样窗口内的平均速度（px/s） */
  private velocity() {
    const s = this.samples;
    if (s.length < 2) return 0;
    const first = s[0];
    const last = s[s.length - 1];
    const dt = last.t - first.t;
    if (dt <= 0) return 0;
    return ((last.x - first.x) / dt) * 1000;
  }

  /** 位置 + 速度预测落点 → 目标页；快甩最多领先位置页一页（一次手势一页，Launchpad 手感） */
  private snapTarget(v: number) {
    const pos = Math.round(-this.x / this.width);
    const landing = this.x + v * FLING_PREDICT_S;
    const predicted = Math.round(-landing / this.width);
    return clamp(clamp(predicted, pos - 1, pos + 1), 0, this.pageCount - 1);
  }

  private animateTo(target: number, v0: number) {
    this.stopSpring();
    this.target = target;
    this.v = v0;
    this.lastT = performance.now();
    this.setActive(true);
    const step = (now: number) => {
      let dt = (now - this.lastT) / 1000;
      this.lastT = now;
      if (dt > 0.05) dt = 0.05; // 掉帧保护，防止大步长发散
      const force = -SPRING_K * (this.x - this.target) - SPRING_C * this.v;
      this.v += force * dt;
      this.x += this.v * dt;
      if (Math.abs(this.x - this.target) < SETTLE_PX && Math.abs(this.v) < SETTLE_V) {
        this.x = this.target;
        this.v = 0;
        this.apply();
        this.raf = null;
        this.chainLock = false; // 快滑翻页完成，恢复响应
        this.setActive(false);
        return;
      }
      this.apply();
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  private stopSpring() {
    if (this.raf !== null) {
      cancelAnimationFrame(this.raf);
      this.raf = null;
    }
    this.v = 0;
  }

  private stopWheelSnap() {
    if (this.wheelTimer !== null) {
      window.clearTimeout(this.wheelTimer);
      this.wheelTimer = null;
    }
  }
}
