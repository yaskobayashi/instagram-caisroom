import { Composition } from "remotion";
import { Trailer, trailerSchema } from "./Trailer";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="Trailer"
      component={Trailer}
      durationInFrames={30 * 30} // 30s @ 30fps
      fps={30}
      width={1080}
      height={1920} // 9:16
      schema={trailerSchema}
      defaultProps={{
        videoUrl:
          "https://zkusubovkutxfocuqitm.supabase.co/storage/v1/object/public/cais-room-media/videos/1763038639823-53dgm2.mp4",
        videoDurationSec: 360, // 6 min
        title: "Little Wings",
        director: "Kyu Dong MIN",
        country: "South Korea",
        genres: ["Animation"],
      }}
    />
  );
};
