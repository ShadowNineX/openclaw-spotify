import { getSpotifyPlaylistReference, getSpotifyUserClient } from "../spotify";
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
      const playlist = await getSpotifyPlaylistReference(client, params.id);

      await client.users.unfollowPlaylist(playlist.id);

      return {
        id: playlist.id,
        name: playlist.name,
        playlist,
        deleted: true,
      };
    },
  });
}
