import {
  AbsoluteFill,
  Audio,
  interpolate,
  OffthreadVideo,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { z } from "zod";

export const trailerSchema = z.object({
  videoUrl: z.string(),
  title: z.string(),
  director: z.string(),
  country: z.string(),
  genres: z.array(z.string()),
  clipStartSec: z.number(),
  clipDurationSec: z.number(),
  audioUrl: z.string().optional(),
});

type Props = z.infer<typeof trailerSchema>;

export const Trailer: React.FC<Props> = ({
  videoUrl,
  title,
  director,
  country,
  genres,
  audioUrl,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const fadeIn = interpolate(frame, [0, fps * 0.5], [0, 1], {
    extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(
    frame,
    [durationInFrames - fps, durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const opacity = Math.min(fadeIn, fadeOut);

  const titleSpring = spring({ fps, frame: frame - fps * 0.3, config: { damping: 15 } });
  const subtitleSpring = spring({ fps, frame: frame - fps * 0.6, config: { damping: 15 } });
  const logoSpring = spring({ fps, frame: frame - fps * 0.1, config: { damping: 12 } });

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {audioUrl && (
        <Audio
          src={audioUrl}
          volume={interpolate(
            frame,
            [0, 15, durationInFrames - fps * 2, durationInFrames],
            [0, 1, 1, 0],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
          )}
        />
      )}

      <AbsoluteFill style={{ opacity }}>
        <OffthreadVideo
          src={videoUrl}
          loop
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </AbsoluteFill>

      <AbsoluteFill
        style={{
          background:
            "linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.3) 40%, transparent 70%)",
        }}
      />

      {/* Top logo */}
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
            fontSize: 42,
            letterSpacing: 12,
            color: "#C9BFA8",
            textTransform: "uppercase",
          }}
        >
          CAIS ROOM
        </span>
      </div>

      {/* Bottom text */}
      <div style={{ position: "absolute", bottom: 120, left: 60, right: 60 }}>
        <div
          style={{
            display: "flex",
            gap: 12,
            marginBottom: 20,
            opacity: subtitleSpring,
            transform: `translateY(${interpolate(subtitleSpring, [0, 1], [20, 0])}px)`,
          }}
        >
          {genres.slice(0, 3).map((g) => (
            <span
              key={g}
              style={{
                fontFamily: "sans-serif",
                fontSize: 22,
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
            fontSize: 72,
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
            fontSize: 28,
            color: "rgba(255,255,255,0.7)",
            marginTop: 16,
            opacity: subtitleSpring,
            transform: `translateY(${interpolate(subtitleSpring, [0, 1], [20, 0])}px)`,
          }}
        >
          {director} · {country}
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          bottom: 60,
          left: 60,
          fontFamily: "sans-serif",
          fontSize: 22,
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
