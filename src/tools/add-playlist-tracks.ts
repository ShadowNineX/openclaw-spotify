import {
  getSpotifyUserClient,
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
      const sdk = getSpotifyUserClient(config, context.api);
      const uris = normalizeSpotifyTrackUris(params.uris);

      await sdk.playlists.addItemsToPlaylist(params.id, uris, params.position);

      return {
        id: params.id,
        added: uris.length,
        uris,
      };
    },
  });
}
