/** Unified input: keyboard + on-screen touch + gamepad. Exposes a normalized
 *  steer [-1..1], throttle [-1..1] and edge events (honk, photo, pause). */
export class Input {
  steer = 0; // -1 left .. 1 right (raw target)
  throttle = 0; // -1 brake .. 1 gas
  private keys = new Set<string>();
  private touchSteer = 0;
  private touchGas = 0;

  onHonk?: () => void;
  onPhoto?: () => void;
  onPause?: () => void;

  constructor() {
    addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
      if (!this.keys.has(k)) {
        if (k === 'h') this.onHonk?.();
        if (k === 'p') this.onPhoto?.();
        if (k === 'escape') this.onPause?.();
      }
      this.keys.add(k);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));

    this.bindTouch();
  }

  private bindTouch(): void {
    const bind = (id: string, on: () => void, off: () => void) => {
      const el = document.getElementById(id);
      if (!el) return;
      const start = (e: Event) => { e.preventDefault(); on(); };
      const end = (e: Event) => { e.preventDefault(); off(); };
      el.addEventListener('pointerdown', start);
      el.addEventListener('pointerup', end);
      el.addEventListener('pointerleave', end);
      el.addEventListener('pointercancel', end);
    };
    bind('t-left', () => (this.touchSteer = -1), () => (this.touchSteer = 0));
    bind('t-right', () => (this.touchSteer = 1), () => (this.touchSteer = 0));
    bind('t-gas', () => (this.touchGas = 1), () => (this.touchGas = 0));
  }

  /** call once per frame to fold inputs */
  poll(): void {
    let s = 0;
    if (this.keys.has('arrowleft') || this.keys.has('a')) s -= 1;
    if (this.keys.has('arrowright') || this.keys.has('d')) s += 1;
    s += this.touchSteer;

    let th = 0;
    if (this.keys.has('arrowup') || this.keys.has('w')) th += 1;
    if (this.keys.has('arrowdown') || this.keys.has('s')) th -= 1;
    th += this.touchGas;

    // gamepad
    const pads = navigator.getGamepads?.() ?? [];
    for (const p of pads) {
      if (!p) continue;
      const ax = p.axes[0] ?? 0;
      if (Math.abs(ax) > 0.12) s += ax;
      if (p.buttons[7]?.pressed) th += 1; // RT
      if (p.buttons[6]?.pressed) th -= 1; // LT
    }

    this.steer = Math.max(-1, Math.min(1, s));
    this.throttle = Math.max(-1, Math.min(1, th));
  }
}
