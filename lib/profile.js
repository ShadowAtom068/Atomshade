import { supabase } from './supabase';

// Your own profile (including email and phone, which other people can never read).
export async function loadMyProfile() {
  const { data, error } = await supabase.rpc('my_profile');
  if (error) return { profile: null, error };
  const row = Array.isArray(data) ? data[0] : data;
  return { profile: row || null, error: null };
}

// Save name / about / phone, then reload the profile.
export async function saveMyProfile(id, fields) {
  const { error } = await supabase.from('profiles').update(fields).eq('id', id);
  if (error) return { profile: null, error };
  return loadMyProfile();
}
