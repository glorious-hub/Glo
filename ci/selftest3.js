// CI: the app's screen was closed while idle in the background and opened again; the same page and model must be there.
(async () => {
  const log = (...a) => console.log('GLOK_SELFTEST ' + a.join(' '));
  const $ = s => document.querySelector(s);
  try {
    log('kept', 'page=' + (window.__glokMark ? 'same' : 'new'), 'model=' + ($('#dot').classList.contains('on') ? 'ready' : 'not-ready'),
      GlokNative.bgState(), GlokNative.engineInfo());
  } catch (e) {
    log('error3', e && e.message);
  }
})();
