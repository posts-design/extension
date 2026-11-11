# posts.design new tab

A featured launch post from [posts.design](https://posts.design) on every new tab in Chrome.

Each new tab opens on the most recent featured post: those published in the last 24 hours, or, when
there are none, those from the most recent day that had some. Hover either side of the screen for an
arrow, or click the page and use the ← and → keys, to go back through them. Videos play muted on a
loop; with reduced motion turned on, they show their still and the light stays put.

The bottom left shows the post's title and the account that posted it. Point near the bottom to see
how long ago it went out and **See on posts.design**. The title opens the original post on X; the
post itself and See on posts.design open its page on posts.design.

The post shows as large as the window allows, but never past its own pixels at your screen's density,
so it stays sharp on a Retina display. Its colours, blurred, light the page around it and drift slowly.
It follows your system's light or dark mode.

## Install

From the Chrome Web Store, or from this folder:

1. Download or clone this repository.
2. In Chrome, open `chrome://extensions`, turn on **Developer mode** and select **Load unpacked**.
3. Choose the folder. Open a new tab, and select **Keep it** when Chrome asks.

Remove it from `chrome://extensions` to get Chrome's own new tab back.

## What it does with data

- It asks for no permissions. Chrome's only notice at install is that it replaces the page you see
  when opening a new tab.
- It reads one public file, `https://posts.design/feed.xml`, and keeps a copy in the page's local
  storage, so a new tab never waits for the network. Once it has a copy, it reads the feed at most
  once an hour.
- Posts, videos and avatars load from posts.design.
- It has no analytics and no account. Beyond the ordinary requests for the feed, pictures and videos,
  it sends nothing about you. Links to posts.design carry `utm_source=chrome-extension`, so
  posts.design can count visits that came from it. posts.design's privacy policy:
  https://posts.design/privacy.

## How it works

Plain HTML, CSS and JavaScript with no build step and no dependencies:

- `manifest.json`: replaces the new tab page (Manifest V3).
- `newtab.js`: reads the feed and shows the posts.
- `newtab.css`: the layout, using posts.design's colours.

The feed is posts.design's public Atom feed: the newest 50 posts with
[Media RSS](https://www.rssboard.org/media-rss) pictures and videos. Its own fields, in the
`https://posts.design/ns/feed` namespace, give the title without the account's name, the account that
posted it (`handle`, `kind` brand or person, `avatar`) and when it went out (`postedAt`).

## Licence

MIT. The posts.design name and logo are not covered by the licence.
