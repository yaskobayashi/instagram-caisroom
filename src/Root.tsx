import { Composition } from "remotion";
import { Trailer, trailerSchema } from "./Trailer";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="Trailer"
      component={Trailer}
      durationInFrames={30 * 30} // 30s @ 30fps (overridden per render)
      fps={30}
      width={1080}
      height={1920} // 9:16
      schema={trailerSchema}
      defaultProps={{
        videoUrl:
          "https://zkusubovkutxfocuqitm.supabase.co/storage/v1/object/public/cais-room-media/loops/e662e2c7-9f62-4752-a483-86f855d9c3f6.mp4",
        title: "Little Wings",
        director: "Kyu Dong MIN",
        country: "South Korea",
        genres: ["Animation"],
        clipStartSec: 0,
        clipDurationSec: 30,
      }}
    />
  );
};
