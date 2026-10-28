// One consistent set of line icons for the whole app (same size, same stroke, same style).
// They use currentColor, so they follow the theme and the "on" colour of whatever button holds them.
const base = (size) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: 'false',
});

const make = (children) =>
  function Icon({ size = 22 }) {
    return <svg {...base(size)}>{children}</svg>;
  };

export const IconChat = make(<path d="M21 11.5a8.4 8.4 0 0 1-12.3 7.4L3 20.5l1.7-5.4A8.4 8.4 0 1 1 21 11.5Z" />);
export const IconStatus = make(
  <>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M12 3a9 9 0 0 1 7.8 4.5M21 12a9 9 0 0 1-4.5 7.8M12 21a9 9 0 0 1-7.8-4.5M3 12a9 9 0 0 1 4.5-7.8" />
  </>
);
// A hooded "shade" face: anonymous messages.
export const IconShade = make(
  <>
    <path d="M12 3c-4.4 0-7 3-7 7.2V21l2.6-2 2.2 2 2.2-2 2.2 2 2.2-2L19 21V10.2C19 6 16.4 3 12 3Z" />
    <path d="M9 10.5h.01M15 10.5h.01" strokeWidth="2.6" />
  </>
);
export const IconPeople = make(
  <>
    <circle cx="9" cy="8.5" r="3.3" />
    <path d="M2.8 20c.5-3.4 3-5.5 6.2-5.5s5.7 2.1 6.2 5.5" />
    <path d="M16 5.4a3.2 3.2 0 0 1 0 6.2M18.6 14.9c1.5.8 2.4 2.3 2.6 5.1" />
  </>
);
export const IconPhone = make(
  <path d="M5 3.5h3.2l1.6 4.4-2 1.3a11 11 0 0 0 5 5l1.3-2 4.4 1.6V17A2.5 2.5 0 0 1 16.2 19.5C9.7 19 5 14.3 4.5 7.8A2.5 2.5 0 0 1 5 3.5Z" />
);
export const IconVideo = make(
  <>
    <rect x="3" y="6.5" width="12.5" height="11" rx="2.6" />
    <path d="m15.5 10.5 5-3v9l-5-3" />
  </>
);
export const IconPlus = make(<path d="M12 5v14M5 12h14" />);
export const IconNewChat = make(
  <>
    <path d="M20 13.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4.5" />
    <path d="M17.2 3.6a1.9 1.9 0 0 1 2.7 2.7L12 14.2 8.5 15l.8-3.5 7.9-7.9Z" />
  </>
);
export const IconGear = make(
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 14.6a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3h0a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5h0a1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8v0a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" />
  </>
);
export const IconLogout = make(
  <>
    <path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3" />
    <path d="m16 8 4 4-4 4M20 12H9" />
  </>
);
export const IconSearch = make(
  <>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.2-4.2" />
  </>
);
export const IconClip = make(
  <path d="M21 12.5l-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l9-9a3.7 3.7 0 0 1 5.2 5.2l-9 9a1.8 1.8 0 0 1-2.6-2.6l8.3-8.3" />
);
export const IconSmile = make(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M8.2 14.2a4.2 4.2 0 0 0 7.6 0M9 9.6h.01M15 9.6h.01" />
  </>
);
// Hourglass: "send later" (Time Capsule).
export const IconTimer = make(
  <>
    <path d="M6 3h12M6 21h12" />
    <path d="M7.5 3c0 4 2.2 5.2 4.5 9-2.3 3.8-4.5 5-4.5 9M16.5 3c0 4-2.2 5.2-4.5 9 2.3 3.8 4.5 5 4.5 9" />
  </>
);
export const IconSend = make(<path d="M21 3 10.5 13.5M21 3l-6.8 18-3.7-7.5L3 9.8 21 3Z" />);
export const IconMic = make(
  <>
    <rect x="9" y="3" width="6" height="12" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </>
);
export const IconBack = make(<path d="M15 5 8 12l7 7" />);
export const IconMore = make(
  <>
    <circle cx="12" cy="5.5" r="1.2" />
    <circle cx="12" cy="12" r="1.2" />
    <circle cx="12" cy="18.5" r="1.2" />
  </>
);
export const IconClose = make(<path d="M6 6l12 12M18 6 6 18" />);
export const IconBellOff = make(
  <>
    <path d="M9.5 20a2.6 2.6 0 0 0 5 0M6 8a6 6 0 0 1 9.6-4.8M18 9.5c0 4 1.5 5.5 2 6.5H5.5M3 3l18 18" />
  </>
);
export const IconPin = make(<path d="m15 3 6 6-3 1-3.5 3.5.5 4-1.5 1.5-3.8-3.8L5 20.5 3.5 19l5.3-5.7L5 9.5 6.5 8l4 .5L14 5l1-2Z" />);
export const IconArchive = make(
  <>
    <rect x="3" y="4" width="18" height="4.5" rx="1.2" />
    <path d="M5 8.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5M10 12.5h4" />
  </>
);
export const IconLock = make(
  <>
    <rect x="5" y="10.5" width="14" height="10" rx="2.2" />
    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
  </>
);
export const IconImage = make(
  <>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2.6" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="m4 17 5-4.5 3.5 3L16 12l4 4" />
  </>
);
export const IconOnce = make(
  <>
    <circle cx="12" cy="12" r="9" strokeDasharray="3 3" />
    <path d="M10.2 9.6 12.4 8v8" />
  </>
);
export const IconFile = make(
  <>
    <path d="M6.5 3h7.2L19 8.3V19a2 2 0 0 1-2 2H6.5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
    <path d="M13.5 3v5.5H19M8 13h8M8 16.5h5" />
  </>
);
export const IconLocation = make(
  <>
    <path d="M12 21s7-6.2 7-11.2A7 7 0 0 0 5 9.8C5 14.8 12 21 12 21Z" />
    <circle cx="12" cy="9.8" r="2.4" />
  </>
);
export const IconPoll = make(<path d="M5 20V10M12 20V4M19 20v-7" strokeWidth="2.6" />);

