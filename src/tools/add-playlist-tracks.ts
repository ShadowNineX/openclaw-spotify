import {
  getSpotifyUserClient,
  getSpotifyPlaylistReference,
  normalizeSpotifyTrackUris,
} from "../spotify";
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
      const client = getSpotifyUserClient(config, context.api);
      const playlist = await getSpotifyPlaylistReference(client, params.id);
      const uris = normalizeSpotifyTrackUris(params.uris);

      await client.playlists.addItems(playlist.id, uris, {
        position: params.position,
      });

      return {
        id: playlist.id,
        name: playlist.name,
        playlist,
        added: uris.length,
        uris,
      };
    },
  });
}
