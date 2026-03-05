import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import type { Movie } from "../scripts/scrape";

// Load .env
const envPath = path.resolve(__dirname, "../.env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const [k, ...v] = line.split("=");
    if (k?.trim() && !process.env[k.trim()]) process.env[k.trim()] = v.join("=").trim();
  }
}

const app = express();
app.use(cors());
app.use(express.json());

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "out");
const TRACKS_DIR = path.join(ROOT, "tracks");
const MOVIES_PATH = path.join(ROOT, "movies.json");
const QUEUE_PATH = path.join(ROOT, "queue.json");

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(TRACKS_DIR, { recursive: true });

// ─── Types ────────────────────────────────────────────────────────────────

type JobStatus = "pending" | "rendering" | "done" | "error";
interface RenderJob {
  id: string;
  movieId: string;
  audioUrl: string | null;
  status: JobStatus;
  progress: number;
  outputPath: string | null;
  error: string | null;
  createdAt: string;
}

export interface JamendoTrack {
  id: string;
  name: string;
  duration: number;
  artist_name: string;
  album_name: string;
  audio: string;       // streaming URL
  audiodownload: string;
  audiodownload_allowed: boolean;
  image: string;
}

// ─── State ────────────────────────────────────────────────────────────────

const jobs = new Map<string, RenderJob>();
let cachedBundle: string | null = null;

// ─── Helpers ──────────────────────────────────────────────────────────────

function loadMovies(): Movie[] {
  if (!fs.existsSync(MOVIES_PATH)) return [];
  return JSON.parse(fs.readFileSync(MOVIES_PATH, "utf-8"));
}

function loadQueue(): string[] {
  if (!fs.existsSync(QUEUE_PATH)) return [];
  return JSON.parse(fs.readFileSync(QUEUE_PATH, "utf-8"));
}

function saveQueue(q: string[]) {
  fs.writeFileSync(QUEUE_PATH, JSON.stringify(q, null, 2));
}

function outputPath(movieId: string) {
  return path.join(OUT_DIR, `trailer-${movieId}.mp4`);
}

async function getBundle(): Promise<string> {
  if (cachedBundle) return cachedBundle;
  cachedBundle = await bundle({ entryPoint: path.join(ROOT, "src/index.ts") });
  return cachedBundle;
}

// ─── Movies ───────────────────────────────────────────────────────────────

app.get("/api/movies", async (_req, res) => {
  try {
    const needsRefresh =
      !fs.existsSync(MOVIES_PATH) ||
      Date.now() - fs.statSync(MOVIES_PATH).mtimeMs > 60 * 60 * 1000;

    if (needsRefresh) {
      const { execSync } = await import("child_process");
      execSync("npx tsx scripts/scrape.ts", { cwd: ROOT, stdio: "pipe" });
    }

    const movies = loadMovies();
    const queue = loadQueue();
    res.json(movies.map((m) => ({
      ...m,
      rendered: fs.existsSync(outputPath(m.id)),
      queued: queue.includes(m.id),
    })));
  } catch (e: unknown) {
    res.status(500).json({ error: String(e) });
  }
});

// ─── Local tracks ─────────────────────────────────────────────────────────

app.get("/api/tracks", (_req, res) => {
  const files = fs.existsSync(TRACKS_DIR)
    ? fs.readdirSync(TRACKS_DIR).filter((f) => /\.(mp3|wav|aac|m4a|ogg)$/i.test(f))
    : [];
  res.json(files.map((f) => ({ name: f, url: `/tracks/${f}` })));
});

// ─── Jamendo music search ─────────────────────────────────────────────────

