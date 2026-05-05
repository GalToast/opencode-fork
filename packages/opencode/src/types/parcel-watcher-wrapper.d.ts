declare module "@parcel/watcher/wrapper.js" {
  import type ParcelWatcher from "@parcel/watcher"

  export function createWrapper(binding: unknown): typeof ParcelWatcher
}
