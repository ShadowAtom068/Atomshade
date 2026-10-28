'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';

const FRESH_MS = 40000; // a ringing call older than this is treated as missed

// Watches the `calls` table for someone ringing me. Returns the call that is ringing right now
// (or null) and a function to forget it.
export function useIncomingCalls(meId, isBusy) {
  const [incoming, setIncoming] = useState(null);
  const seen = useRef(new Set());
  const busyRef = useRef(isBusy);
  busyRef.current = isBusy;

  const clear = useCallback((id) => {
    setIncoming((cur) => (cur && (!id || cur.id === id) ? null : cur));
  }, []);

  useEffect(() => {
    let alive = true;

    async function consider(row) {
      if (!alive || !row || row.status !== 'ringing' || row.callee_id !== meId) return;
      if (Date.now() - new Date(row.created_at).getTime() > FRESH_MS) return;
      if (seen.current.has(row.id)) return;
      seen.current.add(row.id);
      // Already on a call (or already ringing): tell the caller I am busy.
      if (busyRef.current) {
        supabase.rpc('update_call', { p_call: row.id, p_action: 'decline' }).then(() => {});
        return;
      }
      const { data } = await supabase.from('profiles').select('name').eq('id', row.caller_id).maybeSingle();
      if (!alive) return;
      setIncoming((cur) => {
        if (cur) {
          supabase.rpc('update_call', { p_call: row.id, p_action: 'decline' }).then(() => {});
          return cur;
        }
        return { id: row.id, caller_id: row.caller_id, media: row.media, callerName: (data && data.name) || 'Someone' };
      });
    }

    const channel = supabase
      .channel(`incoming-calls:${meId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'calls', filter: `callee_id=eq.${meId}` }, (p) => {
        consider(p.new);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'calls', filter: `callee_id=eq.${meId}` }, (p) => {
        // Caller hung up before I answered.
        if (p.new && p.new.status !== 'ringing') clear(p.new.id);
      })
      .subscribe((status) => {
        if (status !== 'SUBSCRIBED' || !alive) return;
        // Catch a call that started a moment before we were listening.
        supabase
          .from('calls')
          .select('id, caller_id, callee_id, media, status, created_at')
          .eq('callee_id', meId)
          .eq('status', 'ringing')
          .gt('created_at', new Date(Date.now() - FRESH_MS).toISOString())
          .order('created_at', { ascending: false })
          .limit(1)
          .then(({ data }) => data && data[0] && consider(data[0]));
      });

    return () => {
      alive = false;
      supabase.removeChannel(channel);
    };
  }, [meId, clear]);

  return { incoming, clear };
}
