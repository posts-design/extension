"use strict";

// The posts.design picks (owner, 2026-11-14): every post chosen on /curate for socials or the email,
// from any of the site's feeds, newest 50 first by when they were picked, in the public feed's format.
// A choice shows within minutes; the page reads it at most once an hour.
const FEED_URL = "https://posts.design/feed/new-tab.xml";
// The Explorations wall, independent designers' posts newest first, for Settings' Explorations switch
// (owner, 2026-11-14), read and kept the same way.
const EXPLORATIONS_URL = "https://posts.design/feed/explorations.xml";
// The newest posts on posts.design (the Recent wall's public feed), the last top-up when the picks and
// the recent Explorations come to fewer than six.
const LATEST_URL = "https://posts.design/feed.xml";
const SITE_HOST = "posts.design";
const SITE_URL = "https://posts.design/";
const CAMPAIGN = { utm_source: "chrome-extension", utm_medium: "referral" };
const MCP_URL = "https://posts.design/mcp"; // the MCP server's address, and the page on how to connect it
const ABOUT_URL = "https://posts.design/about";
// The site menu's Socials row (src/lib/social-profiles.ts, site-menu-content.tsx), glyphs copied from public/brand/social.
const SOCIALS = [
  { key: "x", name: "X", url: "https://x.com/postsdsgn" },
  { key: "linkedin", name: "LinkedIn", url: "https://www.linkedin.com/company/postsdesign" },
  { key: "threads", name: "Threads", url: "https://www.threads.com/@psts.dsgn" },
];
const COPIED_MS = 1600;
const FEED_KEY = "posts-design-newtab:feed:v2";
const SEEN_KEY = "posts-design-newtab:seen:v1"; // { post, newest }: the post last on screen, the newest post then
const WEEK_KEY = "posts-design-newtab:week:v1"; // true when Settings' This week's picks is on
const EXPLORATIONS_KEY = "posts-design-newtab:explorations:v1"; // true when Settings' Explorations is on
const FEEDS = {
  picks: { url: FEED_URL, key: FEED_KEY },
  explorations: { url: EXPLORATIONS_URL, key: "posts-design-newtab:feed:explorations:v1" },
  latest: { url: LATEST_URL, key: "posts-design-newtab:feed:latest:v1" },
};
const MIN_POSTS = 6;
const REFRESH_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const ATOM_NS = "http://www.w3.org/2005/Atom";
const MEDIA_NS = "http://search.yahoo.com/mrss/";
const POSTS_NS = "https://posts.design/ns/feed";
const CATEGORY_SCHEME = "https://posts.design/categories", SUBJECT_SCHEME = "https://posts.design/subjects";
const SAMPLE_WIDTH = 16; // the ambient light takes colour fields, not detail
const SAMPLE_EVERY_MS = 2600; // a playing video's next colour, crossfaded over the CSS transition
const LEAVE_MS = 800; // the post before softens out under the new one and its light hands over (.post.leaving)
// The room takes a new post's colour quickly and a video's slowly. Opening a tab it comes up slower than
// the post's 640ms unveil (owner, 2026-11-12), so the post arrives first and then lights the room.
const ROOM_OPEN_MS = 1200, ROOM_FIRST_MS = 800, ROOM_DRIFT_MS = 2400;
const stillMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const app = document.getElementById("app");
let current = null; // { posts, index, stop } for the post on screen
let shell = null; // the top bar, progress marker and arrows, built once and updated in place
let feedEntries = null, feedSource = null; // the feed the posts on screen came from, so Settings can pick from it again

const storage = {
  read(key) { try { return JSON.parse(localStorage.getItem(key) ?? "null"); } catch { return null; } },
  write(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Only costs the cache. */ } },
};

/** An https URL, or null. */
function httpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url : null;
  } catch { return null; }
}

/** An https URL on posts.design, or null: posts, pictures, videos and avatars load only from there. */
function siteUrl(value) {
  const url = httpsUrl(value);
  return url?.hostname === SITE_HOST ? url.href : null;
}

function withCampaign(href) {
  const url = new URL(href);
  for (const [key, value] of Object.entries(CAMPAIGN)) url.searchParams.set(key, value);
  return url.href;
}

function size(node) {
  const width = Number(node?.getAttribute("width")), height = Number(node?.getAttribute("height"));
  return width > 0 && height > 0 ? { width, height } : null;
}

/** An entry's category labels in one scheme: its categories or its subjects, as its page lists them. */
function labels(entry, scheme) {
  return [...entry.getElementsByTagNameNS(ATOM_NS, "category")]
    .filter((node) => node.getAttribute("scheme") === scheme)
    .map((node) => (node.getAttribute("label") || node.getAttribute("term") || "").trim()).filter(Boolean);
}

/** Feed entries newest first, with only what a tab shows. */
function parseFeed(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("Unreadable feed");
  return [...doc.getElementsByTagNameNS(ATOM_NS, "entry")].flatMap((entry) => {
    const first = (ns, tag) => entry.getElementsByTagNameNS(ns, tag)[0];
    const text = (ns, tag) => first(ns, tag)?.textContent?.trim() ?? "";
    const link = (rel) => [...entry.getElementsByTagNameNS(ATOM_NS, "link")]
      .find((node) => (node.getAttribute("rel") ?? "alternate") === rel)?.getAttribute("href") ?? "";
    const thumbnail = first(MEDIA_NS, "thumbnail");
    const content = first(MEDIA_NS, "content");
    const account = first(POSTS_NS, "source");
    const brand = first(POSTS_NS, "brand"), brandAvatar = siteUrl(brand?.getAttribute("avatar") ?? "");
    const post = siteUrl(link("alternate"));
    const image = siteUrl(thumbnail?.getAttribute("url") ?? "");
    const published = Date.parse(text(ATOM_NS, "published"));
    if (!post || !image || Number.isNaN(published)) return [];
    // A carousel's slides (2 or more), as the wall's carousel shows them: the first is its still and shape.
    const slides = [...entry.getElementsByTagNameNS(POSTS_NS, "slide")].flatMap((node) => {
      const src = siteUrl(node.getAttribute("url") ?? ""), dims = size(node);
      return src && dims ? [{ src, ...dims }] : [];
    });
    const carousel = slides.length >= 2 ? slides : null;
    const video = !carousel && content?.getAttribute("type")?.startsWith("video/") ? siteUrl(content.getAttribute("url") ?? "") : null;
    const postedAt = Date.parse(text(POSTS_NS, "postedAt"));
    return [{
      post, image: carousel?.[0].src ?? image, published, slides: carousel,
      postedAt: Number.isNaN(postedAt) ? published : postedAt,
      size: (carousel && { width: carousel[0].width, height: carousel[0].height }) || (video && size(content)) || size(thumbnail),
      video,
      source: httpsUrl(link("via"))?.href ?? null,
      title: text(POSTS_NS, "title") || text(ATOM_NS, "title"),
      handle: account?.getAttribute("handle") ?? "",
      byBrand: account?.getAttribute("kind") === "brand",
      avatar: siteUrl(account?.getAttribute("avatar") ?? ""),
      // The brand's page on posts.design, for a brand's own account whose page exists.
      page: siteUrl(account?.getAttribute("page") ?? ""),
      // A person posting for a brand: credited to the brand first, as on the site's wall (owner, 2026-11-13).
      brand: brandAvatar ? { name: brand.getAttribute("name") ?? "", avatar: brandAvatar, page: siteUrl(brand.getAttribute("page") ?? "") } : null,
      alt: text(ATOM_NS, "summary"),
      categories: labels(entry, CATEGORY_SCHEME),
      subjects: labels(entry, SUBJECT_SCHEME),
    }];
  }).sort((a, b) => b.published - a.published);
}

