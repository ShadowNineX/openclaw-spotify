import { getSpotifyUserClient, summarizePlaylist } from "../spotify";
import { createPlaylistSchema } from "./schemas";
import type { SpotifyTool, SpotifyToolFactory } from "./types";

export function defineCreatePlaylistTool(tool: SpotifyToolFactory): SpotifyTool {
  return tool({
    name: "spotify_create_playlist",
    label: "Spotify Create Playlist",
    description: "Create a playlist for the authorized Spotify user.",
    parameters: createPlaylistSchema,
    async execute(params, config, context) {
      const sdk = getSpotifyUserClient(config, context.api);
      const profile = await sdk.currentUser.profile();
      const playlist = await sdk.playlists.createPlaylist(profile.id, {
        name: params.name,
        description: params.description,
        public: params.public ?? false,
        collaborative: params.collaborative ?? false,
      });

      return summarizePlaylist(playlist);
    },
  });
}
