/** Stable event order, including insertion order for exact ties. */
export class EventHeap<T> {
  private readonly heap: { value: T; ordinal: number }[] = [];
  private ordinal = 0;
  private readonly compare: (a: T, b: T) => number;
  constructor(compare: (a: T, b: T) => number) { this.compare = compare; }
  get length(): number { return this.heap.length; }
  private less(a: { value: T; ordinal: number }, b: { value: T; ordinal: number }) { return this.compare(a.value, b.value) < 0 || (this.compare(a.value, b.value) === 0 && a.ordinal < b.ordinal); }
  push(value: T): void {
    const item = { value, ordinal: this.ordinal++ }; let i = this.heap.length; this.heap.push(item);
    while (i > 0 && this.less(item, this.heap[(i - 1) >>> 1])) { this.heap[i] = this.heap[(i - 1) >>> 1]; i = (i - 1) >>> 1; }
    this.heap[i] = item;
  }
  shift(): T | undefined {
    if (!this.heap.length) return undefined;
    const result = this.heap[0].value; const last = this.heap.pop()!;
    if (this.heap.length) {
      let i = 0;
      while (i * 2 + 1 < this.heap.length) {
        let next = i * 2 + 1; if (next + 1 < this.heap.length && this.less(this.heap[next + 1], this.heap[next])) next++;
        if (!this.less(this.heap[next], last)) break;
        this.heap[i] = this.heap[next]; i = next;
      }
      this.heap[i] = last;
    }
    return result;
  }
}
