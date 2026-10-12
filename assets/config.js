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
// `instructions` mirrors each agent's prompt or checklist in inksocial-agents
// (client details shown as [placeholders]); update it when an agent's prompt changes.
export const AGENTS = {
  bootstrap: {
    name: "Clyde", role: "Client Setup agent", color: "#8FB8DE",
    short: "Sets up each new client once: voice, first research, welcome email.",
    does: "Runs once when a client is launched from onboarding. Has Brandy build the brand voice, marks the client ready, starts their first research with Richard, and sends the welcome email.",
    startedBy: "Launching a client from the portal's onboarding flow.",
    handsTo: ["brand_voice", "research"],
    instructions: "Clyde follows a fixed checklist rather than a prompt:\n1. Have Brandy build the brand voice. If that fails, raise an alert and keep going.\n2. Mark the brand voice ready (only when Brandy succeeded).\n3. Start the client's first research run with Richard.\n4. Send the welcome email.",
  },
  brand_voice: {
    name: "Brandy", role: "Brand Voice agent", color: "#E3A6C6",
    short: "Defines how each client sounds, so every caption and script matches.",
    does: "Studies the client's recent Instagram captions (or their saved settings when there are none) and writes their brand voice profile. Connor and Sierra write in that voice.",
    startedBy: "Client setup, and each client's brand voice schedule.",
    handsTo: [],
    instructions: "You are a brand voice analyst for [client name], a [business type] brand. Analyze these Instagram captions. Identify vocabulary, tone, teaching style, how captions open, hashtag usage, sentence structure, recurring phrases, and how the brand connects with its audience. Return a structured brand voice profile.\n\nReturn a JSON brand voice profile with: tone, vocabulary, hooks, caption style, sentence structure, recurring phrases, hashtag strategy, audience connection, teaching style, and a 2 to 3 sentence summary.\n\n(With no Instagram handle, Brandy builds the same profile from the client's business type, audience, location, tone, pillars and audience notes.)",
  },
  research: {
    name: "Richard", role: "Research agent", color: "#E8C267",
    short: "Finds what's outperforming in each client's niche and turns it into ideas.",
    does: "Scrapes competitor Instagram posts, scores each against that account's average to find outliers, pulls trending YouTube videos, and has Claude write the Key Patterns analysis and the week's content ideas. Flags bad data instead of hiding it.",
    startedBy: "Each client's research schedule (weekly or every few weeks, on the day and time set for them), or Run research on this dashboard.",
    handsTo: ["content_strategy"],
    instructions: "You are a content research analyst for [client name], a [business type] brand targeting [audience] in [location]. Their content pillars are: [pillars]. Analyze the top-performing posts in their niche (by outlier scoring) and trending videos, then propose specific, actionable content ideas they can produce. Generate content ideas that are timely and seasonally appropriate for right now. Focus on what is relevant this week and the upcoming 2 to 4 weeks.\n\nReturn two sections:\nANALYSIS: under 'Key Patterns Driving Performance Right Now', 3 to 6 bullets on the themes resonating now, the winning formats, and the hooks that are working, drawn from the data.\nIDEAS: exactly [N] ideas split across the client's content mix, each with Category, Title, Format (Reel, Static Image, Carousel, Story or Infographic), Hook, and Why it will perform.",
  },
  content_strategy: {
    name: "Connor", role: "Content Strategy agent", color: "#9FD3A8",
    short: "Turns an approved idea into three hooks and a concept.",
    does: "Writes three hook options and a concept for an approved idea, in the client's brand voice, and sends them for the client to pick.",
    startedBy: "A client approving an idea, or submitting their own.",
    handsTo: ["script"],
    instructions: "You are a content strategist for [client name], a [business type] brand targeting [audience] in [location]. Their brand voice is: [brand voice profile]. [Client writing guidelines.]\n\nThis content piece is a [format]. Hooks must be tailored to that format: a Reel hook is spoken in the first 3 seconds on camera, a Carousel hook is a swipe-stopping first slide, a Static Image or Story hook is a single on-image line, and an Infographic hook is a titled promise of the data. Each hook must grab attention immediately and sound natural in this brand's voice. Write three hook options and one concept tailored to the format.",
  },
  script: {
    name: "Sierra", role: "Script agent", color: "#C3A6F0",
    short: "Writes the script, captions and hashtags for the chosen hook.",
    does: "Writes the full Reel script, three caption options and hashtags (or the copy for carousels, statics, Stories and infographics) and sends it for approval. Stops here for clients with video off.",
    startedBy: "A client picking a hook.",
    handsTo: ["video", "image_concept"],
    instructions: "You are a content writer for [client name], a [business type] brand targeting [audience]. Their brand voice is: [brand voice profile]. [Client writing guidelines.] All hashtags must be current.\n\nReel: write a complete script using the selected hook as the exact first line, conversational and educational, with three to four teaching points and a clear call to action, plus three captions (short, medium, storytelling) and 20 to 25 hashtags.\nCarousel: 5 to 8 slides, each a 3 to 8 word headline and one supporting sentence; the last slide is the call to action. The hook becomes the cover slide automatically.\nStatic Image, Story and Infographic: captions and hashtags, plus the tips list for infographics.",
  },
  video: {
    name: "Victor", role: "Video agent", color: "#F29E7C",
    short: "Cuts the client's footage, adds b-roll and assembles the video.",
    does: "Plans b-roll moments with Claude, generates b-roll, and assembles the finished video. Clients with video off never reach Victor.",
    startedBy: "A client uploading footage for an approved Reel script.",
    handsTo: ["image_concept", "packaging"],
    instructions: "You are a professional video director for [client name], a [business type] brand, building a shot list of supplementary b-roll clips that fill gaps the client did not film, never duplicates of their own footage. [Safety rules.]\n\nReturn NONE unless there is a clear gap between what the script describes and what the client could have reasonably filmed. Follow the client's representation and image style guidelines exactly. For each clip give Subject, Action, Environment, Camera, Lighting, Style, and a one-line Prompt that reads like a director's instruction. Every person depicted must be fully and professionally dressed.",
  },
  image_concept: {
    name: "Imani", role: "Image Concept agent", color: "#7FD1CF",
    short: "Makes the visuals: covers, carousel slides, statics, Stories.",
    does: "Generates the cover for a Reel, or the finished images for carousels, statics, Stories and infographics, and tells the client their piece is ready.",
    startedBy: "A client approving copy, or uploading footage (for the Reel cover).",
    handsTo: ["packaging"],
    instructions: "Imani typesets every word on carousels, statics, Stories, infographics and branded Reel thumbnails herself, in the client's brand kit, using the approved copy exactly as written.\n\nFor backgrounds she uses the client's own photos first. With no photos, and only when AI backgrounds are allowed, she asks Claude:\n\nYou are a visual creative director for [client name], a [business type] brand. You must follow these client guidelines exactly: [image and representation guidelines]. This is a background photo only. It must contain no text, letters, numbers, logos, signage or captions. Keep the lower third calm, because a headline will be set over it.\n\nOtherwise she uses the brand colors.",
  },
  packaging: {
    name: "Paul", role: "Packaging agent", color: "#B9C2CE",
    short: "Final check that every piece is complete before it's scheduled.",
    does: "Checks every part is present for the piece's format, stamps the VA notes and queues it. Alerts you if anything is missing. Analysis-only clients never reach Paul, by design.",
    startedBy: "A piece reaching Ready for VA.",
    handsTo: [],
    instructions: "Paul follows a fixed checklist rather than a prompt:\n1. Skip any piece already finalized.\n2. Check every part the format needs is present (for a Reel: finished video, cover, captions, hashtags; for a Carousel: every slide image, captions, hashtags).\n3. Complete: stamp the VA notes 'Finalized by Packaging Agent' and add it to the content queue.\n4. Incomplete: raise an alert naming exactly what is missing.",
  },
  blog: {
    name: "Bea", role: "Blog agent", color: "#D9B38C",
    short: "Proposes and writes SEO blog posts for clients with a blog.",
    does: "On her own schedule, proposes blog topics, writes the full 600 to 800 word post once a topic is approved, and publishes it when the client approves the post.",
    startedBy: "Each blog client's blog schedule.",
    handsTo: [],
    instructions: "You are a blog content strategist for [client name], a [business type] brand targeting [audience] in [location]. Content tone: [tone].\n\nGenerate topics that are timely and relevant to this time period. Propose 4 distinct blog post topic ideas optimized for traditional SEO, GEO (Generative Engine Optimization) and AEO (Answer Engine Optimization). Relevant keywords: [keywords]. Off-limits topics: [off-limits topics]. Once a topic is approved, Bea writes the full 600 to 800 word post.",
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