app.get("/api/music/search", async (req, res) => {
  const clientId = process.env.JAMENDO_CLIENT_ID;
  if (!clientId) {
    return res.status(400).json({
      error: "JAMENDO_CLIENT_ID not set",
      hint: "Add JAMENDO_CLIENT_ID=your_key to .env — get a free key at developer.jamendo.com",
    });
  }

  const q = (req.query.q as string) || "";
  const tags = (req.query.tags as string) || "";

  const params = new URLSearchParams({
    client_id: clientId,
    format: "json",
    limit: "20",
    order: "popularity_month",
    audioformat: "mp31",
  });
  if (q) params.set("search", q);
  if (tags) params.set("fuzzytags", tags);

  try {
    const r = await fetch(`https://api.jamendo.com/v3.0/tracks/?${params}`);
    const data = (await r.json()) as { results: JamendoTrack[] };
    res.json(data.results ?? []);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Download a Jamendo track and cache it in tracks/
app.post("/api/music/cache", async (req, res) => {
  const { streamUrl, name, artist } = req.body as {
    streamUrl: string;
    name: string;
    artist: string;
  };

  const safe = `${artist} - ${name}`.replace(/[^a-zA-Z0-9 \-_]/g, "").trim();
  const filename = `${safe}.mp3`;
  const dest = path.join(TRACKS_DIR, filename);

  if (fs.existsSync(dest)) {
    return res.json({ url: `/tracks/${encodeURIComponent(filename)}`, cached: true });
  }

  try {
    const r = await fetch(streamUrl);
    if (!r.ok) throw new Error(`Fetch failed: ${r.status}`);
    const buf = await r.arrayBuffer();
    fs.writeFileSync(dest, Buffer.from(buf));
    res.json({ url: `/tracks/${encodeURIComponent(filename)}`, cached: false });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ─── Render ───────────────────────────────────────────────────────────────

app.post("/api/render", async (req, res) => {
  const { movieId, audioUrl } = req.body as { movieId: string; audioUrl?: string };
  const movies = loadMovies();
  const movie = movies.find((m) => m.id === movieId);
  if (!movie) return res.status(404).json({ error: "Movie not found" });

  const jobId = `${movieId}-${Date.now()}`;
  const job: RenderJob = {
    id: jobId,
    movieId,
    audioUrl: audioUrl ?? null,
    status: "pending",
    progress: 0,
    outputPath: null,
    error: null,
    createdAt: new Date().toISOString(),
  };
  jobs.set(jobId, job);
  res.json({ jobId });

  (async () => {
    try {
      job.status = "rendering";
      const FPS = 30;

      const inputProps = {
        videoUrl: movie.video_url,
        videoDurationSec: (movie.duration ?? 1) * 60,
        title: movie.title,
        director: movie.director,
        country: movie.country,
        genres: movie.genres ?? [],
        audioUrl: audioUrl ?? undefined,
      };

      const serveUrl = await getBundle();
      const composition = await selectComposition({ serveUrl, id: "Trailer", inputProps });
      const out = outputPath(movieId);

      await renderMedia({
        composition: { ...composition, durationInFrames: 30 * FPS },
        serveUrl,
        codec: "h264",
        outputLocation: out,
        inputProps,
        onProgress: ({ progress }) => { job.progress = Math.round(progress * 100); },
      });

      job.status = "done";
      job.outputPath = out;
    } catch (e: unknown) {
      job.status = "error";
      job.error = String(e);
    }
  })();
});

app.get("/api/render/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json(job);
});

app.get("/api/rendered/:movieId", (req, res) => {
  const p = outputPath(req.params.movieId);
  res.json({ rendered: fs.existsSync(p), url: `/out/${path.basename(p)}` });
});

// ─── Queue ────────────────────────────────────────────────────────────────

app.post("/api/queue", (req, res) => {
  const { movieId } = req.body as { movieId: string };
  const q = loadQueue();
  if (!q.includes(movieId)) { q.push(movieId); saveQueue(q); }
  res.json({ ok: true, queue: q });
});

app.delete("/api/queue/:movieId", (req, res) => {
  saveQueue(loadQueue().filter((id) => id !== req.params.movieId));
  res.json({ ok: true });
});

app.get("/api/queue", (_req, res) => {
  const q = loadQueue();
  const movies = loadMovies();
  res.json(q.map((id) => {
    const m = movies.find((m) => m.id === id);
    return { id, title: m?.title ?? id, rendered: fs.existsSync(outputPath(id)) };
  }));
});

// ─── Static ───────────────────────────────────────────────────────────────

app.use("/out", express.static(OUT_DIR));
app.use("/tracks", express.static(TRACKS_DIR));
app.use(express.static(path.join(ROOT, "web")));

const PORT = 3333;
app.listen(PORT, () => {
  const hasJamendo = !!process.env.JAMENDO_CLIENT_ID;
  console.log(`\n✅  CAIS ROOM dashboard → http://localhost:${PORT}`);
  console.log(`🎵  Jamendo: ${hasJamendo ? "configured ✓" : "not configured (add JAMENDO_CLIENT_ID to .env)"}\n`);
});
