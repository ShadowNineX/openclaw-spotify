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
      const sdk = getSpotifyUserClient(config, context.api);

      await sdk.makeRequest(
        "DELETE",
        `playlists/${encodeURIComponent(params.id)}/followers`,
      );

      return {
        id: params.id,
        deleted: true,
      };
    },
  });
}