/**
 * When the post went out, as the wall's date chip says it (local-date-time.tsx compactRelativeDateLabel):
 * Today, Yesterday, then 3d, 2w, 4m or 1y ago, counted in calendar days (UTC).
 */
function dayLabel(time) {
  const days = Math.max(0, Math.floor(Date.now() / DAY_MS) - Math.floor(time / DAY_MS));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}m ago`;
  return `${Math.floor(days / 365)}y ago`;
}

/** Which feed the tab shows: the picks, or the Explorations with Settings' Explorations on. */
function feedMode() {
  return storage.read(EXPLORATIONS_KEY) === true ? "explorations" : "picks";
}

/** The picks from the last 24 hours, or from the last 7 days with Settings' This week's picks on (owner, 2026-11-14). */
function picked(entries) {
  const now = Date.now(), span = storage.read(WEEK_KEY) === true ? 7 * DAY_MS : DAY_MS;
  return entries.filter((entry) => now - entry.published < span);
}

/**
 * The posts a tab turns through, never fewer than six (owner, 2026-11-14). The picks: those picked()
 * finds, topped up when there are fewer than six with the Explorations of the last 2 days, then the
 * newest posts on posts.design, then older picks, each post once and in that order. Explorations: the
 * last 2 days', and never fewer than the 6 newest.
 */
function featured(entries, source) {
  const now = Date.now(), recently = (entry) => now - entry.published < 2 * DAY_MS;
  if (source === "explorations") return entries.slice(0, Math.max(entries.filter(recently).length, MIN_POSTS));
  const recent = picked(entries);
  if (recent.length >= MIN_POSTS) return recent;
  const explorations = (keptFeed("explorations")?.entries ?? []).filter(recently);
  const latest = keptFeed("latest")?.entries ?? [];
  const shown = new Set();
  return [...recent, ...explorations, ...latest, ...entries].filter((entry) => !shown.has(entry.post) && shown.add(entry.post)).slice(0, MIN_POSTS);
}

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function svg(tag, attributes, children = []) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  node.append(...children);
  return node;
}

/** The site's line icons: stroked in the text colour, with round ends and corners. */
const STROKED = { fill: "none", stroke: "currentColor", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" };

/** The site's carousel arrow chevron (src/components/media-carousel.tsx). */
function chevron() {
  return svg("svg", { ...STROKED, width: "20", height: "20", viewBox: "0 0 20 20", "stroke-width": "1.8" }, [svg("path", { d: "m7.5 5 5 5-5 5" })]);
}

/** The site's settings gear (src/components/icons/ui-icons.tsx SettingsIcon). */
function gear() {
  return svg("svg", { ...STROKED, width: "16", height: "16", viewBox: "0 0 24 24", "stroke-width": "1.8" }, [
    svg("path", { d: "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" }),
    svg("circle", { cx: "12", cy: "12", r: "3" }),
  ]);
}


/** The site's copy icon (src/components/icons/ui-icons.tsx CopyIcon). */
function copyIcon() {
  return svg("svg", { ...STROKED, width: "16", height: "16", viewBox: "0 0 24 24", "stroke-width": "1.8" }, [
    svg("rect", { x: "9", y: "9", width: "11", height: "11", rx: "2" }),
    svg("path", { d: "M5 15V5a2 2 0 0 1 2-2h10" }),
  ]);
}

/** The site menu's theme icons (src/components/theme-choice.tsx ThemeChoiceIcon). */
function themeIcon(value) {
  const shapes = {
    system: [svg("rect", { x: "3", y: "4", width: "18", height: "14", rx: "2" }), svg("path", { d: "M8 22h8M12 18v4" })],
    light: [svg("circle", { cx: "12", cy: "12", r: "4" }), svg("path", { d: "M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41" })],
    dark: [svg("path", { d: "M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z" })],
  };
  return svg("svg", { ...STROKED, width: "18", height: "18", viewBox: "0 0 24 24", "stroke-width": "1.8" }, shapes[value]);
}

/**
 * A short prompt for the post on screen, to paste above the reader's own brief: which post, and how to
 * open it with the posts.design MCP server (get_reference takes the slug at the end of its page's
 * address) for the rest, connecting it if it isn't, with the page's Markdown until then. Its
 * categories and subjects come from the feed (owner, 2026-11-12); a feed kept from before they were
 * added has none, and the agent then reads them there too.
 */
function agentPrompt(post) {
  const slug = new URL(post.post).pathname.split("/").filter(Boolean).pop() ?? "";
  const open = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? `call get_reference with id "${slug}"` : "search for it by its title";
  return [
    `Reference from posts.design: "${post.title}"${post.handle ? ` by @${post.handle}` : ""}.`,
    `Page: ${post.post}`,
    ...(post.source ? [`Original: ${post.source}`] : []),
    ...(post.categories?.length ? [`Categories: ${post.categories.join(", ")}`] : []),
    ...(post.subjects?.length ? [`Subjects: ${post.subjects.join(", ")}`] : []),
    "",
    `Open it with the posts.design MCP server: ${open} for ${post.categories?.length || post.subjects?.length ? "its dates, media and full details" : "its categories, subjects, dates and media"}. If it isn't connected, connect it from ${MCP_URL} and ask me to sign in (the account is free). Until then, read ${post.post}.md, which lists the same.`,
  ].join("\n");
}

