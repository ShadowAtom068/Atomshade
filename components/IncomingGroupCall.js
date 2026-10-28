'use client';

import { I } from './Icons';
import { useEffect } from 'react';
import { startRingtone } from '../lib/ringtone';

// "Someone started a group call" pop-up.
export default function IncomingGroupCall({ ring, onJoin, onDismiss }) {
  useEffect(() => {
    const stop = startRingtone();
    const t = setTimeout(onDismiss, 40000);
    return () => {
      stop();
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ring.id]);
  return (
    <div className="call-backdrop" role="alertdialog" aria-modal="true" aria-label="Group call">
      <section className="call-card">
        <div className="call-card-head">
          <div>
            <span className="call-eyebrow">GROUP {ring.media === 'video' ? 'VIDEO' : 'VOICE'} CALL</span>
            <h2>{ring.title}</h2>
            <p>{ring.starterName} started a call</p>
          </div>
        </div>
        <div className="call-audio-stage"><div className="call-avatar"><I n="people" /></div></div>
        <div className="call-incoming-actions">
          <button className="call-accept" onClick={onJoin}>{ring.media === 'video' ? 'Join' : 'Join'}</button>
          <button className="call-decline" onClick={onDismiss}>Not now</button>
        </div>
      </section>
    </div>
  );
}
