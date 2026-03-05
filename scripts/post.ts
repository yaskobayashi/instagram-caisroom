/**
 * Posts a rendered trailer to Instagram as a Reel.
 * Usage: npx tsx scripts/post.ts <video-path> [caption]
 *
 * Requires in .env:
 *   IG_USERNAME=your_instagram_username
 *   IG_PASSWORD=your_instagram_password
 */

import { IgApiClient } from "instagram-private-api";
import fs from "fs";
import path from "path";
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

async function postReel(videoPath: string, caption: string) {
  const ig = new IgApiClient();
  ig.state.generateDevice(process.env.IG_USERNAME!);

  console.log("Logging in to Instagram...");
  await ig.simulate.preLoginFlow();
  await ig.account.login(process.env.IG_USERNAME!, process.env.IG_PASSWORD!);
  await ig.simulate.postLoginFlow();

  console.log("Uploading video...");
  const videoBuffer = fs.readFileSync(videoPath);

  await ig.publish.video({
    video: videoBuffer,
    coverImage: videoBuffer, // Remotion can generate a thumbnail; for now use first frame placeholder
    caption,
  });

  console.log("Posted successfully!");
}

async function main() {
  loadEnv();

  const videoPath = process.argv[2];
  if (!videoPath || !fs.existsSync(videoPath)) {
    console.error("Usage: npx tsx scripts/post.ts <video-path> [caption]");
    process.exit(1);
  }

  if (!process.env.IG_USERNAME || !process.env.IG_PASSWORD) {
    console.error("Missing IG_USERNAME or IG_PASSWORD in .env");
    process.exit(1);
  }

  const caption = process.argv[3] ?? "🎬 New film on CAIS ROOM — caisroom.com";
  await postReel(path.resolve(videoPath), caption);
}

main().catch(console.error);
