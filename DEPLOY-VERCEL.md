# Put Atomshade on Vercel (gives you a https link that works on every phone)

1. Go to github.com, create a free account, click New repository, name it atomshade, keep it Private.
2. Upload the project: on the empty repo page click "uploading an existing file", drag in everything inside the unzipped atomshade folder (NOT the zip itself, and never .env.local), then Commit.
3. Go to vercel.com, sign up with GitHub, click Add New -> Project, pick atomshade, Framework = Next.js (auto).
4. Before clicking Deploy open "Environment Variables" and add these two (copy them from your .env.local):
      NEXT_PUBLIC_SUPABASE_URL
      NEXT_PUBLIC_SUPABASE_ANON_KEY
   Click Deploy. In about 2 minutes you get a link like https://atomshade.vercel.app
5. Supabase dashboard -> Authentication -> URL Configuration:
      Site URL  = your Vercel link
      Redirect URLs -> add  https://YOUR-LINK.vercel.app/**   (keep the http://localhost:3000/** one too)
6. If you use Google login: Google Cloud Console -> your OAuth client -> nothing to change for the Vercel link, Google only needs the Supabase callback address you already added.
7. Open the Vercel link on your phone, log in, then "Add to Home screen" to install it.
Calls and secret chats work now because https is secure. Calls use a free public relay (Open Relay) automatically, so they work on most mobile networks. For many real users, rent your own relay and add NEXT_PUBLIC_TURN_URL, NEXT_PUBLIC_TURN_USERNAME and NEXT_PUBLIC_TURN_CREDENTIAL in Vercel, then Redeploy.
