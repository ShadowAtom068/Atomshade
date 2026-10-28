# Atomshade v0.7.1 (updated): Throw Shade, secret chats and tighter security

## What's new
- Throw Shade: anonymous messages inside a group of 3 or more (new Shade tab).
- Secret chats: end-to-end encrypted, text only (tick "Secret chat" when starting a chat).
- Vibes (a mood next to your name), Inner Orbit (private status updates), Time capsules (the ⏳ button schedules a message).
- Block and Report; phone numbers and emails are now private (search works by name, or a COMPLETE phone number / email).
- Security headers, rate limits, locked-down database permissions.

## Steps (in this order, one at a time)
1. Copy the new files over your project. KEEP your .env.local.
2. Supabase -> SQL Editor -> New query. Paste and Run each file, one after the other. Each must say "Success":
   1. supabase/repair-messages.sql  (only if you have not run it yet)
   2. supabase/update-v0.7.1-fixes.sql  (only if you have not run it yet)
   3. supabase/update-phone-numbers.sql
   4. supabase/update-security.sql
   5. supabase/update-shade-features.sql
   6. supabase/update-chat-options.sql   (edit name, archive, lock, group rename. Already applied to the live project)
   (update-status-music.sql: status songs. Already applied to the live project)
   8. supabase/update-push.sql   (notifications. You paste this one yourself; also deploy supabase/functions/push, already done for the live project)
   7. supabase/fix-old-policies.sql   (already applied to the live project)
   8. supabase/update-video-chat.sql  (already applied to the live project)
   9. Security tidy-up: internal trigger functions locked (already applied)
  10. supabase/update-settings.sql  (Settings: privacy, disappearing messages, starred, blocked list. Already applied to the live project)
  11. supabase/update-settings-delete.sql  (YOU paste this one in the Supabase SQL Editor: un-star, delete my account, and the job that removes disappearing messages)
  12. supabase/update-whatsapp-extras.sql  (documents, location, polls, view once, reactions, edit, pin, mute. Already applied to the live project; the push function with mute support is also deployed)
  13. supabase/update-group-calls.sql  (stickers + group calls. Already applied to the live project; the push function now also rings group calls)
   If one fails, stop and send me a screenshot. Do not run the next one.
3. Stop the app (Ctrl+C) and run: npm run dev
4. Refresh. Open Atomshade once on every device so each person gets a secret-chat key.

## New in this version
Documents (PDF, Word, Excel, PowerPoint, text, CSV, ZIP up to 50 MB), share location, polls, emoji reactions, edit a sent message (15 minutes), forward (up to 5 chats), view once photos/videos, pin up to 3 chats, mute chats (8 hours / 1 week / always), and search inside a chat.

Also new: group voice/video calls (up to 4 people), stickers (built-in + your own pictures), emoji panel, fingerprint/face unlock for the app lock, "Log out other devices", Export chat, and Back up my chats (Settings).
GIF search is optional: get a free key at developers.giphy.com, add NEXT_PUBLIC_GIPHY_KEY (locally in .env.local, on Vercel in Environment Variables), then redeploy. Without it, the GIF tab is hidden (you can still send GIF files).

## Good to know (honest limits)
- Group calls: up to 4 people, every phone connected to every other phone. More than 4 needs a media server, which is a paid service. Calls, fingerprint unlock and location need an https address.
- Fingerprint unlock only replaces typing the PIN on the same device. The PIN always still works.
- "Other devices": your account already works on many phones/computers (log in anywhere). Secret chats stay tied to the device that holds their key; restore them with your backup passphrase.
- View once is "open once" inside Atomshade. It cannot stop someone taking a screenshot or photographing the screen, and the file stays in private storage until the chat is cleaned up.
- Location opens in OpenStreetMap or Google Maps only when someone taps the link. Sharing needs an https address.
- Secret chats stay text-only: no documents, polls, forwarding or server-side search (they are searched on your device).
- No app is "unhackable". This one follows strong practice: locked database rules, private files, rate limits, encrypted secret chats.
- Secret chats: the key lives on your device. Lost phone + no backup = old secret messages are gone. Make a passphrase backup in My profile. Compare the Safety code with your friend once.
- Normal chats are readable by the server (needed for reports and future search). Secret chats are not.
- Throw Shade is anonymous to friends, not to Atomshade moderators (needed so abuse can be reported).
- Calls are already encrypted device-to-device.
- Admin tasks (reports, usage): see ADMIN.md.
