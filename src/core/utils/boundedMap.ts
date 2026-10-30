/**
 * M7 v3.11 - BoundedMap & BoundedSet
 *
 * Drop-in replacements for Map/Set with LRU eviction.
 * Prevents unbounded memory growth in long-running MCP sessions.
 *
 * Usage:
 *   const cache = new BoundedMap<string, Data>(500);  // max 500 entries
 *   const ids   = new BoundedSet<string>(1000);
 *
 * @version 3.11.0
 */

/**
 * Map with automatic LRU eviction when maxSize is reached.
 * Every `get` / `set` promotes the key to most-recently-used.
 */
export class BoundedMap<K, V> extends Map<K, V> {
  private maxSize: number;

  constructor(maxSize: number, entries?: Iterable<[K, V]>) {
    super();
    if (maxSize < 1) throw new RangeError('BoundedMap maxSize must be >= 1');
    this.maxSize = maxSize;
    if (entries) {
      for (const [k, v] of entries) {
        this.set(k, v);
      }
    }
  }

  /** Get value and promote key to MRU position. */
  override get(key: K): V | undefined {
    if (!super.has(key)) return undefined;
    const value = super.get(key)!;
    // Re-insert to move to end (MRU)
    super.delete(key);
    super.set(key, value);
    return value;
  }

  /** Set value and evict LRU entries if over capacity. */
  override set(key: K, value: V): this {
    // If key exists, delete first to refresh position
    if (super.has(key)) {
      super.delete(key);
    }
    super.set(key, value);
    // Evict oldest (first inserted) entries
    while (super.size > this.maxSize) {
      const oldest = super.keys().next().value;
      if (oldest !== undefined) {
        super.delete(oldest);
      }
    }
    return this;
  }

  /** Current capacity limit. */
  get capacity(): number {
    return this.maxSize;
  }

  /** MEM-4: Raise capacity (never shrink). Used after loading a large persisted level file. */
  setMaxSize(newMax: number): void {
    if (newMax < 1) throw new RangeError('BoundedMap maxSize must be >= 1');
    if (newMax <= this.maxSize) return;
    this.maxSize = newMax;
  }
}

/**
 * Set with automatic LRU eviction when maxSize is reached.
 */
export class BoundedSet<T> extends Set<T> {
  private readonly maxSize: number;

  constructor(maxSize: number, values?: Iterable<T>) {
    super();
    if (maxSize < 1) throw new RangeError('BoundedSet maxSize must be >= 1');
    this.maxSize = maxSize;
    if (values) {
      for (const v of values) {
        this.add(v);
      }
    }
  }

  /** Add value and evict LRU entries if over capacity. */
  override add(value: T): this {
    // Re-insert to move to end (MRU) if already present
    if (super.has(value)) {
      super.delete(value);
    }
    super.add(value);
    // Evict oldest
    while (super.size > this.maxSize) {
      const oldest = super.values().next().value;
      if (oldest !== undefined) {
        super.delete(oldest);
      }
    }
    return this;
  }

  /** Current capacity limit. */
  get capacity(): number {
    return this.maxSize;
  }
}
