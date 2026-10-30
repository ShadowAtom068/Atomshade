'use client';

import { I } from './Icons';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { formatTime } from '../lib/format';

const KIND = { user: 'Person', message: 'Message', shade: 'Shade', status: 'Status' };
const STATE = { open: 'Open', reviewed: 'Reviewed', actioned: 'Banned / actioned', dismissed: 'Dismissed' };

function friendly(e) {
  if (!e) return '';
  if (e.code === 'PGRST202') return 'The admin tools need the latest database update (update-calls-views-bans.sql).';
  return e.message || 'Something went wrong.';
}

// The owner's page: read reports, ban or unban accounts. Only people listed as admins get any data from it.
export default function AdminPanel({ onClose, onChanged }) {
  const [tab, setTab] = useState('open'); // 'open' | 'handled' | 'banned'
  const [rows, setRows] = useState(null);
  const [banned, setBanned] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [banFor, setBanFor] = useState(null); // { id, name, reason }

  const load = useCallback(async () => {
    setError('');
    if (tab === 'banned') {
      const { data, error: e } = await supabase.rpc('admin_banned_list');
      if (e) { setError(friendly(e)); setBanned([]); return; }
      setBanned(Array.isArray(data) ? data : []);
    } else {
      const { data, error: e } = await supabase.rpc('admin_reports', { p_status: tab === 'open' ? 'open' : 'all' });
      if (e) { setError(friendly(e)); setRows([]); return; }
      const list = Array.isArray(data) ? data : [];
      setRows(tab === 'open' ? list : list.filter((r) => r.status !== 'open'));
    }
  }, [tab]);

  useEffect(() => {
    setRows(null);
    setBanned(null);
    load();
  }, [load]);

  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && !banFor && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose, banFor]);

  async function run(fn) {
    setBusy(true);
    setError('');
    const { error: e } = await fn();
    setBusy(false);
    if (e) { setError(friendly(e)); return false; }
    await load();
    onChanged && onChanged();
    return true;
  }
  const setStatus = (id, status) => run(() => supabase.rpc('admin_set_report', { p_id: id, p_status: status }));
  const unban = (id) => run(() => supabase.rpc('admin_unban', { p_user: id }));
  async function confirmBan() {
    const ok = await run(() => supabase.rpc('admin_ban', { p_user: banFor.id, p_reason: banFor.reason.trim() }));
    if (ok) setBanFor(null);
  }

  return (
    <div className="modal-bg" style={{ zIndex: 70 }} onClick={onClose}>
      <div className="modal admin-panel" role="dialog" aria-modal="true" aria-label="Admin" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3><I n="adminShield" /> Admin</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><I n="close" /></button>
        </div>
        <div className="seg admin-tabs" role="tablist">
          {[['open', 'Reports'], ['handled', 'Handled'], ['banned', 'Banned']].map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>
        <div className="admin-body">
          {error && <div className="error" role="alert">{error}</div>}

          {tab !== 'banned' && rows === null && <p className="list-empty">Loading…</p>}
          {tab !== 'banned' && rows && rows.length === 0 && !error && (
            <p className="list-empty">{tab === 'open' ? 'No reports waiting. Nice and quiet.' : 'Nothing handled yet.'}</p>
          )}
          {tab !== 'banned' && rows && rows.map((r) => (
            <article key={r.id} className="report-card">
              <div className="report-top">
                <span className="report-kind">{KIND[r.kind] || r.kind}</span>
                <span className={`report-state ${r.status}`}>{STATE[r.status] || r.status}</span>
                <small>{formatTime(r.created_at)}</small>
              </div>
              <p className="report-line"><b>{r.reported_name || 'Unknown person'}</b> {r.reported_email ? <small>({r.reported_email})</small> : null}</p>
              <p className="report-sub">Reported by {r.reporter_name || 'someone'}{r.reporter_email ? ` (${r.reporter_email})` : ''}</p>
              {r.reports_against > 1 && <p className="report-flag"><I n="alert" s={14} /> {r.reports_against} reports against this person in total</p>}
              {r.reason && <p className="report-reason">“{r.reason}”</p>}
              {r.evidence && (
                <details className="report-evidence">
                  <summary>What was reported {r.evidence_verified ? '(copied from the database)' : '(sent by the reporter’s phone, not verified)'}</summary>
                  <pre>{r.evidence}</pre>
                </details>
              )}
              <div className="report-actions">
                {r.reported_id && !r.reported_banned && (
                  <button type="button" className="btn-danger" disabled={busy} onClick={() => setBanFor({ id: r.reported_id, name: r.reported_name || 'this person', reason: r.reason || '' })}>Ban account</button>
                )}
                {r.reported_banned && <button type="button" className="btn-ghost" disabled={busy} onClick={() => unban(r.reported_id)}>Unban</button>}
                {r.status === 'open' && <button type="button" className="btn-ghost" disabled={busy} onClick={() => setStatus(r.id, 'reviewed')}>Mark reviewed</button>}
                {r.status !== 'dismissed' && <button type="button" className="btn-ghost" disabled={busy} onClick={() => setStatus(r.id, 'dismissed')}>Dismiss</button>}
              </div>
            </article>
          ))}

          {tab === 'banned' && banned === null && <p className="list-empty">Loading…</p>}
          {tab === 'banned' && banned && banned.length === 0 && !error && <p className="list-empty">Nobody is banned.</p>}
          {tab === 'banned' && banned && banned.map((b) => (
            <article key={b.user_id} className="report-card">
              <p className="report-line"><b>{b.name || 'Unknown person'}</b> {b.email ? <small>({b.email})</small> : null}</p>
              <p className="report-sub">Banned {formatTime(b.banned_at)}{b.reason ? ` · ${b.reason}` : ''}</p>
              <div className="report-actions">
                <button type="button" className="btn-ghost" disabled={busy} onClick={() => unban(b.user_id)}>Unban</button>
              </div>
            </article>
          ))}
        </div>
      </div>

      {banFor && (
        <div className="modal-bg" style={{ zIndex: 75 }} onClick={() => !busy && setBanFor(null)}>
          <div className="modal" role="alertdialog" aria-modal="true" aria-label="Ban account" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><h3>Ban {banFor.name}?</h3></div>
            <p className="modal-sub">They are logged out, cannot log in again, and cannot send anything. You can unban them later.</p>
            <div className="pad-field">
              <input placeholder="Reason (they will see this)" value={banFor.reason} maxLength={300} onChange={(e) => setBanFor({ ...banFor, reason: e.target.value })} aria-label="Reason" />
            </div>
            <div className="modal-foot row-gap">
              <button type="button" className="btn-ghost" disabled={busy} onClick={() => setBanFor(null)}>Cancel</button>
              <button type="button" className="btn-danger" disabled={busy} onClick={confirmBan}>{busy ? 'Banning…' : 'Ban account'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
