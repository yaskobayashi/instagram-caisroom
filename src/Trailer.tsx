import {
  AbsoluteFill,
  interpolate,
  OffthreadVideo,
  Sequence,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { z } from "zod";

export const trailerSchema = z.object({
  videoUrl: z.string(),
  videoDurationSec: z.number(),
  title: z.string(),
  director: z.string(),
  country: z.string(),
  genres: z.array(z.string()),
  audioUrl: z.string().optional(),
});

type Props = z.infer<typeof trailerSchema>;

const CLIP_COUNT = 5;
const CLIP_SEC = 6;

export const Trailer: React.FC<Props> = ({
  videoUrl,
  videoDurationSec,
  title,
  director,
  country,
  genres,
  audioUrl,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const clipFrames = fps * CLIP_SEC;

  // Spread clips across the video: 5% → 90% to avoid black frames at edges
  const clipStartFrames = Array.from({ length: CLIP_COUNT }, (_, i) => {
    const progress = 0.05 + (i / (CLIP_COUNT - 1)) * 0.85;
    return Math.floor(progress * videoDurationSec * fps);
  });

  // Fade in/out envelope for the whole composition
  const fadeIn = interpolate(frame, [0, 8], [0, 1], { extrapolateRight: "clamp" });
  const fadeOut = interpolate(frame, [durationInFrames - 10, durationInFrames], [1, 0], {
    extrapolateLeft: "clamp",
  });
  const opacity = Math.min(fadeIn, fadeOut);

  // Flash cut: brief white flash on each clip boundary
  const flashAtCuts = Array.from({ length: CLIP_COUNT - 1 }, (_, i) => {
    const cutFrame = (i + 1) * clipFrames;
    return interpolate(frame, [cutFrame - 3, cutFrame, cutFrame + 3], [0, 0.6, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
  });
  const flash = Math.max(0, ...flashAtCuts);

  // Text animations — appear in the last clip
  const textStart = (CLIP_COUNT - 1) * clipFrames;
  const titleSpring = spring({ fps, frame: frame - textStart - fps * 0.5, config: { damping: 14 } });
  const subtitleSpring = spring({ fps, frame: frame - textStart - fps * 0.8, config: { damping: 14 } });
  const logoSpring = spring({ fps, frame: frame - fps * 0.1, config: { damping: 12 } });

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {/* Video clips */}
      <AbsoluteFill style={{ opacity }}>
        {clipStartFrames.map((startFrom, i) => (
          <Sequence key={i} from={i * clipFrames} durationInFrames={clipFrames}>
            <OffthreadVideo
              src={videoUrl}
              startFrom={startFrom}
              volume={0}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          </Sequence>
        ))}
      </AbsoluteFill>

      {/* Flash on cuts */}
      {flash > 0 && (
        <AbsoluteFill style={{ backgroundColor: `rgba(255,255,255,${flash})` }} />
      )}

      {/* Gradient overlay */}
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.15) 40%, rgba(0,0,0,0.3) 100%)",
        }}
      />

      {/* CAIS ROOM logo — always visible */}
      <div
        style={{
          position: "absolute",
          top: 80,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
          opacity: logoSpring,
          transform: `translateY(${interpolate(logoSpring, [0, 1], [-20, 0])}px)`,
        }}
      >
        <span
          style={{
            fontFamily: "sans-serif",
            fontWeight: 800,
            fontSize: 38,
            letterSpacing: 12,
            color: "#C9BFA8",
            textTransform: "uppercase",
          }}
        >
          CAIS ROOM
        </span>
      </div>

      {/* Title + director — appear on last clip */}
      <div style={{ position: "absolute", bottom: 120, left: 60, right: 60 }}>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 10,
            marginBottom: 18,
            opacity: subtitleSpring,
            transform: `translateY(${interpolate(subtitleSpring, [0, 1], [20, 0])}px)`,
          }}
        >
          {genres.slice(0, 3).map((g) => (
            <span
              key={g}
              style={{
                fontFamily: "sans-serif",
                fontSize: 20,
                letterSpacing: 3,
                color: "#C9BFA8",
                textTransform: "uppercase",
                border: "1px solid rgba(201,191,168,0.5)",
                padding: "4px 14px",
                borderRadius: 20,
              }}
            >
              {g}
            </span>
          ))}
        </div>

        <div
          style={{
            fontFamily: "sans-serif",
            fontWeight: 800,
            fontSize: 68,
            lineHeight: 1.1,
            color: "#FFFFFF",
            textTransform: "uppercase",
            letterSpacing: 2,
            opacity: titleSpring,
            transform: `translateY(${interpolate(titleSpring, [0, 1], [30, 0])}px)`,
          }}
        >
          {title}
        </div>

        <div
          style={{
            fontFamily: "sans-serif",
            fontSize: 26,
            color: "rgba(255,255,255,0.65)",
            marginTop: 14,
            opacity: subtitleSpring,
            transform: `translateY(${interpolate(subtitleSpring, [0, 1], [20, 0])}px)`,
          }}
        >
          {director} · {country}
        </div>
      </div>

      {/* caisroom.com */}
      <div
        style={{
          position: "absolute",
          bottom: 60,
          left: 60,
          fontFamily: "sans-serif",
          fontSize: 20,
          letterSpacing: 4,
          color: "#C9BFA8",
          textTransform: "uppercase",
          opacity: subtitleSpring * 0.7,
        }}
      >
        caisroom.com
      </div>
    </AbsoluteFill>
  );
};
