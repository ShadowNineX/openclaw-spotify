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
      const client = getSpotifyUserClient(config, context.api);
      const collaborative = params.collaborative === true;
      const isPublic = collaborative ? false : params.public === true;
      const playlist = await client.playlists.create({
        name: params.name,
        description: params.description,
        public: isPublic,
        collaborative,
      });

      return summarizePlaylist(playlist);
    },
  });
}
