import { getSpotifyUserClient } from "../spotify";
import { updatePlaylistSchema } from "./schemas";
import type { SpotifyTool, SpotifyToolFactory } from "./types";

export function defineUpdatePlaylistTool(tool: SpotifyToolFactory): SpotifyTool {
  return tool({
    name: "spotify_update_playlist",
    label: "Spotify Update Playlist",
    description: "Update playlist name, description, visibility, or collaboration.",
    parameters: updatePlaylistSchema,
    async execute(params, config, context) {
      const sdk = getSpotifyUserClient(config, context.api);

      await sdk.playlists.changePlaylistDetails(params.id, {
        name: params.name,
        description: params.description,
        public: params.public,
        collaborative: params.collaborative,
      });

      return {
        id: params.id,
        updated: true,
      };
    },
  });
}
