# Atomshade v0.7.1 — setup notes

**Start with `UPDATE-v0.7.1.md`** — it has the exact steps (including the new database file `supabase/update-v0.7.1-fixes.sql`).


This ZIP contains the app source code and Supabase migrations. It does not contain your private `.env.local` file or your Supabase secret credentials.

## What's new in v0.6

- Explore panel for channels and communities.
- Create and follow channels.
- Publish text updates to channels you follow.
- Create and join communities.
- SQL migration adds the channel/community tables and row-level security policies.

This is the first text-based implementation of channels and communities. Channel media, community chat rooms, and moderation tools are not included yet.

## Database migration order

Your existing Supabase project already has `profiles`, `conversations`, `conversation_members`, and `messages`. **Do not run `schema.sql` on that existing database.**

In Supabase on your phone, open **SQL Editor**. Run each migration in a separate query, in this order, and continue only if the previous one succeeds:

1. `supabase/update-v0.4.sql`
2. `supabase/update-v0.5.sql`
3. `supabase/update-v0.6.sql`
4. `supabase/update-v0.7.1-fixes.sql`

To use a migration, open the file in a text editor or file viewer, copy its full contents, paste into Supabase SQL Editor, and tap **Run**. If any migration shows an error, stop and share a screenshot of the error instead of running the next one.

These migrations modify your existing database by adding columns/tables/policies; they are not applied automatically just by downloading this ZIP.

## App configuration and deployment

- `.env.local` is intentionally not included. Never publish a file containing private credentials.
- The app needs `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` configured in the hosting provider's environment settings before it can connect to your Supabase project.
- The project uses Next.js 14 and requires dependency installation and a production build in a compatible Node.js environment. You can use a browser-based hosting workflow, but this ZIP itself does not publish the app online.

## Current limitations

- Communities are discoverable membership spaces; dedicated community chat rooms are not implemented yet.
- Channel posts are text-only.
- GIF search, sticker packs, and end-to-end encryption are not included in this v0.6 update.
