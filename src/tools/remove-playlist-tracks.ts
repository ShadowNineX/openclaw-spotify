import {
  getSpotifyUserClient,
  normalizeSpotifyTrackUris,
} from "../spotify";
import { playlistTracksEditSchema } from "./schemas";
import type { SpotifyTool, SpotifyToolFactory } from "./types";

export function defineRemovePlaylistTracksTool(
  tool: SpotifyToolFactory,
): SpotifyTool {
  return tool({
    name: "spotify_remove_playlist_tracks",
    label: "Spotify Remove Playlist Tracks",
    description:
      "Remove tracks from one of the authorized user's editable playlists.",
    parameters: playlistTracksEditSchema,
    async execute(params, config, context) {
      const client = getSpotifyUserClient(config, context.api);
      const uris = normalizeSpotifyTrackUris(params.uris);

      await client.playlists.removeItems(params.id, {
        tracks: uris.map((uri) => ({ uri })),
        snapshot_id: params.snapshotId,
      });

      return {
        id: params.id,
        removed: uris.length,
        uris,
      };
    },
  });
}
