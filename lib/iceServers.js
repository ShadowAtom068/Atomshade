// The list of "helper servers" a call uses to find a path between two phones.
// 1. STUN (free, from Google): works on many home and office networks.
// 2. TURN relay: needed on many mobile-data networks. By default Atomshade uses the free public
//    "Open Relay" from Metered (fine for demos and small groups, but shared and limited).
//    For real users, rent your own relay (Metered, Twilio, Xirsys or coturn) and put these three
//    lines in .env.local (or the Vercel Environment Variables), then restart/redeploy:
//      NEXT_PUBLIC_TURN_URL=turn:your-server.example.com:3478,turns:your-server.example.com:443?transport=tcp
//      NEXT_PUBLIC_TURN_USERNAME=...
//      NEXT_PUBLIC_TURN_CREDENTIAL=...
export function getIceServers() {
  const servers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  const url = process.env.NEXT_PUBLIC_TURN_URL;
  if (url) {
    servers.push({
      urls: url.split(',').map((u) => u.trim()).filter(Boolean),
      username: process.env.NEXT_PUBLIC_TURN_USERNAME || '',
      credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL || '',
    });
  } else {
    servers.push({
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turns:openrelay.metered.ca:443?transport=tcp',
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject',
    });
  }
  return servers;
}

export function hasTurn() {
  return true;
}
