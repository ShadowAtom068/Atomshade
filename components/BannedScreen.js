'use client';

import { I } from './Icons';
import AtomLogo from './AtomLogo';

// Shown instead of the app when an admin has suspended this account.
export default function BannedScreen({ reason, onLogout }) {
  return (
    <div className="auth-wrap">
      <div className="auth-card" role="alert">
        <div className="auth-brand"><AtomLogo size={36} /><span className="logo-text">Atomshade</span></div>
        <h1><I n="ban" s={22} /> Account suspended</h1>
        <p className="sub">An admin has suspended this account, so you cannot send messages, calls or statuses.</p>
        {reason ? <p className="sub"><b>Reason:</b> {reason}</p> : null}
        <p className="sub">If you think this is a mistake, contact the person who runs Atomshade.</p>
        <button type="button" className="btn-primary" onClick={onLogout}>Log out</button>
      </div>
    </div>
  );
}