/** Copies the prompt for the post on screen; the button says how it went, then reads Copy for agent again. */
async function copyForAgent(button) {
  if (!current) return;
  let copied = true;
  try { await navigator.clipboard.writeText(agentPrompt(current.posts[current.index])); } catch { copied = false; }
  clearTimeout(button.reset);
  button.dataset.state = copied ? "copied" : "failed";
  button.reset = setTimeout(() => { delete button.dataset.state; }, COPIED_MS);
}

function renderEmpty() {
  app.querySelectorAll(".post.leaving").forEach(retire);
  room.clear();
  current?.stop();
  current = null;
  shell = null;
  app.replaceChildren(el("a", { className: "wordmark", href: withCampaign(SITE_URL), textContent: "posts.design" }));
}

function pixels(post, media) {
  // A video kept on its still never loads its metadata, so its still gives the size.
  const still = media?.still;
  return post.size ?? {
    width: media?.naturalWidth || media?.videoWidth || still?.naturalWidth || 0,
    height: media?.naturalHeight || media?.videoHeight || still?.naturalHeight || 0,
  };
}

/**
 * Every post takes about the same share of the room, whatever its shape (owner, 2026-11-14: the middle
 * between a large image filling the window and an HD video small on a Retina display), so a wide post
 * and a square one weigh alike and only the tallest reach the room's height. A post may grow to one and
 * a half times its own pixels at this screen's density: a 1280-pixel video reaches 960 points on a
 * Retina display, and nothing goes softer than that.
 */
const POST_SHARE = 0.4, PAST_PIXELS = 1.5;
function fit() {
  const figure = app.querySelector(".post:not(.leaving)");
  if (!figure || !current) return;
  const { width, height } = pixels(current.posts[current.index], figure.querySelector(".picture"));
  if (!width || !height) return;
  // Read before anything is written, so the page lays out once.
  const style = getComputedStyle(app), across = app.clientWidth;
  const roomWidth = across - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const roomHeight = window.innerHeight - parseFloat(style.getPropertyValue("--chrome"));
  const ratio = width / height;
  const shown = Math.max(0, Math.floor(Math.min(
    roomWidth, roomHeight * ratio,
    Math.sqrt(roomWidth * roomHeight * POST_SHARE * ratio),
    width / (window.devicePixelRatio || 1) * PAST_PIXELS,
  )));
  figure.style.width = `${shown}px`;
  current.light.fit(shown, shown * height / width);
  // The side arrows' targets stop at the picture's edge, so clicking the picture always opens it.
  app.style.setProperty("--gutter", `${Math.floor((across - shown) / 2)}px`);
}

/** Copies a canvas into another, at the source's size, through `filter` if one is given. */
function copyInto(target, source, filter = "none") {
  target.width = source.width;
  target.height = source.height;
  const context = target.getContext("2d");
  context.filter = filter;
  context.drawImage(source, 0, 0);
}

/**
 * Paints a layer of light: `source` drawn at `rect` (CSS px; the whole box unless given) in a box of
 * `width` by `height` CSS px, through `filter`, into `target` at a quarter of that size, which CSS
 * stretches back over the box. The blur is drawn here, once each time the colour changes: as a CSS
 * filter the browser would draw it again on every frame the light fades or a video plays, a laptop's
 * battery spent on a glow that hasn't changed. Blurred this far, the quarter size shows no difference.
 */
const LIGHT_SCALE = 4;
const blur = (px) => `blur(${px / LIGHT_SCALE}px)`;
function paint(target, source, width, height, filter, rect = [0, 0, width, height]) {
  target.width = Math.max(1, Math.round(width / LIGHT_SCALE));
  target.height = Math.max(1, Math.round(height / LIGHT_SCALE));
  const context = target.getContext("2d");
  context.filter = filter;
  context.drawImage(source, ...rect.map((value) => value / LIGHT_SCALE));
}

/** The sample's average colour, by halving it down to one pixel: the browser averages, nothing reads it. */
function average(source) {
  let canvas = source;
  while (canvas.width > 1 || canvas.height > 1) {
    const half = el("canvas", { width: Math.max(1, Math.ceil(canvas.width / 2)), height: Math.max(1, Math.ceil(canvas.height / 2)) });
    half.getContext("2d").drawImage(canvas, 0, 0, half.width, half.height);
    canvas = half;
  }
  return canvas;
}

/**
 * Only what is brighter than the sample's own average: max(0, p - avg), drawn as p - min(p, avg) with
 * canvas blending, so nothing reads the pixels. A light card gives almost nothing; a bright window or
 * a coloured shape in a dark post gives light where it sits.
 */
function peaks(source, mean) {
  const low = el("canvas", { width: source.width, height: source.height });
  const lowContext = low.getContext("2d");
  lowContext.drawImage(source, 0, 0);
  lowContext.globalCompositeOperation = "darken";
  lowContext.drawImage(mean, 0, 0, source.width, source.height);
  const out = el("canvas", { width: source.width, height: source.height });
  const context = out.getContext("2d");
  context.drawImage(source, 0, 0);
  context.globalCompositeOperation = "difference";
  context.drawImage(low, 0, 0);
  return out;
}

/**
 * The room (owner, 2026-11-12): the post on screen lights the page. In light mode a wash of its colour
 * fields, blurred far and uneven like real light, over a flat tone of its average colour of which only
 * the hue reaches the page, which stays as light as ever. In dark mode (owner, 2026-11-13) only its
 * peaks: barely there, a little brighter where the post itself is, and the rest of the page stays black.
 * Two of each layer crossfade, so it hands over from post to post and drifts with a playing video. It
 * stays across posts; only its colour moves. newtab.css shows the layers of the current theme.
 */
