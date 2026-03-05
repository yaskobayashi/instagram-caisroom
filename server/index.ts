import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import type { Movie } from "../scripts/scrape";

// Use bundled FFmpeg binary
if (ffmpegStatic) ffmpeg.setFfmpegPath(ffmpegStatic);

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

// ─── Basic auth ───────────────────────────────────────────────────────────
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD;
if (DASHBOARD_PASSWORD) {
  app.use((req, res, next) => {
    // Static assets accessed internally by Remotion renderer — skip auth
    if (req.path.startsWith("/cache/") || req.path.startsWith("/out/") || req.path.startsWith("/tracks/")) {
      return next();
    }
    const auth = req.headers.authorization ?? "";
    const [scheme, encoded] = auth.split(" ");
    if (scheme === "Basic" && encoded) {
      const [, pass] = Buffer.from(encoded, "base64").toString().split(":");
      if (pass === DASHBOARD_PASSWORD) return next();
    }
    res.setHeader("WWW-Authenticate", 'Basic realm="CAIS ROOM"');
    res.status(401).send("Authentication required");
  });
}

const PORT = Number(process.env.PORT) || 3333;
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "out");
const TRACKS_DIR = path.join(ROOT, "tracks");
const CACHE_DIR = path.join(ROOT, "cache");
const MOVIES_PATH = path.join(ROOT, "movies.json");
const QUEUE_PATH = path.join(ROOT, "queue.json");
const POSTS_PATH = path.join(ROOT, "posts.json");

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(TRACKS_DIR, { recursive: true });
fs.mkdirSync(CACHE_DIR, { recursive: true });

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
let cachedBundleMtime = 0;

function srcMtime(): number {
  const srcDir = path.join(ROOT, "src");
  return fs.readdirSync(srcDir).reduce((max, f) => {
    try { return Math.max(max, fs.statSync(path.join(srcDir, f)).mtimeMs); }
    catch { return max; }
  }, 0);
}

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

/** Downloads a remote video, strips its audio track, returns local file path. */
async function stripAudio(remoteUrl: string, movieId: string): Promise<string> {
  const rawPath = path.join(CACHE_DIR, `${movieId}-raw.mp4`);
  const strippedPath = path.join(CACHE_DIR, `${movieId}-noaudio.mp4`);

  if (fs.existsSync(strippedPath)) return strippedPath;

  // Download if not already cached
  if (!fs.existsSync(rawPath)) {
    const r = await fetch(remoteUrl);
    if (!r.ok) throw new Error(`Failed to download video: ${r.status}`);
    const buf = await r.arrayBuffer();
    fs.writeFileSync(rawPath, Buffer.from(buf));
  }

  // Strip audio via FFmpeg
  await new Promise<void>((resolve, reject) => {
    ffmpeg(rawPath)
      .noAudio()
      .videoCodec("copy")
      .output(strippedPath)
      .on("end", () => resolve())
      .on("error", (err) => reject(err))
      .run();
  });

  return strippedPath;
}

async function getBundle(): Promise<string> {
  const mtime = srcMtime();
  if (cachedBundle && mtime <= cachedBundleMtime) return cachedBundle;
  cachedBundle = await bundle({ entryPoint: path.join(ROOT, "src/index.ts") });
  cachedBundleMtime = mtime;
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

      // Use loop video (short clip) instead of full film to avoid OOM.
      // Strip audio and serve locally so Remotion doesn't stream a large remote file.
      const loopSource = movie.loop_video_url || movie.video_url;
      const localVideoPath = await stripAudio(loopSource, movie.id);
      const localVideoUrl = `http://localhost:${PORT}/cache/${path.basename(localVideoPath)}`;

      // Probe actual loop duration so clip offsets don't seek past the end
      const loopDurationSec = await new Promise<number>((resolve) => {
        ffmpeg.ffprobe(localVideoPath, (err, meta) => resolve(err ? 30 : (meta.format.duration ?? 30)));
      });

      // Ensure audioUrl is absolute — Remotion cannot resolve relative URLs
      const absoluteAudioUrl = audioUrl
        ? audioUrl.startsWith("/") ? `http://localhost:${PORT}${audioUrl}` : audioUrl
        : undefined;

      const inputProps = {
        videoUrl: localVideoUrl,
        videoDurationSec: loopDurationSec,
        title: movie.title,
        director: movie.director,
        country: movie.country,
        genres: movie.genres ?? [],
        audioUrl: absoluteAudioUrl,
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
        concurrency: 1,
        onProgress: ({ progress }) => { job.progress = Math.round(progress * 100); },
      });

      job.status = "done";
      job.outputPath = out;
    } catch (e: unknown) {
      job.status = "error";
      job.error = e instanceof Error
        ? `${e.message}\n${e.stack ?? ""}`
        : JSON.stringify(e) || String(e) || "Unknown error";
      console.error("[Render error]", e);
    }
  })();
});

app.get("/api/render/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json(job);
});