// ---- More Lucide-style icons, and a name lookup so any screen can write <I n="camera" /> ----
export const IconCamera = make(
  <>
    <path d="M4 8h3l1.6-2.5h6.8L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
    <circle cx="12" cy="13" r="3.6" />
  </>
);
export const IconBell = make(<path d="M6 8a6 6 0 0 1 12 0c0 6 2.2 7.5 2.2 7.5H3.8S6 14 6 8ZM9.8 19.5a2.4 2.4 0 0 0 4.4 0" />);
export const IconStar = make(<path d="m12 3.2 2.7 5.5 6 .9-4.4 4.2 1 6-5.3-2.8-5.3 2.8 1-6L3.3 9.6l6-.9L12 3.2Z" />);
export const IconPencil = make(<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4ZM13.5 6.5l4 4" />);
export const IconForward = make(<path d="m15 4 6 6-6 6M21 10H9a5 5 0 0 0-5 5v4" />);
export const IconReply = make(<path d="m9 4-6 6 6 6M3 10h12a5 5 0 0 1 5 5v4" />);
export const IconCheck = make(<path d="m4.5 12.5 5 5L19.5 7" />);
export const IconCheckSquare = make(
  <>
    <rect x="4" y="4" width="16" height="16" rx="3" />
    <path d="m8.5 12.2 2.4 2.4 4.6-4.9" />
  </>
);
export const IconSquare = make(<rect x="4" y="4" width="16" height="16" rx="3" />);
export const IconGlobe = make(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9s-1.2 6.4-3.8 9c-2.6-2.6-3.8-5.6-3.8-9S9.4 5.6 12 3Z" />
  </>
);
export const IconMusic = make(
  <>
    <path d="M9 18V5l11-2v13" />
    <circle cx="6.5" cy="18" r="2.5" />
    <circle cx="17.5" cy="16" r="2.5" />
  </>
);
export const IconMegaphone = make(<path d="M3 10v4a1 1 0 0 0 1 1h2.5l8.5 4.5V4.5L6.5 9H4a1 1 0 0 0-1 1ZM19 9.5a4 4 0 0 1 0 5" />);
export const IconShield = make(<path d="M12 3 5 5.8v5.6c0 4.3 2.9 8 7 9.6 4.1-1.6 7-5.3 7-9.600V5.800L12 3Z" />);
export const IconMoon = make(<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.500Z" />);
export const IconSun = make(
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.500v2M2.5 12h2M19.5 12h2M5.3 5.300l1.4 1.400M17.3 17.300l1.4 1.400M5.3 18.700l1.4-1.400M17.3 6.700l1.4-1.4" />
  </>
);
export const IconDownload = make(<path d="M12 4v11M7 11l5 5 5-5M5 20h14" />);
export const IconUpload = make(<path d="M12 16V5M7 9l5-5 5 5M5 20h14" />);
export const IconUnlock = make(
  <>
    <rect x="5" y="10.5" width="14" height="10" rx="2.2" />
    <path d="M8 10.5V8a4 4 0 0 1 7.7-1.5" />
  </>
);
export const IconBan = make(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="m5.6 5.6 12.8 12.8" />
  </>
);
export const IconVolume = make(<path d="M4 9.500v5h3.500L12 18.500v-13L7.5 9.500H4ZM15.5 9a4 4 0 0 1 0 6M18 6.500a7.5 7.5 0 0 1 0 11" />);
export const IconVolumeOff = make(<path d="M4 9.500v5h3.500L12 18.500v-13L7.5 9.500H4ZM16 9.500l5 5M21 9.500l-5 5" />);
export const IconPlay = make(<path d="M7 4.500v15l12-7.500L7 4.500Z" />);
export const IconScissors = make(
  <>
    <circle cx="6" cy="6.5" r="2.8" />
    <circle cx="6" cy="17.5" r="2.8" />
    <path d="M8.2 8.3 20 18M8.2 15.7 20 6" />
  </>
);
export const IconAlert = make(<path d="M12 4 2.8 19.500h18.400L12 4ZM12 10v4.500M12 17.300h.01" />);
export const IconUndo = make(<path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" />);
export const IconUser = make(
  <>
    <circle cx="12" cy="8" r="4" />
    <path d="M4.5 20.500c.7-4 3.7-6 7.5-6s6.8 2 7.5 6" />
  </>
);
export const IconArrowRight = make(<path d="M5 12h14M13 6l6 6-6 6" />);
export const IconCallOut = make(<path d="M7 17 17 7M9 7h8v8" />);
export const IconCallIn = make(<path d="M17 7 7 17M7 9v8h8" />);
export const IconPhoneDevice = make(
  <>
    <rect x="7" y="2.5" width="10" height="19" rx="2.4" />
    <path d="M11 18.500h2" />
  </>
);
export const IconInfo = make(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5.500M12 7.800h.01" />
  </>
);
export const IconCheckCheck = make(<path d="m1.5 12.5 5 5L16 7M10 16.500l1 1L21.5 7" />);

const NAMES = {
  close: IconClose, lock: IconLock, unlock: IconUnlock, timer: IconTimer, camera: IconCamera, video: IconVideo,
  phone: IconPhone, plus: IconPlus, volumeoff: IconVolumeOff, volume: IconVolume, bell: IconBell, bellOff: IconBellOff,
  shade: IconShade, ban: IconBan, pencil: IconPencil, pin: IconPin, star: IconStar, send: IconSend, back: IconBack,
  poll: IconPoll, arrowRight: IconArrowRight, people: IconPeople, music: IconMusic, play: IconPlay, mic: IconMic,
  upload: IconUpload, archive: IconArchive, location: IconLocation, forward: IconForward, megaphone: IconMegaphone,
  file: IconFile, search: IconSearch, alert: IconAlert, undo: IconUndo, scissors: IconScissors, check: IconCheck,
  checkSquare: IconCheckSquare, square: IconSquare, gear: IconGear, shield: IconShield, chat: IconChat, moon: IconMoon,
  sun: IconSun, phoneDevice: IconPhoneDevice, download: IconDownload, user: IconUser, globe: IconGlobe, smile: IconSmile,
  callOut: IconCallOut, callIn: IconCallIn, info: IconInfo, reply: IconReply, checkCheck: IconCheckCheck, image: IconImage,
  more: IconMore, status: IconStatus, clip: IconClip, newChat: IconNewChat, logout: IconLogout,
};

// Inline icon for use inside text: <I n="lock" />. Sits on the text baseline and takes the text colour.
export function I({ n, s = 16 }) {
  const C = NAMES[n];
  if (!C) return null;
  return (
    <span className="ico" style={{ display: 'inline-flex', verticalAlign: '-0.18em', margin: '0 0.25em 0 0' }}>
      <C size={s} />
    </span>
  );
}
