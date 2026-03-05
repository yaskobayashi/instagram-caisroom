/**
 * Fetches movies from caisroom.com Supabase and saves to movies.json
 */

import fs from "fs";
import path from "path";

const SUPABASE_URL = "https://zkusubovkutxfocuqitm.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_a3rLw0GTeP-coNcwbsazXg_sr6KJdf8";

export interface Movie {
  id: string;
  title: string;
  description: string;
  poster_url: string;
  loop_video_url: string;
  video_url: string;
  duration: number; // minutes
  release_year: number;
  genres: string[];
  director: string;
  country: string;
  ai_models: string[];
  featured: boolean;
  winner_position: number | null;
  view_count: number;
  created_at: string;
}

async function fetchMovies(): Promise<Movie[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/movies?select=id,title,description,poster_url,loop_video_url,video_url,duration,release_year,genres,director,country,ai_models,featured,winner_position,view_count,created_at&order=created_at.desc`,
    {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    }
  );

  if (!res.ok) throw new Error(`Supabase error: ${res.status} ${await res.text()}`);
  return res.json();
}

async function main() {
  console.log("Fetching movies from caisroom.com...");
  const movies = await fetchMovies();
  console.log(`Found ${movies.length} movies.`);

  const outPath = path.resolve("movies.json");
  fs.writeFileSync(outPath, JSON.stringify(movies, null, 2));
  console.log(`Saved to ${outPath}`);

  // Print summary
  for (const m of movies.slice(0, 5)) {
    console.log(`  - ${m.title} (${m.director}, ${m.country})`);
  }
  if (movies.length > 5) console.log(`  ... and ${movies.length - 5} more`);
}

main().catch(console.error);
