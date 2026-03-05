# instagram-caisroom

Automatically generates and posts 9:16 mini trailers for [CAIS ROOM](https://caisroom.com) films to Instagram, using [Remotion](https://remotion.dev).

## How it works

1. **Scrape** — fetches all films from the CAIS ROOM database
2. **Render** — creates a 30s 1080×1920 (9:16) trailer using Remotion with the film's loop video, title, director and genre overlays
3. **Post** — uploads the rendered video to Instagram as a Reel

## Setup

```bash
npm install
```

Copy `.env.example` to `.env` and fill in your Instagram credentials:

```bash
cp .env.example .env
```

## Commands

| Command | Description |
|---|---|
| `npm run dev` | Open Remotion Studio to preview the trailer composition |
| `npm run scrape` | Fetch latest films from caisroom.com → `movies.json` |
| `npm run render` | Render trailer for movie at index 0 (pass index as arg) |
| `npm run post <video>` | Post a rendered video to Instagram |
| `npm run run-all` | Full pipeline: scrape → render → post |

### Render a specific film

```bash
npm run render -- 5   # renders movies.json[5]
```

### Post manually

```bash
npm run post -- out/trailer-<id>.mp4 "Caption here"
```

## Project structure

```
src/
  Trailer.tsx     — Remotion composition (9:16, 30s)
  Root.tsx        — Remotion root with composition registration
scripts/
  scrape.ts       — Fetches films from caisroom.com
  render.ts       — Renders a trailer with @remotion/renderer
  post.ts         — Posts to Instagram via instagram-private-api
  run-all.ts      — End-to-end pipeline
out/              — Rendered videos (gitignored)
movies.json       — Cached film list (gitignored)
posted.json       — Tracks posted films (gitignored)
```
