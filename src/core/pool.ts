/**
 * Generic object pool. Pre-allocates `size` items via `factory`, hands them out
 * with `acquire`, returns them with `release`. Never allocates in the loop once
 * warm — backbone of the isPooled gate.
 */
export class Pool<T> {
  private free: T[] = [];
  private readonly factory: () => T;
  private readonly onRelease?: (item: T) => void;

  constructor(factory: () => T, size: number, onRelease?: (item: T) => void) {
    this.factory = factory;
    this.onRelease = onRelease;
    for (let i = 0; i < size; i++) this.free.push(factory());
  }

  acquire(): T {
    return this.free.pop() ?? this.factory();
  }

  release(item: T): void {
    this.onRelease?.(item);
    this.free.push(item);
  }

  get available(): number {
    return this.free.length;
  }
}
