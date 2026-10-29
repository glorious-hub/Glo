// CI: started inside the debug app on the emulator. Waits for the model, sends one message, reports the reply.
(async () => {
  const log = (...a) => console.log('GLOK_SELFTEST ' + a.join(' '));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const $ = s => document.querySelector(s);
  const replies = () => document.querySelectorAll('.msg.assistant').length;
  const lastReply = () => { const b = [...document.querySelectorAll('.msg.assistant .body')]; return b.length ? b[b.length - 1].textContent.trim() : ''; };
  try {
    window.__glokMark = 'p' + Date.now(); // stays as long as this page lives (checked after the screen comes back)
    log('start', GlokNative.bgState(), GlokNative.appInfo());
    log('popup', String(!$('#bgModalScrim').hidden));
    let t0 = Date.now();
    while (!$('#dot').classList.contains('on')) {
      if (Date.now() - t0 > 280000) throw new Error('load timeout: ' + $('#modelState').textContent);
      await sleep(500);
    }
    log('loaded', JSON.stringify($('#modelName').textContent), ((Date.now() - t0) / 1000).toFixed(1) + 's', GlokNative.engineInfo());
    await sleep(3000);
    const before = replies();
    $('#input').value = '안녕? 오늘 하루 어땠어?';
    $('#input').dispatchEvent(new Event('input', { bubbles: true }));
    $('#send').click();
    log('sent');
    t0 = Date.now();
    await sleep(500);
    while ($('#send').classList.contains('stop') || replies() <= before) {
      if (Date.now() - t0 > 380000) throw new Error('reply timeout');
      await sleep(250);
    }
    log('reply', ((Date.now() - t0) / 1000).toFixed(1) + 's', 'hidden=' + document.hidden, JSON.stringify(lastReply()));
    log('speed', localStorage.getItem('glok.v2.speed'));
  } catch (e) {
    log('error', e && e.message);
  }
})();