app.get("/api/render/all/debug", (_req, res) => {
  res.json([...jobs.values()]);
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

// ─── Scheduled Posts ──────────────────────────────────────────────────────

type PostStatus = "scheduled" | "posting" | "posted" | "failed";

interface ScheduledPost {
  id: string;
  movieId: string;
  movieTitle: string;
  videoFilePath: string;
  finalCaption: string;
  scheduledDatetime: string | null; // ISO UTC; null = post now
  status: PostStatus;
  createdAt: string;
  postedAt: string | null;
  error: string | null;
}

function loadPosts(): ScheduledPost[] {
  if (!fs.existsSync(POSTS_PATH)) return [];
  try { return JSON.parse(fs.readFileSync(POSTS_PATH, "utf-8")); } catch { return []; }
}

function savePosts(posts: ScheduledPost[]) {
  fs.writeFileSync(POSTS_PATH, JSON.stringify(posts, null, 2));
}

async function extractThumbnail(videoPath: string): Promise<string> {
  const thumbPath = videoPath.replace(/\.mp4$/i, "-thumb.jpg");
  if (fs.existsSync(thumbPath)) return thumbPath;
  await new Promise<void>((resolve, reject) => {
    ffmpeg(videoPath)
      .outputOptions(["-vframes", "1", "-q:v", "2"])
      .output(thumbPath)
      .on("end", () => resolve())
      .on("error", reject)
      .run();
  });
  return thumbPath;
}

async function publishToInstagram(post: ScheduledPost): Promise<void> {
  const username = process.env.IG_USERNAME;
  const password = process.env.IG_PASSWORD;
  if (!username || !password || username === "seu_usuario_instagram") {
    throw new Error("Instagram credentials not configured in .env (IG_USERNAME / IG_PASSWORD)");
  }

  const { IgApiClient } = await import("instagram-private-api");
  const ig = new IgApiClient();
  ig.state.generateDevice(username);
  await ig.simulate.preLoginFlow();
  await ig.account.login(username, password);
  await ig.simulate.postLoginFlow();

  const thumbPath = await extractThumbnail(post.videoFilePath);

  await ig.publish.video({
    video: fs.readFileSync(post.videoFilePath),
    coverImage: fs.readFileSync(thumbPath),
    caption: post.finalCaption,
  });
}

// Idempotency: track which posts are currently being processed
const activePublishing = new Set<string>();

async function processPost(postId: string): Promise<void> {
  if (activePublishing.has(postId)) return;
  activePublishing.add(postId);
  try {
    // Mark as posting
    const snap1 = loadPosts();
    const idx1 = snap1.findIndex(p => p.id === postId);
    if (idx1 === -1) return;
    if (snap1[idx1].status !== "scheduled" && snap1[idx1].status !== "posting") return;
    snap1[idx1].status = "posting";
    savePosts(snap1);

    await publishToInstagram(snap1[idx1]);

    const snap2 = loadPosts();
    const idx2 = snap2.findIndex(p => p.id === postId);
    if (idx2 !== -1) { snap2[idx2].status = "posted"; snap2[idx2].postedAt = new Date().toISOString(); savePosts(snap2); }
  } catch (e: unknown) {
    const snap = loadPosts();
    const idx = snap.findIndex(p => p.id === postId);
    if (idx !== -1) { snap[idx].status = "failed"; snap[idx].error = String(e); savePosts(snap); }
  } finally {
    activePublishing.delete(postId);
  }
}

// Check every 30 s for due scheduled posts
setInterval(() => {
  const now = new Date();
  for (const post of loadPosts()) {
    if (post.status === "scheduled" && post.scheduledDatetime && new Date(post.scheduledDatetime) <= now) {
      processPost(post.id);
    }
  }
}, 30_000);

// POST  /api/posts  — create a post (now or scheduled)
app.post("/api/posts", (req, res) => {
  const { movieId, finalCaption, scheduledDatetime } = req.body as {
    movieId: string;
    finalCaption: string;
    scheduledDatetime?: string | null;
  };

  if (!finalCaption?.trim()) return res.status(400).json({ error: "Caption is required" });
  if (finalCaption.length > 2200) return res.status(400).json({ error: "Caption exceeds 2200 characters" });

  const videoFilePath = outputPath(movieId);
  if (!fs.existsSync(videoFilePath)) return res.status(400).json({ error: "Rendered video not found — render the trailer first" });

  if (scheduledDatetime && new Date(scheduledDatetime) <= new Date()) {
    return res.status(400).json({ error: "Scheduled time must be in the future" });
  }

  const movies = loadMovies();
  const movie = movies.find(m => m.id === movieId);
  const isNow = !scheduledDatetime;

  const post: ScheduledPost = {
    id: `${movieId}-${Date.now()}`,
    movieId,
    movieTitle: movie?.title ?? movieId,
    videoFilePath,
    finalCaption,
    scheduledDatetime: scheduledDatetime ?? null,
    status: isNow ? "posting" : "scheduled",
    createdAt: new Date().toISOString(),
    postedAt: null,
    error: null,
  };

  const posts = loadPosts();
  posts.unshift(post);
  savePosts(posts);
  res.json({ ok: true, post });

  if (isNow) processPost(post.id);
});

// GET  /api/posts  — list all posts
app.get("/api/posts", (_req, res) => res.json(loadPosts()));

// GET  /api/posts/movie/:movieId  — posts for one film
app.get("/api/posts/movie/:movieId", (req, res) =>
  res.json(loadPosts().filter(p => p.movieId === req.params.movieId))
);

// DELETE  /api/posts/:id  — cancel a scheduled post
app.delete("/api/posts/:id", (req, res) => {
  const posts = loadPosts();
  const idx = posts.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Post not found" });
  if (posts[idx].status === "posting") return res.status(400).json({ error: "Cannot cancel a post in progress" });
  posts.splice(idx, 1);
  savePosts(posts);
  res.json({ ok: true });
});

// ─── Static ───────────────────────────────────────────────────────────────

app.use("/out", express.static(OUT_DIR));
app.use("/tracks", express.static(TRACKS_DIR));
app.use("/cache", express.static(CACHE_DIR));
app.use(express.static(path.join(ROOT, "web")));

app.listen(PORT, () => {
  const hasJamendo = !!process.env.JAMENDO_CLIENT_ID;
  console.log(`\n✅  CAIS ROOM dashboard → http://localhost:${PORT}`);
  console.log(`🎵  Jamendo: ${hasJamendo ? "configured ✓" : "not configured (add JAMENDO_CLIENT_ID to .env)"}\n`);
});
