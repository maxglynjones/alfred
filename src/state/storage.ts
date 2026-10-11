import type { EvenAppBridge } from '@evenrealities/even_hub_sdk';

// Installed WebViews may be recreated. The companion app's storage is durable.
export function persistentStorage(
  browser: Pick<Storage, 'getItem' | 'setItem'>,
  bridge?: Pick<EvenAppBridge, 'getLocalStorage' | 'setLocalStorage'>,
) {
  let writes: Promise<unknown> = Promise.resolve();
  const cached = (key: string) => {
    try {
      return browser.getItem(key) ?? '';
    } catch {
      return '';
    }
  };
  const cache = (key: string, value: string) => {
    try {
      browser.setItem(key, value);
    } catch {
      /* Native storage remains authoritative. */
    }
  };
  function write(key: string, value: string) {
    const result = writes.then(async () => {
      if (bridge) {
        if (!(await bridge.setLocalStorage(key, value)))
          throw Error('Even could not save your settings. Please reopen Alfred and try again.');
        cache(key, value);
      } else browser.setItem(key, value);
    });
    writes = result.catch(() => {});
    return result;
  }
  return {
    write,
    async read(key: string) {
      await writes;
      if (!bridge) return cached(key);
      // A failed native read must not overwrite an existing native credential.
      const native = await bridge.getLocalStorage(key);
      if (native) {
        cache(key, native);
        return native;
      }
      const legacy = cached(key);
      if (legacy) await write(key, legacy);
      return legacy;
    },
  };
}
