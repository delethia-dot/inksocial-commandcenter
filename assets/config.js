// Agent Command Center configuration.
//
// Safe to publish: the Supabase publishable key only allows what row-level
// security allows, and the run log is readable by admin logins only.

export const SUPABASE_URL = "https://oxgmypmwkjrkkbwduldb.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_GKkZkXTSJUfAaKM9_UdMlw_dizTrD9g";

// The InkSocial agents service on Railway (run research now, conversations, alerts).
export const AGENTS_API = "https://inksocialagents.up.railway.app";

// The agents. The key on the left must stay as is (it is what the agents write
// to the log); everything else is display. `color` is the avatar color.
export const AGENTS = {
  bootstrap: {
    name: "Clyde", role: "Client Setup agent", color: "#8FB8DE",
    short: "Sets up each new client once: voice, first research, welcome email.",
    does: "Runs once when a client is launched from onboarding. Has Brandy build the brand voice, marks the client ready, starts their first research with Richard, and sends the welcome email.",
    startedBy: "Launching a client from the portal's onboarding flow.",
    handsTo: ["brand_voice", "research"],
  },
  brand_voice: {
    name: "Brandy", role: "Brand Voice agent", color: "#E3A6C6",
    short: "Defines how each client sounds, so every caption and script matches.",
    does: "Studies the client's recent Instagram captions (or their saved settings when there are none) and writes their brand voice profile. Connor and Sierra write in that voice.",
    startedBy: "Client setup, and each client's brand voice schedule.",
    handsTo: [],
  },
  research: {
    name: "Richard", role: "Research agent", color: "#E8C267",
    short: "Finds what's outperforming in each client's niche and turns it into ideas.",
    does: "Scrapes competitor Instagram posts, scores each against that account's average to find outliers, pulls trending YouTube videos, and has Claude write the Key Patterns analysis and the week's content ideas. Flags bad data instead of hiding it.",
    startedBy: "Each client's research schedule (weekly or every two weeks, Mondays), or Run research now on this dashboard.",
    handsTo: ["content_strategy"],
  },
  content_strategy: {
    name: "Connor", role: "Content Strategy agent", color: "#9FD3A8",
    short: "Turns an approved idea into three hooks and a concept.",
    does: "Writes three hook options and a concept for an approved idea, in the client's brand voice, and sends them for the client to pick.",
    startedBy: "A client approving an idea, or submitting their own.",
    handsTo: ["script"],
  },
  script: {
    name: "Sierra", role: "Script agent", color: "#C3A6F0",
    short: "Writes the script, captions and hashtags for the chosen hook.",
    does: "Writes the full Reel script, three caption options and hashtags (or the copy for carousels, statics, Stories and infographics) and sends it for approval. Stops here for clients with video off.",
    startedBy: "A client picking a hook.",
    handsTo: ["video", "image_concept"],
  },
  video: {
    name: "Victor", role: "Video agent", color: "#F29E7C",
    short: "Cuts the client's footage, adds b-roll and assembles the video.",
    does: "Plans b-roll moments with Claude, generates b-roll, and assembles the finished video. Clients with video off never reach Victor.",
    startedBy: "A client uploading footage for an approved Reel script.",
    handsTo: ["image_concept", "packaging"],
  },
  image_concept: {
    name: "Imani", role: "Image Concept agent", color: "#7FD1CF",
    short: "Makes the visuals: covers, carousel slides, statics, Stories.",
    does: "Generates the cover for a Reel, or the finished images for carousels, statics, Stories and infographics, and tells the client their piece is ready.",
    startedBy: "A client approving copy, or uploading footage (for the Reel cover).",
    handsTo: ["packaging"],
  },
  packaging: {
    name: "Paul", role: "Packaging agent", color: "#B9C2CE",
    short: "Final check that every piece is complete before it's scheduled.",
    does: "Checks every part is present for the piece's format, stamps the VA notes and queues it. Alerts you if anything is missing. Analysis-only clients never reach Paul, by design.",
    startedBy: "A piece reaching Ready for VA.",
    handsTo: [],
  },
  blog: {
    name: "Bea", role: "Blog agent", color: "#D9B38C",
    short: "Proposes and writes SEO blog posts for clients with a blog.",
    does: "On her own schedule, proposes blog topics, writes the full 600 to 800 word post once a topic is approved, and publishes it when the client approves the post.",
    startedBy: "Each blog client's blog schedule.",
    handsTo: [],
  },
};

// Pipeline layout for the handoff map: columns left to right.
export const MAP_COLUMNS = [
  ["bootstrap"],
  ["brand_voice", "research"],
  ["content_strategy"],
  ["script"],
  ["video", "image_concept"],
  ["packaging"],
];

// Every handoff the system can make. `gate` is the client's step in between.
export const MAP_EDGES = [
  { from: "bootstrap", to: "brand_voice" },
  { from: "bootstrap", to: "research" },
  { from: "research", to: "content_strategy", gate: "approves idea" },
  { from: "content_strategy", to: "script", gate: "picks hook" },
  { from: "script", to: "video", gate: "uploads footage" },
  { from: "script", to: "image_concept", gate: "approves copy" },
  { from: "video", to: "image_concept" },
  { from: "image_concept", to: "packaging" },
  { from: "video", to: "packaging" },
];
