// Clear everything TC Cards kept on this phone, and drop any service worker still registered.
try {
  for (const key of Object.keys(localStorage)) if (key.startsWith('tc:')) localStorage.removeItem(key);
} catch { /* storage unavailable */ }
if ('caches' in window) caches.keys().then((keys) => keys.forEach((k) => caches.delete(k))).catch(() => {});
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister())).catch(() => {});
}
