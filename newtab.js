"use strict";

// The public feed is every Recent post, the set the newsletter takes automatically, newest 50 first.
// posts.design refreshes it whenever a post is published, and Cloudflare caches it for ten minutes.
const FEED_URL = "https://posts.design/feed.xml";
const SITE_HOST = "posts.design";
const SITE_URL = "https://posts.design/";
const CAMPAIGN = { utm_source: "chrome-extension", utm_medium: "referral" };
const FEED_KEY = "posts-design-newtab:feed:v2";
const REFRESH_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const ATOM_NS = "http://www.w3.org/2005/Atom";
const MEDIA_NS = "http://search.yahoo.com/mrss/";
const POSTS_NS = "https://posts.design/ns/feed";
const SAMPLE_WIDTH = 16; // the ambient light takes colour fields, not detail
const SAMPLE_EVERY_MS = 2600; // a playing video's next colour, crossfaded over the CSS transition
const stillMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const app = document.getElementById("app");
let current = null; // { posts, index, stop } for the post on screen
let shell = null; // the footer and arrows, built once and updated in place

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
    const post = siteUrl(link("alternate"));
    const image = siteUrl(thumbnail?.getAttribute("url") ?? "");
    const published = Date.parse(text(ATOM_NS, "published"));
    if (!post || !image || Number.isNaN(published)) return [];
    const video = content?.getAttribute("type")?.startsWith("video/") ? siteUrl(content.getAttribute("url") ?? "") : null;
    const postedAt = Date.parse(text(POSTS_NS, "postedAt"));
    return [{
      post, image, published,
      postedAt: Number.isNaN(postedAt) ? published : postedAt,
      size: (video && size(content)) || size(thumbnail),
      video,
      source: httpsUrl(link("via"))?.href ?? null,
      title: text(POSTS_NS, "title") || text(ATOM_NS, "title"),
      handle: account?.getAttribute("handle") ?? "",
      avatar: siteUrl(account?.getAttribute("avatar") ?? ""),
      avatarShape: account?.getAttribute("kind") === "brand" ? "brand" : "person",
      alt: text(ATOM_NS, "summary"),
    }];
  }).sort((a, b) => b.published - a.published);
}

