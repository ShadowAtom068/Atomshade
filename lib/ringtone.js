// A soft repeating ring made with the browser's own audio. Never throws: if the browser
// blocks sound (it often does until the person has tapped something) the call still shows.
export function startRingtone() {
  let ctx = null;
  let timer = null;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return () => {};
    ctx = new AC();
    const beep = () => {
      try {
        if (ctx.state === 'suspended') ctx.resume();
        [0, 0.25].forEach((offset) => {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.type = 'sine';
          o.frequency.value = 523;
          g.gain.setValueAtTime(0.0001, ctx.currentTime + offset);
          g.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + offset + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + offset + 0.2);
          o.connect(g);
          g.connect(ctx.destination);
          o.start(ctx.currentTime + offset);
          o.stop(ctx.currentTime + offset + 0.22);
        });
      } catch (e) {
        /* ignore */
      }
    };
    beep();
    timer = setInterval(beep, 2200);
  } catch (e) {
    /* ignore */
  }
  return () => {
    try {
      if (timer) clearInterval(timer);
      if (ctx) ctx.close();
    } catch (e) {
      /* ignore */
    }
  };
}
