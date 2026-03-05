import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import type { Movie } from "../scripts/scrape";

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

// ─── In-memory render jobs ─────────────────────────────────────────────────

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

const jobs = new Map<string, RenderJob>();
let cachedBundle: string | null = null;

// ─── Queue (approved for posting) ─────────────────────────────────────────

function loadQueue(): string[] {
  if (!fs.existsSync(QUEUE_PATH)) return [];
  return JSON.parse(fs.readFileSync(QUEUE_PATH, "utf-8"));
}
function saveQueue(q: string[]) {
  fs.writeFileSync(QUEUE_PATH, JSON.stringify(q, null, 2));
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function loadMovies(): Movie[] {
  if (!fs.existsSync(MOVIES_PATH)) return [];
  return JSON.parse(fs.readFileSync(MOVIES_PATH, "utf-8"));
}

function outputPath(movieId: string) {
  return path.join(OUT_DIR, `trailer-${movieId}.mp4`);
}

async function getBundle(): Promise<string> {
  if (cachedBundle) return cachedBundle;
  cachedBundle = await bundle({
    entryPoint: path.join(ROOT, "src/index.ts"),
  });
  return cachedBundle;
}

// ─── Routes ───────────────────────────────────────────────────────────────

// List movies (fetches fresh from Supabase if movies.json missing/stale)
app.get("/api/movies", async (_req, res) => {
  try {
    // If movies.json is missing or older than 1h, refresh
    const needsRefresh =
      !fs.existsSync(MOVIES_PATH) ||
      Date.now() - fs.statSync(MOVIES_PATH).mtimeMs > 60 * 60 * 1000;

    if (needsRefresh) {
      const { execSync } = await import("child_process");
      execSync("npx tsx scripts/scrape.ts", { cwd: ROOT, stdio: "pipe" });
    }

    const movies = loadMovies();
    const queue = loadQueue();

    const result = movies.map((m) => ({
      ...m,
      rendered: fs.existsSync(outputPath(m.id)),
      queued: queue.includes(m.id),
    }));

    res.json(result);
  } catch (e: unknown) {
    res.status(500).json({ error: String(e) });
  }
});

// List available audio tracks
app.get("/api/tracks", (_req, res) => {
  const files = fs.existsSync(TRACKS_DIR)
    ? fs.readdirSync(TRACKS_DIR).filter((f) => /\.(mp3|wav|aac|m4a|ogg)$/i.test(f))
    : [];
  res.json(files.map((f) => ({ name: f, url: `/tracks/${f}` })));
});

// Start a render job
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

  // Render async
  (async () => {
    try {
      job.status = "rendering";
      const CLIP_SEC = 30;
      const FPS = 30;

      const inputProps = {
        videoUrl: movie.loop_video_url || movie.video_url,
        title: movie.title,
        director: movie.director,
        country: movie.country,
        genres: movie.genres ?? [],
        clipStartSec: 0,
        clipDurationSec: CLIP_SEC,
        audioUrl: audioUrl ?? undefined,
      };

      const serveUrl = await getBundle();
      const composition = await selectComposition({ serveUrl, id: "Trailer", inputProps });

      const out = outputPath(movieId);
      await renderMedia({
        composition: { ...composition, durationInFrames: CLIP_SEC * FPS },
        serveUrl,
        codec: "h264",
        outputLocation: out,
        inputProps,
        onProgress: ({ progress }) => {
          job.progress = Math.round(progress * 100);
        },
      });

      job.status = "done";
      job.outputPath = out;
    } catch (e: unknown) {
      job.status = "error";
      job.error = String(e);
    }
  })();
});

// Render job status
app.get("/api/render/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json(job);
});

// Check if a movie has a rendered video
app.get("/api/rendered/:movieId", (req, res) => {
  const p = outputPath(req.params.movieId);
  res.json({ rendered: fs.existsSync(p), url: `/out/${path.basename(p)}` });
});

// Add movie to posting queue
app.post("/api/queue", (req, res) => {
  const { movieId } = req.body as { movieId: string };
  const q = loadQueue();
  if (!q.includes(movieId)) {
    q.push(movieId);
    saveQueue(q);
  }
  res.json({ ok: true, queue: q });
});

// Remove movie from queue
app.delete("/api/queue/:movieId", (req, res) => {
  const q = loadQueue().filter((id) => id !== req.params.movieId);
  saveQueue(q);
  res.json({ ok: true, queue: q });
});

// Get queue
app.get("/api/queue", (_req, res) => {
  const q = loadQueue();
  const movies = loadMovies();
  const items = q.map((id) => {
    const m = movies.find((m) => m.id === id);
    return { id, title: m?.title ?? id, rendered: fs.existsSync(outputPath(id)) };
  });
  res.json(items);
});

// Serve rendered videos
app.use("/out", express.static(OUT_DIR));

// Serve audio tracks
app.use("/tracks", express.static(TRACKS_DIR));

// Serve the web UI
app.use(express.static(path.join(ROOT, "web")));

const PORT = 3333;
app.listen(PORT, () => {
  console.log(`\n✅ CAIS ROOM dashboard running at http://localhost:${PORT}\n`);
});