const room = (() => {
  const pair = (className) => [el("canvas", { className, ariaHidden: "true" }), el("canvas", { className, ariaHidden: "true" })];
  const tone = pair("tone"), wash = pair("wash"), peak = pair("peak"), layers = [...tone, ...wash, ...peak];
  // On the page itself, before #app, so the tone blends with the page's own background. In place, unlit,
  // from the start: layers added and lit in one go would skip their fade and appear at once.
  document.body.prepend(...layers);
  let lit = 0, colours = null, bright = null;
  // The wash and peaks cover 120% of the window (newtab.css), so their blurred edges fall outside it.
  const paintLit = () => {
    const width = innerWidth * 1.2, height = innerHeight * 1.2;
    paint(wash[lit], colours, width, height, `${blur(140)} saturate(1.4)`);
    paint(peak[lit], bright, width, height, `url(#cap) ${blur(120)} saturate(1.5)`);
  };
  return {
    show(sample, ms) {
      const mean = average(sample);
      // Kept for a resize: the halo draws its next sample over this one.
      colours = el("canvas");
      copyInto(colours, sample);
      bright = peaks(sample, mean);
      const before = lit;
      lit = 1 - lit;
      copyInto(tone[lit], mean, "saturate(0.9)");
      paintLit();
      for (const layer of layers) layer.style.transitionDuration = `${ms}ms`;
      for (const both of [tone, wash, peak]) { both[lit].classList.add("lit"); both[before].classList.remove("lit"); }
    },
    /** Paints the light again for the window's new size. */
    resize() { if (colours) paintLit(); },
    clear() { for (const layer of layers) layer.classList.remove("lit"); },
  };
})();

/**
 * Ambient light: two tiny samples of the post's colour fields, painted blurred around the picture.
 * Each new sample lights the other layer, which crossfades in, so a video's glow changes slowly. A
 * layer holds a light and a dark painting (the dark one capped, #cap in newtab.html), and newtab.css
 * shows the theme's. `sampled` hears of each sample, and whether it was the post's first.
 */
const HALO_MARGIN = 200; // .halo's margin in newtab.css, which holds the whole blur
function halo(sampled) {
  const layer = () => ({ sample: el("canvas"), day: el("canvas", { className: "day" }), night: el("canvas", { className: "night" }) });
  const layers = [layer(), layer()];
  const node = el("span", { className: "halo", ariaHidden: "true" }, layers.flatMap(({ day, night }) => [day, night]));
  let lit = 0, size = null, first = true;
  const paintLayer = ({ sample, day, night }) => {
    if (!size || !sample.width) return;
    const [width, height] = size, box = [width + 2 * HALO_MARGIN, height + 2 * HALO_MARGIN];
    const rect = [HALO_MARGIN, HALO_MARGIN, width, height];
    paint(day, sample, ...box, `${blur(64)} saturate(1.2)`, rect);
    paint(night, sample, ...box, `url(#cap) ${blur(64)} saturate(1.2)`, rect);
  };
  return {
    node,
    sample(source) {
      const width = source.naturalWidth || source.videoWidth, height = source.naturalHeight || source.videoHeight;
      if (!width || !height) return;
      // The first light comes up with the post (quicker after a step, newtab.css); later ones drift slowly.
      if (!first) node.classList.add("warm");
      const before = layers[lit];
      lit = 1 - lit;
      const next = layers[lit];
      next.sample.width = SAMPLE_WIDTH;
      next.sample.height = Math.max(1, Math.round(SAMPLE_WIDTH * height / width));
      next.sample.getContext("2d").drawImage(source, 0, 0, next.sample.width, next.sample.height);
      paintLayer(next);
      for (const canvas of [next.day, next.night]) canvas.classList.add("lit");
      for (const canvas of [before.day, before.night]) canvas.classList.remove("lit");
      sampled(next.sample, first);
      first = false;
    },
    /** The picture's size on the page in CSS px, from fit(): the light paints around it. */
    fit(width, height) {
      if (size?.[0] === width && size[1] === height) return;
      size = [width, height];
      layers.forEach(paintLayer);
    },
  };
}

/**
 * The picture, or the post's video playing muted on a loop. `loaded` runs when there is a frame to show
 * (for a video, on its still and again on its first frame), `failed` when it can't load (a post
 * withdrawn since the feed was kept); `stop` ends its glow sampling and its download. Offline, a video
 * post stays on its still: the browser keeps the stills of the posts shown and loaded ahead (a year,
 * immutable), so the last few posts open without a connection and no storage of our own grows. A video
 * post is dropped only when neither its still nor its video loads. No controls sit on it (owner,
 * 2026-11-13): the whole post opens its page, where the site's player is.
 */
function media(post, light, loaded, failed) {
  if (post.slides) return slideshow(post, light, loaded, failed);
  const label = post.alt || post.title;
  if (!post.video) {
    const picture = el("img", { className: "picture", alt: label, decoding: "async" });
    picture.onload = () => { fit(); light.sample(picture); loaded(); };
    picture.onerror = failed;
    picture.src = post.image;
    return { node: picture, stop() {} };
  }
  // Under reduced motion, or with Data Saver on, it shows its still and never plays, so it downloads
  // nothing more; its page on posts.design plays it.
  const still = stillMotion || Boolean(navigator.connection?.saveData);
  const video = el("video", { className: "picture", poster: post.image, muted: true, loop: true, playsInline: true, preload: still ? "none" : "auto", ariaLabel: label });
  video.autoplay = !still;
  const poster = new Image();
  video.still = poster;
  poster.onload = () => { fit(); if (!video.videoWidth) light.sample(poster); loaded(); };
  poster.src = post.image;
  video.addEventListener("loadedmetadata", fit);
  video.addEventListener("loadeddata", () => { light.sample(video); loaded(); }, { once: true });
  // A still video never loads, so its still alone decides.
  let broken = 0;
  const broke = () => { if (++broken === (still ? 1 : 2)) failed(); };
  poster.onerror = broke;
  video.addEventListener("error", () => { clearInterval(timer); broke(); });
  video.src = post.video;
  const timer = still ? 0 : setInterval(() => { if (!video.paused) light.sample(video); }, SAMPLE_EVERY_MS);
  return { node: video, stop() { clearInterval(timer); video.removeAttribute("src"); video.load(); } };
}

