// Runs in <head>, before the page is first drawn, so a Dark pick in About shows from the very
// first frame instead of flashing the default light page. app.js owns the theme (THEME_KEY,
// THEME_COLORS, applyTheme) and applies it again once it loads; keep the two in step.
try {
  if (JSON.parse(localStorage.getItem('tc:theme')) === 'dark') {
    document.documentElement.dataset.theme = 'dark';
    document.querySelector('meta[name="theme-color"]').setAttribute('content', '#17120e');
  }
} catch { /* storage blocked or unreadable: stay light */ }
