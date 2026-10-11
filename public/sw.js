// Retired Web Push worker: clear its old subscription without caching private data.
self.addEventListener('activate', (event) =>
  event.waitUntil(
    (async () => {
      const subscription = await self.registration.pushManager.getSubscription();
      if (subscription) await subscription.unsubscribe();
      await self.registration.unregister();
    })(),
  ),
);
