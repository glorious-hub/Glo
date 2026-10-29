// CI: Android closed the app for memory and brought the service back; opening the app must find the model ready
// (loaded again by the service, not by the page) and answer. The test sends the app to the background after "sent4".
(async () => {
  const log = (...a) => console.log('GLOK_SELFTEST ' + a.join(' '));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const $ = s => document.querySelector(s);
  const replies = () => document.querySelectorAll('.msg.assistant').length;
  const lastReply = () => { const b = [...document.querySelectorAll('.msg.assistant .body')]; return b.length ? b[b.length - 1].textContent.trim() : ''; };
  try {
    let t0 = Date.now();
    while (!$('#dot').classList.contains('on')) {
      if (Date.now() - t0 > 120000) throw new Error('not ready: ' + $('#modelState').textContent);
      await sleep(200);
    }
    log('restored', ((Date.now() - t0) / 1000).toFixed(1) + 's', GlokNative.bgState(), GlokNative.engineInfo());
    await sleep(1000);
    const before = replies();
    $('#input').value = '보고 싶었어. 지금 뭐 해?';
    $('#input').dispatchEvent(new Event('input', { bubbles: true }));
    $('#send').click();
    log('sent4');
    t0 = Date.now();
    await sleep(500);
    while ($('#send').classList.contains('stop') || replies() <= before) {
      if (Date.now() - t0 > 380000) throw new Error('reply timeout');
      await sleep(250);
    }
    log('reply4', ((Date.now() - t0) / 1000).toFixed(1) + 's', 'hidden=' + document.hidden, JSON.stringify(lastReply()));
  } catch (e) {
    log('error4', e && e.message);
  }
})();
