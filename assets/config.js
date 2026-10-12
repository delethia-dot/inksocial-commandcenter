// Agent Command Center configuration.
//
// Safe to publish: the Supabase publishable key only allows what row-level
// security allows, and the run log is readable by admin logins only.

export const SUPABASE_URL = "https://oxgmypmwkjrkkbwduldb.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_GKkZkXTSJUfAaKM9_UdMlw_dizTrD9g";

// The InkSocial agents service on Railway (demo runs and "Ask the agents").
export const AGENTS_API = "https://inksocialagents.up.railway.app";

// Display names and one-line roles. Rename agents here; the key on the left
// must stay as is (it is what the agents write to the log).
export const AGENTS = {
  bootstrap:        { name: "Bootstrap",        role: "Sets up a new client: voice, first research, welcome" },
  brand_voice:      { name: "Brand Voice",      role: "Studies the client's posts and writes their voice profile" },
  research:         { name: "Research",         role: "Scrapes competitors, finds outliers, writes analysis and ideas" },
  content_strategy: { name: "Content Strategy", role: "Turns an approved idea into 3 hooks and a concept" },
  script:           { name: "Script",           role: "Writes the script, captions and hashtags" },
  video:            { name: "Video",            role: "Cuts footage, adds b-roll and assembles the video" },
  image_concept:    { name: "Image Concept",    role: "Makes covers, carousels, statics, Stories" },
  packaging:        { name: "Packaging",        role: "Final quality check before the VA schedules it" },
  blog:             { name: "Blog",             role: "Writes SEO blog posts on its own schedule" },
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
  { from: "image_concept", to: "packaging", gate: "not connected" },
];