/** "2h ago": how recently the post went out, in a short form; a date beyond a week. */
function postedAgo(time, now = Date.now()) {
  const minutes = Math.max(1, Math.round((now - time) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days}d ago` : new Date(time).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** The last 24 hours, or else the most recent day that had any. */
function featured(entries, now = Date.now()) {
  const recent = entries.filter((entry) => now - entry.published < DAY_MS);
  if (recent.length || !entries.length) return recent;
  const newest = new Date(entries[0].published).toDateString();
  return entries.filter((entry) => new Date(entry.published).toDateString() === newest);
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

/** The site's carousel arrow chevron (src/components/media-carousel.tsx). */
function chevron() {
  return svg("svg", { width: "20", height: "20", viewBox: "0 0 20 20", fill: "none", stroke: "currentColor", "stroke-width": "1.8",
    "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" }, [svg("path", { d: "m7.5 5 5 5-5 5" })]);
}

function renderEmpty() {
  current?.stop();
  current = null;
  shell = null;
  app.replaceChildren(el("a", { className: "wordmark", href: withCampaign(SITE_URL), textContent: "posts.design" }));
}

function pixels(post, media) {
  return post.size ?? { width: media?.naturalWidth || media?.videoWidth || 0, height: media?.naturalHeight || media?.videoHeight || 0 };
}

/** As large as the room allows, but never past the post's own pixels at this screen's density. */
function fit() {
  const figure = app.querySelector(".post");
  if (!figure || !current) return;
  const { width, height } = pixels(current.posts[current.index], figure.querySelector(".picture"));
  if (!width || !height) return;
  const style = getComputedStyle(app);
  const room = Math.min(
    app.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
    (window.innerHeight - parseFloat(style.getPropertyValue("--chrome"))) * width / height,
  );
  const shown = Math.max(0, Math.floor(Math.min(width / (window.devicePixelRatio || 1), room)));
  figure.style.width = `${shown}px`;
  // The side arrows' targets stop at the picture's edge, so clicking the picture always opens it.
  app.style.setProperty("--gutter", `${Math.floor((app.clientWidth - shown) / 2)}px`);
  figure.classList.add("ready");
}

/**
 * Ambient light: two tiny canvases of the post's colour fields, which CSS scales up, blurs and drifts.
 * Each new sample lights the other canvas, which crossfades in, so a video's glow changes slowly.
 */
function halo() {
  const layers = [el("canvas"), el("canvas")];
  let lit = 0;
  return {
    node: el("span", { className: "halo", ariaHidden: "true" }, layers),
    sample(source) {
      const width = source.naturalWidth || source.videoWidth, height = source.naturalHeight || source.videoHeight;
      if (!width || !height) return;
      const next = layers[1 - lit];
      next.width = SAMPLE_WIDTH;
      next.height = Math.max(1, Math.round(SAMPLE_WIDTH * height / width));
      next.getContext("2d").drawImage(source, 0, 0, next.width, next.height);
      next.classList.add("lit");
      layers[lit].classList.remove("lit");
      lit = 1 - lit;
    },
  };
}

/**
 * The picture, or the post's video playing muted on a loop. `failed` runs when it can't load (a post
 * withdrawn since the feed was kept); `stop` ends its glow sampling and its download.
 */
function media(post, light, failed) {
  const label = post.alt || post.title;
  if (!post.video) {
    const picture = el("img", { className: "picture", alt: label, decoding: "async" });
    picture.onload = () => { light.sample(picture); fit(); };
    picture.onerror = failed;
    picture.src = post.image;
    return { node: picture, stop() {} };
  }
  // Under reduced motion it shows its still and never plays, so it downloads nothing more.
  const video = el("video", { className: "picture", poster: post.image, muted: true, loop: true, playsInline: true, preload: stillMotion ? "none" : "auto", ariaLabel: label });
  video.autoplay = !stillMotion;
  const poster = new Image();
  poster.onload = () => { if (!video.videoWidth) light.sample(poster); };
  poster.src = post.image;
  video.addEventListener("loadedmetadata", fit);
  video.addEventListener("loadeddata", () => light.sample(video), { once: true });
  video.addEventListener("error", failed);
  video.src = post.video;
  const timer = stillMotion ? 0 : setInterval(() => { if (!video.paused) light.sample(video); }, SAMPLE_EVERY_MS);
  return { node: video, stop() { clearInterval(timer); video.removeAttribute("src"); video.load(); } };
}

/**
 * The site's carousel progress marker (src/components/media-carousel.tsx CarouselProgress): a fixed
 * track of dots where the current one becomes a pill, sliding between positions.
 */
function progressMarker() {
  const DOT = 6, GAP = 2, PILL = 18, STEP = DOT + GAP, EXTRA = PILL - DOT;
  const track = el("span", { className: "track", ariaHidden: "true" });
  const node = el("span", { className: "progress", role: "progressbar", ariaLabel: "Featured posts" }, [track]);
  let slots = [], pill = null;
  const slot = (width) => el("span", { className: "slot" }, [Object.assign(el("span", { className: "dot" }), { style: `width: ${width}%` })]);
  return {
    node,
    show(total, position) {
      const width = total * STEP - GAP + EXTRA;
      if (slots.length !== total) {
        slots = Array.from({ length: total }, () => slot(DOT / width * 100));
        pill = slot(PILL / width * 100);
        pill.classList.add("active");
        track.replaceChildren(...slots, pill);
        node.style.width = `${width}px`;
      }
      slots.forEach((item, i) => {
        item.style.transform = `translateX(${(i * STEP + (i >= position ? EXTRA : 0)) / width * 100}%)`;
        item.style.opacity = i + 1 === position ? "0" : "1";
      });
      pill.style.transform = `translateX(${(position - 1) * STEP / width * 100}%)`;
      Object.assign(node, { ariaValueMin: "1", ariaValueMax: String(total), ariaValueNow: String(position), ariaValueText: `Post ${position} of ${total}` });
    },
  };
}

/** The footer and side arrows. Built once, so the progress pill slides and colours fade between posts. */
function buildShell() {
  const side = (direction, delta, label) => el("button", { type: "button", className: `side ${direction}`, ariaLabel: label, onclick: () => step(delta) },
    [el("span", { className: "disc" }, [chevron()])]);
  const parts = {
    avatar: el("img", { className: "avatar", alt: "" }),
    title: el("a", { className: "title" }),
    handle: el("span", { className: "handle" }),
    separator: el("span", { textContent: " · " }),
    when: el("time"),
    progress: progressMarker(),
    open: el("a", { className: "open" }, ["See on posts.design", el("span", { className: "logo", ariaHidden: "true" })]),
    prev: side("prev", -1, "Previous post"),
    next: side("next", 1, "Next post"),
  };
  // The site's identity row: a brand tile or person circle beside the title and the @username. Near
  // the bottom the avatar takes its colour, the time appears and See on posts.design shows (CSS :hover).
  const credit = el("span", { className: "credit" }, [
    parts.avatar,
    // Only the credit is announced when the post changes.
    el("span", { className: "names", ariaLive: "polite" }, [parts.title, el("span", { className: "byline" }, [parts.handle, el("span", { className: "when" }, [parts.separator, parts.when])])]),
  ]);
  app.replaceChildren(el("footer", { className: "foot" }, [credit, parts.progress.node, parts.open]), parts.prev, parts.next);
  return parts;
}

function render(posts, index) {
  current?.stop();
  const post = posts[index];
  shell ??= buildShell();
  const light = halo();
  const shown = media(post, light, () => {
    if (current?.posts !== posts || current.index !== index) return;
    const rest = posts.filter((_, i) => i !== index);
    if (rest.length) render(rest, index % rest.length); else renderEmpty();
  });
  current = { posts, index, stop: shown.stop };
  const figure = el("figure", { className: "post" }, [
    el("a", { className: "frame", href: withCampaign(post.post) }, [light.node, shown.node]),
  ]);
  const previous = app.querySelector(".post");
  if (previous) previous.replaceWith(figure); else app.prepend(figure);
  if (post.size) fit();

  // The title opens the original post; the picture and See on posts.design open its page there.
  Object.assign(shell.avatar, { hidden: !post.avatar, className: `avatar ${post.avatarShape}` });
  if (post.avatar) shell.avatar.src = post.avatar; else shell.avatar.removeAttribute("src");
  Object.assign(shell.title, { href: post.source || withCampaign(post.post), textContent: post.title });
  shell.handle.textContent = post.handle ? `@${post.handle}` : "";
  shell.separator.hidden = !post.handle;
  const posted = new Date(post.postedAt);
  Object.assign(shell.when, { dateTime: posted.toISOString(), title: posted.toLocaleString(), textContent: postedAgo(post.postedAt) });
  shell.open.href = withCampaign(post.post);
  shell.progress.show(posts.length, index + 1);
  shell.progress.node.hidden = shell.prev.hidden = shell.next.hidden = posts.length < 2;
}

function step(delta) {
  if (!current || current.posts.length < 2) return;
  const { posts, index } = current;
  render(posts, (index + delta + posts.length) % posts.length);
}

let resizing = 0;
window.addEventListener("resize", () => {
  if (!resizing) resizing = requestAnimationFrame(() => { resizing = 0; fit(); });
});

document.addEventListener("keydown", (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
  if (event.key === "ArrowLeft") step(-1);
  if (event.key === "ArrowRight") step(1);
});

// A tab left in the background stops playing; it resumes when it is seen again.
document.addEventListener("visibilitychange", () => {
  const video = app.querySelector("video.picture");
  if (!video || stillMotion) return;
  if (document.hidden) video.pause(); else video.play().catch(() => {});
});

/** Each new tab opens on the most recent post; the arrows go back in time. */
function show(entries) {
  const posts = featured(entries);
  if (!posts.length) return false;
  render(posts, 0);
  return true;
}

const kept = storage.read(FEED_KEY);
const shownFromCache = Array.isArray(kept?.entries) && show(kept.entries);
if (!shownFromCache || Date.now() - (kept?.fetchedAt ?? 0) > REFRESH_MS) {
  // A kept copy is never swapped under the reader; the fresh feed is used from the next tab.
  fetch(FEED_URL, { credentials: "omit" })
    .then((response) => { if (!response.ok) throw new Error(`Feed ${response.status}`); return response.text(); })
    .then((text) => {
      const entries = parseFeed(text);
      storage.write(FEED_KEY, { fetchedAt: Date.now(), entries });
      if (!shownFromCache && !show(entries)) renderEmpty();
    })
    .catch(() => { if (!shownFromCache) renderEmpty(); });
}
