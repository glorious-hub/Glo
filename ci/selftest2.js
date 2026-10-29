// CI: second message; the test turns the screen off and forces Doze while it is written.
(async () => {
  const log = (...a) => console.log('GLOK_SELFTEST ' + a.join(' '));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const $ = s => document.querySelector(s);
  const replies = () => document.querySelectorAll('.msg.assistant').length;
  const lastReply = () => { const b = [...document.querySelectorAll('.msg.assistant .body')]; return b.length ? b[b.length - 1].textContent.trim() : ''; };
  try {
    await sleep(1000);
    const before = replies();
    $('#input').value = '우리 이번 주말에 뭐 할까? 자세히 얘기해 줘.';
    $('#input').dispatchEvent(new Event('input', { bubbles: true }));
    $('#send').click();
    log('sent2');
    const t0 = Date.now();
    await sleep(500);
    while ($('#send').classList.contains('stop') || replies() <= before) {
      if (Date.now() - t0 > 380000) throw new Error('reply timeout');
      await sleep(250);
    }
    log('reply2', ((Date.now() - t0) / 1000).toFixed(1) + 's', 'hidden=' + document.hidden, JSON.stringify(lastReply()));
  } catch (e) {
    log('error2', e && e.message);
  }
})();