/**
 * A carousel post's slides, as the site's wall carousel (post-asset-carousel.tsx, owner 2026-11-14):
 * the first slide sets the frame's shape, and a slide far from it (over 1.5x) shows whole rather than
 * cropped to a sliver. Over the picture, the wall's arrows (Previous only past the first slide; hovering
 * one hides the other) and its progress marker bottom right. It loops, the incoming slide settles in
 * the direction of travel, and it turns by itself every 8 seconds until someone moves it, never while
 * the pointer or focus is on the post, the tab is hidden, or motion is reduced. Each slide lights the
 * room as it comes. A two-finger swipe over the post moves through the slides first (`move`).
 */
const SLIDE_EVERY_MS = 8000, SLIDE_GAP = 8;
function slideshow(post, light, loaded, failed) {
  const slides = post.slides, total = slides.length, aspect = slides[0].width / slides[0].height;
  const label = post.alt || post.title;
  const images = slides.map((slide, i) => {
    const own = slide.width / slide.height, whole = Math.max(own / aspect, aspect / own) > 1.5;
    return el("img", { className: `slide-image${whole ? " whole" : ""}`, alt: i ? "" : label, decoding: "async", loading: i < 2 ? "eager" : "lazy", src: slide.src });
  });
  const frames = images.map((image) => el("span", { className: "slide" }, [image]));
  const track = el("span", { className: "slide-track" }, frames);
  const node = el("span", { className: "picture slides" }, [track]);
  node.style.aspectRatio = `${slides[0].width} / ${slides[0].height}`;
  images[0].onload = () => { fit(); light.sample(images[0]); loaded(); };
  images[0].onerror = failed;

  const arrow = (direction, text) => el("button", { type: "button", className: `slide-arrow ${direction}`, ariaLabel: text }, [chevron()]);
  const prev = arrow("prev", "Previous image"), next = arrow("next", "Next image"), marker = slideMarker(total);
  const controls = el("div", { className: "slide-controls" }, [prev, next, marker.node]);
  let index = 0, moved = false;

  function go(to, direction, lights = true) {
    const wrap = (to + total) % total !== to;
    index = (to + total) % total;
    // A wrap jumps straight to the far slide, which then settles in as any other does.
    track.classList.toggle("jump", wrap);
    track.style.transform = `translateX(calc(${-index} * (100% + ${SLIDE_GAP}px)))`;
    node.dataset.direction = direction;
    frames.forEach((frame, i) => frame.classList.toggle("current", i === index));
    // Restart the settle on the new slide.
    const image = images[index];
    image.style.animation = "none";
    void image.offsetWidth;
    image.style.animation = "";
    if (!lights) { /* The first slide lights the room as the post opens (its onload). */ }
    else if (image.complete && image.naturalWidth) light.sample(image); else image.addEventListener("load", () => { if (images[index] === image) light.sample(image); }, { once: true });
    prev.hidden = index === 0;
    marker.show(index + 1);
  }
  const by = (delta) => { moved = true; go(index + delta, delta > 0 ? "next" : "previous"); };
  prev.onclick = () => by(-1);
  next.onclick = () => by(1);
  for (const button of [prev, next]) {
    // On a focused arrow the arrow keys turn the slides, as on the site, not the posts.
    button.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      event.stopPropagation();
      by(event.key === "ArrowRight" ? 1 : -1);
    });
  }
  go(0, "", false);

  const timer = stillMotion ? 0 : setInterval(() => {
    const figure = node.closest(".post");
    if (moved || document.hidden || !figure || figure.classList.contains("leaving") || figure.matches(":hover, :focus-within")) return;
    go(index + 1, "next");
  }, SLIDE_EVERY_MS);
  return {
    node, controls,
    /** Moves one slide toward `delta` when there is one that way; false at either end, so the post changes. */
    move(delta) {
      if (delta > 0 ? index === total - 1 : index === 0) return false;
      by(delta);
      return true;
    },
    stop() { clearInterval(timer); },
  };
}

/**
 * The site's carousel progress marker as the wall draws it on a picture (media-carousel.tsx
 * CarouselProgress): 6px dots 2px apart and an 18px pill for the current image, all 85% white with a
 * 55% black edge; past seven images seven dots follow the current one, and an end dot shrinks while
 * more lie beyond it.
 */
function slideMarker(total) {
  const visible = Math.min(total, 7), dot = 6, gap = 2, pill = 18, step = dot + gap, expansion = pill - dot;
  const dots = Array.from({ length: visible }, () => el("span", { className: "slide-dot" }, [el("span")]));
  const active = el("span", { className: "slide-dot active" }, [el("span")]);
  const node = el("span", { className: "slide-marker", role: "progressbar", ariaLabel: "Carousel position" },
    [el("span", { className: "slide-dots", ariaHidden: "true" }, [...dots, active])]);
  node.style.width = `${visible * step - gap + expansion}px`;
  return {
    node,
    show(position) {
      const first = Math.min(Math.max(0, position - 1 - Math.floor(visible / 2)), total - visible), slot = position - first;
      dots.forEach((item, offset) => {
        const more = (offset === 0 && first > 0) || (offset === visible - 1 && first + offset < total - 1);
        item.style.transform = `translateX(${offset * step + (offset + 1 > slot ? expansion : 0)}px)`;
        item.style.opacity = offset + 1 === slot ? "0" : "1";
        item.firstChild.style.scale = more ? "0.6" : "1";
      });
      active.style.transform = `translateX(${(slot - 1) * step}px)`;
      Object.assign(node, { ariaValueMin: "1", ariaValueMax: String(total), ariaValueNow: String(position), ariaValueText: `Image ${position} of ${total}` });
    },
  };
}

/**
 * The site's carousel progress marker (src/components/media-carousel.tsx CarouselProgress): a fixed
 * row of dots where the current one is a pill. Smaller and airier than on a picture, since it sits alone
 * on the page, and windowed (owner 2026-11-12): the pill stays at the centre with up to two full dots on
 * each side, and one small dot on a side that has more. The dots slide under the pill as posts change.
 */
