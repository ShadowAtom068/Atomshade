'use client';

import { useEffect } from 'react';
import { startRingtone } from '../lib/ringtone';

// The "someone is calling you" pop-up. It rings until you answer, say no, or 45 seconds pass.
export default function IncomingCall({ call, onAccept, onDecline, onTimeout }) {
  useEffect(() => {
    const stop = startRingtone();
    const t = setTimeout(onTimeout, 45000);
    return () => {
      stop();
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call.id]);

  return (
    <div className="call-backdrop" role="alertdialog" aria-modal="true" aria-label="Incoming call">
      <section className="call-card">
        <div className="call-card-head">
          <div>
            <span className="call-eyebrow">INCOMING {call.media === 'video' ? 'VIDEO' : 'VOICE'} CALL</span>
            <h2>{call.callerName}</h2>
            <p>is calling you…</p>
          </div>
        </div>
        <div className="call-audio-stage">
          <div className="call-avatar">{(call.callerName || '?').slice(0, 1).toUpperCase()}</div>
        </div>
        <div className="call-incoming-actions">
          <button className="call-accept" onClick={onAccept}>
            {call.media === 'video' ? 'Accept' : 'Accept'}
          </button>
          <button className="call-decline" onClick={onDecline}>
            Decline
          </button>
        </div>
      </section>
    </div>
  );
}
