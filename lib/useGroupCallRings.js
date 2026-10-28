'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';

const FRESH_MS = 40000;

// Watches for a group call that someone just started in one of my groups.
export function useGroupCallRings(meId, isBusy) {
  const [ring, setRing] = useState(null);
  const seen = useRef(new Set());
  const busy = useRef(isBusy);
  busy.current = isBusy;
  const clear = useCallback((id) => setRing((cur) => (cur && (!id || cur.id === id) ? null : cur)), []);

  useEffect(() => {
    let alive = true;
    async function consider(row) {
      if (!alive || !row || row.status !== 'active' || row.started_by === meId) return;
      if (Date.now() - new Date(row.created_at).getTime() > FRESH_MS) return;
      if (seen.current.has(row.id) || busy.current) return;
      seen.current.add(row.id);
      const [{ data: who }, { data: grp }] = await Promise.all([
        supabase.from('profiles').select('name').eq('id', row.started_by).maybeSingle(),
        supabase.from('conversations').select('name').eq('id', row.conversation_id).maybeSingle(),
      ]);
      if (!alive) return;
      setRing((cur) => cur || { id: row.id, conversation_id: row.conversation_id, media: row.media, starterName: (who && who.name) || 'Someone', title: (grp && grp.name) || 'Group' });
    }
    const channel = supabase
      .channel(`group-rings:${meId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'group_calls' }, (p) => consider(p.new))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'group_calls' }, (p) => {
        if (p.new && p.new.status !== 'active') clear(p.new.id);
      })
      .subscribe((status) => {
        if (status !== 'SUBSCRIBED' || !alive) return;
        supabase
          .from('group_calls')
          .select('id, conversation_id, started_by, media, status, created_at')
          .eq('status', 'active')
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

  return { ring, clear };
}
