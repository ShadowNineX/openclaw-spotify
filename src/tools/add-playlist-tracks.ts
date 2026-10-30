import { preparePlaylistTrackEdit } from "./playlist-track-edit";
import { playlistTracksEditSchema } from "./schemas";
import type { SpotifyTool, SpotifyToolFactory } from "./types";

export function defineAddPlaylistTracksTool(
  tool: SpotifyToolFactory,
): SpotifyTool {
  return tool({
    name: "spotify_add_playlist_tracks",
    label: "Spotify Add Playlist Tracks",
    description: "Add tracks to one of the authorized user's editable playlists.",
    parameters: playlistTracksEditSchema,
    async execute(params, config, context) {
      const { client, playlist, uris } = await preparePlaylistTrackEdit(
        params,
        config,
        context.api,
      );

      const result = await client.playlists.addItems(playlist.id, uris, {
        position: params.position,
      });

      return {
        id: playlist.id,
        name: playlist.name,
        playlist,
        snapshotId: result.snapshot_id,
        added: uris.length,
        uris,
      };
    },
  });
}
