import { getSpotifyPlaylistReference, getSpotifyUserClient } from "../spotify";
import { reorderPlaylistTracksSchema } from "./schemas";
import type { SpotifyTool, SpotifyToolFactory } from "./types";

export function defineReorderPlaylistTracksTool(
  tool: SpotifyToolFactory,
): SpotifyTool {
  return tool({
    name: "spotify_reorder_playlist_tracks",
    label: "Spotify Reorder Playlist Tracks",
    description:
      "Move a range of tracks within one of the authorized user's editable playlists.",
    parameters: reorderPlaylistTracksSchema,
    async execute(params, config, context) {
      const client = getSpotifyUserClient(config, context.api);
      const playlist = await getSpotifyPlaylistReference(client, params.id);
      const result = await client.playlists.updateItems(playlist.id, {
        range_start: params.rangeStart,
        insert_before: params.insertBefore,
        range_length: params.rangeLength ?? 1,
        snapshot_id: params.snapshotId,
      });

      return {
        id: playlist.id,
        name: playlist.name,
        playlist,
        snapshotId: result.snapshot_id,
      };
    },
  });
}
