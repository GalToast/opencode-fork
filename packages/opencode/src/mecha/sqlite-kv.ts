export class SQLiteKV<T> {
  constructor(public table: string, public options?: any) {}
  get(key: string): T | undefined { return undefined as any }
  set(key: string, value: T): void {}
  delete(key: string): void {}
  clear(): void {}
  get size(): number { return 0 }
  values(): IterableIterator<T> { return [][Symbol.iterator]() }
  [Symbol.iterator](): IterableIterator<[string, T]> { return [][Symbol.iterator]() }
}
export const SQLITE_KV_BUSY_TIMEOUT_MS = 10000;
export function configureSQLiteKVConnection(...args: any[]) {}