function progressMarker() {
  const DOT = 5, GAP = 5, PILL = 15, STEP = DOT + GAP, NEAR = 2, SMALL = 0.6;
  const track = el("span", { className: "marker-track", ariaHidden: "true" });
  const node = el("span", { className: "marker", role: "progressbar", ariaLabel: "Featured posts" }, [track]);
  const slot = () => el("span", { className: "slot" }, [el("span", { className: "dot" })]);
  const pill = slot();
  pill.classList.add("active");
  let slots = [];
  return {
    node,
    show(total, position) {
      if (slots.length !== total) {
        slots = Array.from({ length: total }, slot);
        track.replaceChildren(...slots, pill);
      }
      slots.forEach((item, i) => {
        // Steps from the current post; dots past the small one wait, shrunk to nothing, one step further out.
        const offset = i + 1 - position, away = Math.min(Math.abs(offset), NEAR + 2);
        const x = offset && Math.sign(offset) * (PILL / 2 + GAP + DOT / 2 + (away - 1) * STEP);
        const scale = away <= NEAR ? 1 : away === NEAR + 1 ? SMALL : 0;
        item.style.transform = `translateX(${x}px) scale(${scale})`;
        item.style.opacity = offset && scale ? "1" : "0";
      });
      Object.assign(node, { ariaValueMin: "1", ariaValueMax: String(total), ariaValueNow: String(position), ariaValueText: `Post ${position} of ${total}` });
    },
  };
}

/**
 * Settings (owner, 2026-11-13): the gear opens the site menu's lower rows. About opens posts.design's
 * about page; Explorations (owner, 2026-11-14) shows the Explorations wall's newest instead of the picks,
 * and This week's picks (owner, 2026-11-14) widens the picks to the week's, both at once; the theme
 * row is System, Light or Dark as icons, applied at once and kept in this browser (theme.js); Socials
 * links posts.design's profiles, as the site menu does. The posts.design account settings stay on the
 * site (owner, 2026-11-12).
 */
function settingsPanel() {
  // The site's preference switch (src/components/ui/switch.tsx), its label on the left.
  const week = el("input", { type: "checkbox", role: "switch", className: "switch" });
  week.onchange = () => { storage.write(WEEK_KEY, week.checked); regroup(); refill(); };
  // Explorations swaps the picks for the Explorations wall; the week's picks then don't apply.
  const explorations = el("input", { type: "checkbox", role: "switch", className: "switch" });
  explorations.onchange = () => {
    storage.write(EXPLORATIONS_KEY, explorations.checked);
    week.disabled = explorations.checked;
    changeFeed();
  };
  const themes = [["system", "System"], ["light", "Light"], ["dark", "Dark"]];
  const choices = themes.map(([value, label]) => {
    const input = el("input", { type: "radio", name: "theme", value, ariaLabel: `${label} appearance` });
    input.onchange = () => chooseTheme(value);
    return input;
  });
  const glyph = (key, theme) => el("img", { className: `${key} on-${theme}`, src: `social-${key}-${theme}.png`, alt: "" });
  const panel = el("div", { id: "settings", className: "panel", popover: "auto", role: "dialog", ariaLabel: "Settings" }, [
    el("a", { className: "row", href: withCampaign(ABOUT_URL), textContent: "About" }),
    el("label", { className: "row preference" }, [el("span", { textContent: "Explorations" }), explorations]),
    el("label", { className: "row preference" }, [el("span", { textContent: "This week's picks" }), week]),
    el("div", { className: "themes", role: "radiogroup", ariaLabel: "Appearance" },
      themes.map(([value, label], i) => el("label", { className: "theme", title: label }, [choices[i], themeIcon(value)]))),
    el("div", { className: "socials", role: "group", ariaLabel: "Socials" }, [
      el("span", { className: "socials-label", textContent: "Socials" }),
      ...SOCIALS.map(({ key, name, url }) => el("a", { className: "social", href: url, target: "_blank", rel: "noreferrer noopener", ariaLabel: `posts.design on ${name}` },
        [glyph(key, "light"), glyph(key, "dark")])),
    ]),
  ]);
  // It opens on the current choices (another tab may have changed them).
  panel.addEventListener("toggle", (event) => {
    if (event.newState !== "open") return;
    choices.find((input) => input.value === themeChoice()).checked = true;
    week.checked = storage.read(WEEK_KEY) === true;
    explorations.checked = week.disabled = feedMode() === "explorations";
  });
  return panel;
}

/**
 * The top bar, the progress marker and the side arrows. Built once, so the progress pill slides between
 * posts. Top right, Copy for agent and Settings rest faint and light up when the pointer nears the top.
 */
function buildShell() {
  const side = (direction, delta, label) => el("button", { type: "button", className: `side ${direction}`, ariaLabel: label, onclick: () => step(delta) },
    [el("span", { className: "disc" }, [chevron()])]);
  const parts = {
    progress: progressMarker(),
    prev: side("prev", -1, "Previous post"),
    next: side("next", 1, "Next post"),
    copy: el("button", { type: "button", className: "chip copy", ariaLive: "polite" }, [copyIcon(), el("span", { className: "labels" }, [
      el("span", { className: "label", textContent: "Copy for agent" }),
      el("span", { className: "label copied", textContent: "Copied" }),
      el("span", { className: "label failed", textContent: "Couldn't copy" }),
    ])]),
    settings: el("button", { type: "button", className: "chip icon", ariaLabel: "Settings", title: "Settings" }, [gear()]),
    panel: settingsPanel(),
    // Names the post an arrow brought, for screen readers; the opening post is simply there.
    status: el("span", { className: "visually-hidden", role: "status" }),
  };
  parts.copy.onclick = () => copyForAgent(parts.copy);
  parts.settings.popoverTargetElement = parts.panel;
  app.replaceChildren(el("header", { className: "top" }, [parts.copy, parts.settings, parts.panel]), parts.progress.node, parts.prev, parts.next, parts.status);
  return parts;
}

/**
 * The posts either side of the one on screen (owner, 2026-11-12): once it shows, their stills and
 * avatars load, so an arrow step shows the next post at once instead of an empty page while it loads.
 * A video post appears on its still, so its video still loads only when it is stepped to. Skipped
 * when the reader asked to save data.
 */
const warmed = new Map();
function warmNeighbours(posts, index) {
  if (posts.length < 2 || navigator.connection?.saveData) return;
  for (const delta of [1, -1]) {
    const post = posts[(index + delta + posts.length) % posts.length];
    for (const src of [post.image, post.avatar, post.brand?.avatar]) {
      if (!src || warmed.has(src)) continue;
      const image = new Image();
      image.decoding = "async";
      image.src = src;
      warmed.set(src, image);
    }
  }
}


