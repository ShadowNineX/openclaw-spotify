import { getSpotifyUserClient } from "../spotify";
import { preparePlaylistCoverImage } from "../playlist-cover-image";
import { uploadPlaylistCoverSchema } from "./schemas";
import type { SpotifyTool, SpotifyToolFactory } from "./types";

export function defineUploadPlaylistCoverTool(
  tool: SpotifyToolFactory,
): SpotifyTool {
  return tool({
    name: "spotify_upload_playlist_cover",
    label: "Spotify Upload Playlist Cover",
    description:
      "Upload a custom cover image for one of the authorized user's editable playlists. Images are converted to Spotify's JPEG cover format by default.",
    parameters: uploadPlaylistCoverSchema,
    async execute(params, config, context) {
      const preparedImage = await preparePlaylistCoverImage(params);
      const client = getSpotifyUserClient(config, context.api);

      await client.playlists.uploadCustomCoverImage(
        params.id,
        preparedImage.jpegBase64,
      );

      return {
        id: params.id,
        uploaded: true,
        image: {
          byteLength: preparedImage.byteLength,
          processed: preparedImage.processed,
          source: preparedImage.source,
        },
        note:
          "Spotify may take a little time to refresh playlist cover artwork across clients.",
      };
    },
  });
}
