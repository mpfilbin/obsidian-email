export class Emitter<E> {
  private listeners = new Set<(e: E) => void>();

  on(fn: (e: E) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(e: E): void {
    for (const fn of [...this.listeners]) {
      try { fn(e); } catch { /* listener errors must not break the emitter */ }
    }
  }
}
