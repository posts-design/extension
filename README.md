# posts.design new tab

A featured launch post from [posts.design](https://posts.design) on every new tab in Chrome.

It features posts.design's picks, the posts chosen for its socials and newsletter in the last 24
hours (or the last 7 days, with **This week's picks** on in Settings), or, when there are none, those
from the most recent day that had some. With **Explorations** on in Settings, it features posts.design's
Explorations instead, independent designers' posts: the last 2 days', and at least the 6 newest. Each new tab opens on the post after the one you saw last, so tabs take
turns through them; a newly published post comes first. Hover either side of the screen for an
arrow, swipe sideways with two fingers on a trackpad (or one on a touchscreen), or click the page
and use the ← and → keys, to go back through them. Videos play muted on a
loop; with reduced motion or Chrome's Data Saver turned on, they show their still and the light stays
put.

Point at the post to see who posted it and when, as on posts.design's wall. When a person posted it
for a brand, the brand's avatar shows with theirs beside it. Click the post to open its page on
posts.design, where the original post and the video player are; a Cmd- or Ctrl-click opens it in a new
tab.

Point near the top for **Copy for agent** and the settings gear. Copy for agent copies a short prompt
about the post on screen to paste into an AI agent with your own brief: its links, its categories and
subjects, and how to open it with posts.design's MCP server for its media and full details, connecting
it first with a free account if it isn't. The gear opens a menu with posts.design's About page, the
Explorations and This week's picks switches, the choice of System, Light or Dark, and posts.design's profiles on X,
LinkedIn and Threads.

Every post takes about the same share of the window, whatever its shape, so a wide post and a square
one weigh alike and only the tallest reach the window's height; a post never grows past one and a half
times its own pixels at your screen's density. Its colours light the page faintly around it and wash softly
across the whole page, which takes on a calm tone of its colour and follows a playing video slowly. In
dark mode the page stays black and only just brightens where the post itself is bright.
It follows your system's light or dark mode unless you choose one in Settings.

## Install

From the Chrome Web Store, or from this folder:

1. Download or clone this repository.
2. In Chrome, open `chrome://extensions`, turn on **Developer mode** and select **Load unpacked**.
3. Choose the folder. Open a new tab, and select **Keep it** when Chrome asks.

Remove it from `chrome://extensions` to get Chrome's own new tab back.

## What it does with data

- It asks for no permissions. Chrome's only notice at install is that it replaces the page you see
  when opening a new tab.
- It reads one public file, `https://posts.design/feed/new-tab.xml`, or
  `https://posts.design/feed/explorations.xml` with Explorations on, and keeps a copy in the page's
  local storage, so a new tab never waits for the network. Once it has a copy, it reads the feed at
  most once an hour. Beside it, it keeps the address of the post you saw last, so the next tab opens on
  the one after, and your theme, Explorations and This week's picks if you chose them in Settings.
- Posts, videos and avatars load from posts.design. With Data Saver on, only the post on screen loads,
  and a video post stays on its still.
- Copy for agent writes to your clipboard only when you click it, and never reads it.
- It has no analytics and no account. Beyond the ordinary requests for the feed, pictures and videos,
  it sends nothing about you. Links to posts.design carry `utm_source=chrome-extension`, so
  posts.design can count visits that came from it. posts.design's privacy policy:
  https://posts.design/privacy.

## How it works

Plain HTML, CSS and JavaScript with no build step and no dependencies:

- `manifest.json`: replaces the new tab page (Manifest V3).
- `newtab.html`: the page, with the filter that caps the light's brightest parts in dark mode.
- `theme.js`: applies System, Light or Dark before the page paints.
- `newtab.js`: reads the feed and shows the posts.
- `newtab.css`: the layout, using posts.design's colours.
- `social-*.png`: posts.design's X, LinkedIn and Threads glyphs, for a light and a dark page.

The feed has the format of posts.design's public Atom feed (`/feed.xml`), with its picks instead of
every post: the newest 50 with
[Media RSS](https://www.rssboard.org/media-rss) pictures and videos. Its own fields, in the
`https://posts.design/ns/feed` namespace, give the title without the account's name, the account that
posted it (`handle`, `kind` brand or person, `avatar`, and a brand's `page`), the brand a person posted it for (`brand`:
`name`, `avatar`, `page`) and when it went out (`postedAt`).

## Licence

MIT. The posts.design name and logo are not covered by the licence.
