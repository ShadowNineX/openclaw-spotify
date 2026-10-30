import { preparePlaylistTrackEdit } from "./playlist-track-edit";
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
      const { client, playlist, uris } = await preparePlaylistTrackEdit(
        params,
        config,
        context.api,
      );

      const result = await client.playlists.removeItems(playlist.id, {
        items: uris.map((uri) => ({ uri })),
        snapshot_id: params.snapshotId,
      });

      return {
        id: playlist.id,
        name: playlist.name,
        playlist,
        snapshotId: result.snapshot_id,
        removed: uris.length,
        uris,
      };
    },
  });
}
