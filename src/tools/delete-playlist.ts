import { getSpotifyUserClient } from "../spotify";
import { deletePlaylistSchema } from "./schemas";
import type { SpotifyTool, SpotifyToolFactory } from "./types";

export function defineDeletePlaylistTool(
  tool: SpotifyToolFactory,
): SpotifyTool {
  return tool({
    name: "spotify_delete_playlist",
    label: "Spotify Delete Playlist",
    description:
      "Delete or remove a playlist from the authorized user's Spotify library.",
    parameters: deletePlaylistSchema,
    async execute(params, config, context) {
      const client = getSpotifyUserClient(config, context.api);

      await client.users.unfollowPlaylist(params.id);

      return {
        id: params.id,
        deleted: true,
      };
    },
  });
}
