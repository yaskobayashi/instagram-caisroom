/**
 * Renders a 9:16 mini trailer for a given movie using Remotion.
 * Usage: npx tsx scripts/render.ts [movie-index]
 * Default: picks the most recent movie not yet rendered.
 */

import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import fs from "fs";
import path from "path";
import type { Movie } from "./scrape";

const TRAILER_DURATION_SEC = 30;
const FPS = 30;

async function renderTrailer(movie: Movie, outputPath: string) {
  console.log(`Bundling Remotion...`);
  const bundled = await bundle({
    entryPoint: path.resolve("src/index.ts"),
    onProgress: (p) => process.stdout.write(`\r  Bundle: ${Math.round(p)}%`),
  });
  console.log("\n");

  const inputProps = {
    videoUrl: movie.video_url,
    videoDurationSec: (movie.duration ?? 1) * 60,
    title: movie.title,
    director: movie.director,
    country: movie.country,
    genres: movie.genres ?? [],
  };

  const composition = await selectComposition({
    serveUrl: bundled,
    id: "Trailer",
    inputProps,
  });

  const durationInFrames = TRAILER_DURATION_SEC * FPS;

  console.log(`Rendering "${movie.title}" → ${outputPath}`);
  await renderMedia({
    composition: { ...composition, durationInFrames },
    serveUrl: bundled,
    codec: "h264",
    outputLocation: outputPath,
    inputProps,
    onProgress: ({ progress }) =>
      process.stdout.write(`\r  Render: ${Math.round(progress * 100)}%`),
  });
  console.log("\nDone!");
}

async function main() {
  const moviesPath = path.resolve("movies.json");
  if (!fs.existsSync(moviesPath)) {
    console.error("movies.json not found. Run: npm run scrape");
    process.exit(1);
  }

  const movies: Movie[] = JSON.parse(fs.readFileSync(moviesPath, "utf-8"));

  // Pick movie by CLI arg index, or default to first
  const idx = process.argv[2] ? parseInt(process.argv[2]) : 0;
  const movie = movies[idx];
  if (!movie) {
    console.error(`No movie at index ${idx}. Total: ${movies.length}`);
    process.exit(1);
  }

  console.log(`Selected: "${movie.title}" (${movie.director})`);

  const outDir = path.resolve("out");
  fs.mkdirSync(outDir, { recursive: true });
  const outputPath = path.join(outDir, `trailer-${movie.id}.mp4`);

  // Skip if already rendered
  if (fs.existsSync(outputPath)) {
    console.log(`Already exists: ${outputPath}`);
    process.exit(0);
  }

  await renderTrailer(movie, outputPath);
  console.log(`\nTrailer saved: ${outputPath}`);
}

main().catch(console.error);
