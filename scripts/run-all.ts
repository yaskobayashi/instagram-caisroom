/**
 * End-to-end pipeline: scrape → render → post
 * Picks the most recent movie not yet posted.
 * Usage: npx tsx scripts/run-all.ts
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import type { Movie } from "./scrape";
import { IgApiClient } from "instagram-private-api";
import { readFileSync } from "fs";

function loadEnv() {
  const envPath = path.resolve(".env");
  if (fs.existsSync(envPath)) {
    const lines = readFileSync(envPath, "utf-8").split("\n");
    for (const line of lines) {
      const [key, ...rest] = line.split("=");
      if (key && rest.length) process.env[key.trim()] = rest.join("=").trim();
    }
  }
}

function run(cmd: string) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

function buildCaption(movie: Movie): string {
  const genreList = (movie.genres ?? []).slice(0, 3).join(" · ");
  const aiList = (movie.ai_models ?? []).slice(0, 3).join(", ");
  return [
    `🎬 ${movie.title}`,
    ``,
    `${movie.description?.slice(0, 200)}${(movie.description?.length ?? 0) > 200 ? "..." : ""}`,
    ``,
    `📍 ${movie.director} · ${movie.country}, ${movie.release_year}`,
    genreList ? `🎭 ${genreList}` : "",
    aiList ? `🤖 Made with: ${aiList}` : "",
    ``,
    `Watch now → caisroom.com`,
    ``,
    `#caisroom #aifilm #independentcinema #aicinema #shortfilm #remotion`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function postReel(videoPath: string, caption: string) {
  const ig = new IgApiClient();
  ig.state.generateDevice(process.env.IG_USERNAME!);

  await ig.simulate.preLoginFlow();
  await ig.account.login(process.env.IG_USERNAME!, process.env.IG_PASSWORD!);
  await ig.simulate.postLoginFlow();

  const videoBuffer = fs.readFileSync(videoPath);
  await ig.publish.video({ video: videoBuffer, coverImage: videoBuffer, caption });
  console.log("Posted to Instagram!");
}

async function main() {
  loadEnv();

  // 1. Scrape
  run("npx tsx scripts/scrape.ts");

  const moviesPath = path.resolve("movies.json");
  const movies: Movie[] = JSON.parse(fs.readFileSync(moviesPath, "utf-8"));

  // 2. Find first movie without a rendered trailer
  const outDir = path.resolve("out");
  fs.mkdirSync(outDir, { recursive: true });

  const posted = fs.existsSync("posted.json")
    ? new Set<string>(JSON.parse(fs.readFileSync("posted.json", "utf-8")))
    : new Set<string>();

  const movie = movies.find((m) => !posted.has(m.id));
  if (!movie) {
    console.log("All movies have been posted. Nothing to do.");
    return;
  }

  console.log(`\nProcessing: "${movie.title}"`);

  // 3. Render
  const idx = movies.indexOf(movie);
  run(`npx tsx scripts/render.ts ${idx}`);

  const videoPath = path.join(outDir, `trailer-${movie.id}.mp4`);

  // 4. Post (only if Instagram creds are configured)
  if (process.env.IG_USERNAME && process.env.IG_PASSWORD) {
    const caption = buildCaption(movie);
    console.log("\nCaption preview:\n" + caption);
    await postReel(videoPath, caption);

    // Mark as posted
    posted.add(movie.id);
    fs.writeFileSync("posted.json", JSON.stringify([...posted], null, 2));
    console.log(`Marked "${movie.title}" as posted.`);
  } else {
    console.log(
      "\nSkipping Instagram post (no IG_USERNAME/IG_PASSWORD in .env)."
    );
    console.log(`Rendered video: ${videoPath}`);
  }
}

main().catch(console.error);