/** Ends a post's video and glow sampling and takes it off the page. */
function retire(node) {
  node.stopMedia?.();
  node.remove();
}

/** Who the post is credited to, as the wall's caption says it: "Brand by @username" for a person posting for a brand. */
function creditLine(post) {
  const handle = post.handle ? `@${post.handle}` : "";
  return post.brand?.name ? `${post.brand.name}${handle ? ` by ${handle}` : ""}` : handle;
}

/**
 * The wall's media overlay (post-media-frame.tsx AuthorAvatar and PostedDateChip, owner 2026-11-13),
 * shown while the pointer is over the post: bottom left the author pill, top right when it went out. A
 * person posting for a brand rests on the brand's avatar with theirs fanning out beside it; a brand
 * leads with its logo's rounded square. An avatar that can't load becomes its initial. Decorative: the
 * post's link names all of it.
 */
function overlay(post) {
  const brand = post.brand, lead = brand?.avatar ?? post.avatar;
  const avatar = (src, className, initial) => el("img", { className, src, alt: "", decoding: "async", onerror() {
    this.replaceWith(el("span", { className, textContent: (initial.replace(/^@/, "")[0] ?? "").toUpperCase() }));
  } });
  const pill = el("span", { className: `pill${brand || post.byBrand ? " brand" : ""}`, ariaHidden: "true" }, [
    el("span", { className: "pill-surface badge" }),
    ...(lead ? [avatar(lead, "avatar lead", brand?.name || post.handle)] : []),
    ...(brand && post.avatar ? [avatar(post.avatar, "avatar by", post.handle)] : []),
    ...(post.handle ? [el("span", { className: "who", textContent: `@${post.handle}` })] : []),
  ]);
  const posted = el("span", { className: "posted badge", ariaHidden: "true", textContent: dayLabel(post.postedAt) });
  return lead || post.handle ? [pill, posted] : [posted];
}

/**
 * Opening a post (owner, 2026-11-13): everything around it fades and the post comes a little closer as
 * posts.design loads its page. The navigation starts at once and this page keeps moving until the next
 * one replaces it, so the motion never delays it; a click that opens a new tab moves nothing.
 */
