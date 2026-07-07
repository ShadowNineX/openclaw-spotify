import { getSpotifyUserClient } from "../spotify";
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
      const sdk = getSpotifyUserClient(config, context.api);
      const result = await sdk.playlists.updatePlaylistItems(params.id, {
        range_start: params.rangeStart,
        insert_before: params.insertBefore,
        range_length: params.rangeLength ?? 1,
        snapshot_id: params.snapshotId,
      });

      return {
        id: params.id,
        snapshotId: result.snapshot_id,
      };
    },
  });
}
