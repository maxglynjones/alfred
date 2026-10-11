import { test } from 'node:test';
import assert from 'node:assert/strict';
import { persistentStorage } from '../src/state/storage';
const browser = () => {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
};
test('native pairing survives a fresh WebView and wins over stale browser storage', async () => {
  const data = new Map<string, string>();
  const bridge = {
    getLocalStorage: async (key: string) => data.get(key) ?? '',
    setLocalStorage: async (key: string, value: string) => {
      data.set(key, value);
      return true;
    },
  };
  await persistentStorage(browser(), bridge).write('assistant-pairing', 'native-token');
  const fresh = browser();
  fresh.setItem('assistant-pairing', 'old-token');
  assert.equal(await persistentStorage(fresh, bridge).read('assistant-pairing'), 'native-token');
});
test('legacy pairing migrates once; rejected native saves are reported and do not claim success', async () => {
  const old = browser();
  old.setItem('assistant-pairing', 'legacy-token');
  const data = new Map<string, string>();
  let count = 0;
  const bridge = {
    getLocalStorage: async (key: string) => data.get(key) ?? '',
    setLocalStorage: async (key: string, value: string) => {
      count++;
      data.set(key, value);
      return true;
    },
  };
  const store = persistentStorage(old, bridge);
  assert.equal(await store.read('assistant-pairing'), 'legacy-token');
  await store.read('assistant-pairing');
  assert.equal(count, 1);
  await assert.rejects(
    persistentStorage(browser(), { ...bridge, setLocalStorage: async () => false }).write(
      'assistant-pairing',
      'new-token',
    ),
    /could not save/,
  );
});
test('failed native reads never replace credentials; ordered preference writes recover after errors', async () => {
  const old = browser();
  old.setItem('assistant-pairing', 'stale');
  let writes = 0;
  await assert.rejects(
    persistentStorage(old, {
      getLocalStorage: async () => {
        throw Error('offline');
      },
      setLocalStorage: async () => {
        writes++;
        return true;
      },
    }).read('assistant-pairing'),
  );
  assert.equal(writes, 0);
  const values: string[] = [];
  const store = persistentStorage(browser(), {
    getLocalStorage: async () => '',
    setLocalStorage: async (_, value) => {
      values.push(value);
      return values.length !== 1;
    },
  });
  const first = store.write('focus', 'first');
  const second = store.write('focus', 'second');
  await assert.rejects(first);
  await second;
  assert.deepEqual(values, ['first', 'second']);
});