function depart(event) {
  if (event.defaultPrevented || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  app.classList.add("departing");
}
// Back from the post's page, the tab may come back as it was left.
addEventListener("pageshow", (event) => { if (event.persisted) app.classList.remove("departing"); });

/**
 * `enter` is how the post arrives: "open" unveils it as the tab opens, "next" and "prev" bring it into
 * focus (owner, 2026-11-12). It is shown only once it has a frame, so nothing fades in empty and then
 * pops.
 */
function render(posts, index, enter = "open") {
  const before = current;
  const post = posts[index];
  shell ??= buildShell();
  // Only the post on screen lights the room: a post on its way out keeps sampling until it goes.
  const light = halo((sample, first) => { if (current?.light === light) room.show(sample, first ? (enter === "open" ? ROOM_OPEN_MS : ROOM_FIRST_MS) : ROOM_DRIFT_MS); });
  const reveal = () => { figure.classList.add("ready"); app.classList.add("opened"); warmNeighbours(posts, index); };
  const shown = media(post, light, reveal, () => {
    if (current?.light !== light) return;
    const rest = current.posts.filter((_, i) => i !== current.index);
    if (rest.length) render(rest, current.index % rest.length, enter); else renderEmpty();
  });
  current = { posts, index, light, stop: shown.stop, slides: shown.move ? shown : null };
  const name = [post.title, creditLine(post), dayLabel(post.postedAt)].filter(Boolean).join(", ");
  const link = el("a", { className: "frame", href: withCampaign(post.post), ariaLabel: name }, [light.node, shown.node]);
  link.addEventListener("click", depart);
  const figure = el("figure", { className: "post" }, [link, ...overlay(post), ...(shown.controls ? [shown.controls] : [])]);
  figure.dataset.enter = enter;
  // The post before softens out under the new one, its video still playing, while its light hands over;
  // a quick second step ends that at once.
  app.querySelectorAll(".post.leaving").forEach(retire);
  const previous = app.querySelector(".post");
  if (previous) {
    // A post that never showed (its picture failed) stays unseen as it goes.
    Object.assign(previous, { inert: true, className: `post leaving${previous.classList.contains("ready") ? " ready" : ""}`, stopMedia: before?.stop });
    previous.dataset.leave = enter;
    previous.after(figure);
    setTimeout(() => retire(previous), stillMotion ? 0 : LEAVE_MS);
  } else {
    before?.stop();
    app.prepend(figure);
  }
  fit();
  if (enter !== "open") shell.status.textContent = name;
  place(posts, index);
}

/** Where the post on screen sits in the set: kept for the next tab, and on the progress marker. */
function place(posts, index) {
  storage.write(SEEN_KEY, { post: posts[index].post, newest: posts[0].published });
  shell.progress.show(posts.length, index + 1);
  shell.progress.node.hidden = shell.prev.hidden = shell.next.hidden = posts.length < 2;
}

/**
 * After Explorations changes: the other feed's posts from their newest, from its kept copy, or read now
 * when there is none (a failed read leaves the posts on screen). A kept copy over an hour old is read
 * again for the next tab.
 */
function changeFeed() {
  const source = feedMode(), kept = keptFeed(source);
  const swap = (entries) => {
    const posts = featured(entries, source);
    if (feedMode() !== source || !posts.length) return;
    feedEntries = entries;
    feedSource = source;
    render(posts, 0, "next");
    refill();
  };
  if (kept) swap(kept.entries);
  if (!kept || Date.now() - (kept.fetchedAt ?? 0) > REFRESH_MS) readFeed(source).then((entries) => { if (!kept) swap(entries); }, () => {});
}

/** Picks short of six after a switch: once their top-up feeds are read, the set grows to six. */
function refill() {
  if (feedSource === "picks") topUp(feedEntries).then(() => { if (feedSource === "picks") regroup(); });
}

/** After This week's picks changes: the post on screen stays when it is in the new set, else its newest comes. */
function regroup() {
  if (!current || !feedEntries) return;
  const posts = featured(feedEntries, feedSource);
  const index = posts.findIndex((post) => post.post === current.posts[current.index].post);
  if (index < 0) { render(posts, 0, "next"); return; }
  Object.assign(current, { posts, index });
  place(posts, index);
}

/** A swipe: over a carousel it moves the slides while there are more that way, else it changes the post. */
function turn(delta, target) {
  if (target?.closest?.(".post:not(.leaving)") && current?.slides?.move(delta)) return;
  step(delta);
}

function step(delta) {
  if (!current || current.posts.length < 2) return;
  const { posts, index } = current;
  render(posts, (index + delta + posts.length) % posts.length, delta > 0 ? "next" : "prev");
}

let resizing = 0;
window.addEventListener("resize", () => {
  if (!resizing) resizing = requestAnimationFrame(() => { resizing = 0; fit(); room.resize(); });
});

document.addEventListener("keydown", (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
  if (event.key === "ArrowLeft") step(-1);
  if (event.key === "ArrowRight") step(1);
});

/**
 * Swipes step like the arrows (owner, 2026-11-12), one post per swipe: left for the next post, right for
 * the one before. On a trackpad a two-finger swipe arrives as horizontal scrolling, and the momentum
 * after the fingers lift is still the same swipe; a new one starts after a pause, or when the push grows
 * again once that momentum has nearly faded. Over a carousel it turns the slides first (turn). Chrome's own swipe back is off (newtab.css), so it never
 * leaves the page. A swipe inside Settings is left alone.
 */
const SWIPE_PX = 40, SWIPE_QUIET_MS = 200;
const swipe = { sum: 0, done: false, low: Infinity, at: 0, stepped: 0 };
window.addEventListener("wheel", (event) => {
  if (event.ctrlKey || event.target.closest?.(".panel")) return;
  const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerWidth : 1;
  const dx = event.deltaX * scale, push = Math.abs(dx);
  if (push <= Math.abs(event.deltaY * scale)) return;
  event.preventDefault();
  const now = event.timeStamp;
  // Momentum only fades, so a push at least twice its faintest since the step is a new swipe.
  const fresh = now - swipe.at > SWIPE_QUIET_MS || (swipe.done && now - swipe.stepped > 250 && swipe.low < 6 && push > swipe.low * 2 + 6);
  if (fresh) Object.assign(swipe, { sum: 0, done: false, low: Infinity });
  swipe.at = now;
  if (swipe.done) { swipe.low = Math.min(swipe.low, push); return; }
  swipe.sum += dx;
  if (Math.abs(swipe.sum) < SWIPE_PX) return;
  Object.assign(swipe, { done: true, stepped: now });
  turn(swipe.sum > 0 ? 1 : -1, event.target);
}, { passive: false });

// On a touchscreen, one finger swiped across the page; the tap that ends a swipe doesn't open the post.
let touch = null, swipedAt = -Infinity;
app.addEventListener("pointerdown", (event) => {
  if (event.pointerType === "touch" && event.isPrimary && !event.target.closest(".panel")) touch = { x: event.clientX, y: event.clientY, id: event.pointerId, target: event.target };
});
app.addEventListener("pointerup", (event) => {
  if (touch?.id !== event.pointerId) return;
  const dx = event.clientX - touch.x, dy = event.clientY - touch.y, from = touch;
  touch = null;
  if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
  swipedAt = event.timeStamp;
  turn(dx < 0 ? 1 : -1, from.target);
});
app.addEventListener("pointercancel", () => { touch = null; });
app.addEventListener("click", (event) => {
  if (event.timeStamp - swipedAt < 500) { event.preventDefault(); event.stopPropagation(); }
}, true);

// A tab left in the background stops playing; it plays on when it is seen again.
document.addEventListener("visibilitychange", () => {
  const video = app.querySelector(".post:not(.leaving) video.picture");
  // A video kept on its still (reduced motion, Data Saver) never starts.
  if (!video?.autoplay) return;
  if (document.hidden) video.pause(); else video.play().catch(() => {});
});

/**
 * Each new tab opens on the post after the one last on screen (owner, 2026-11-12), so tabs rotate
 * through the set; a post published since then comes first, and past the oldest it starts again at
 * the newest. The arrows go back in time from there.
 */
function opening(posts, seen) {
  if (!seen || posts[0].published > seen.newest) return 0;
  const last = posts.findIndex((post) => post.post === seen.post);
  return last < 0 ? 0 : (last + 1) % posts.length;
}

/** A feed's kept copy, { fetchedAt, entries }, or null. */
function keptFeed(source) {
  const kept = storage.read(FEEDS[source].key);
  return Array.isArray(kept?.entries) ? kept : null;
}

/** Reads a feed and keeps it. */
function readFeed(source) {
  const { url, key } = FEEDS[source];
  return fetch(url, { credentials: "omit" })
    .then((response) => { if (!response.ok) throw new Error(`Feed ${response.status}`); return response.text(); })
    .then((text) => {
      const entries = parseFeed(text);
      storage.write(key, { fetchedAt: Date.now(), entries });
      return entries;
    });
}

function show(entries, source) {
  const posts = featured(entries, source);
  if (!posts.length) return false;
  feedEntries = entries;
  feedSource = source;
  render(posts, opening(posts, storage.read(SEEN_KEY)));
  return true;
}

const stale = (copy) => !copy || Date.now() - (copy.fetchedAt ?? 0) > REFRESH_MS;

/** Picks short of six: the feeds that top them up, read when their kept copy is missing or over an hour old. */
function topUp(entries) {
  if (picked(entries).length >= MIN_POSTS) return Promise.resolve();
  return Promise.all(["explorations", "latest"].map((source) => stale(keptFeed(source)) ? readFeed(source).catch(() => null) : null));
}

const source = feedMode(), kept = keptFeed(source);
const shownFromCache = Boolean(kept) && show(kept.entries, source);
// Kept picks short of six top up from the next tab.
if (shownFromCache && source === "picks") topUp(kept.entries);
if (!shownFromCache || stale(kept)) {
  // A kept copy is never swapped under the reader; the fresh feed is used from the next tab. A first
  // tab waits for the top-up feeds it needs, so it opens on six posts.
  readFeed(source)
    .then((entries) => source === "picks" ? topUp(entries).then(() => entries) : entries)
    .then((entries) => { if (!shownFromCache && !show(entries, source)) renderEmpty(); })
    .catch(() => { if (!shownFromCache) renderEmpty(); });
}
