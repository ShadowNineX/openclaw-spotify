import {
  clampSpotifyLimit,
  clampSpotifyOffset,
  getSpotifyClient,
  resolveSpotifyMarket,
  summarizePage,
  summarizePlaylist,
  summarizePlaylistTrack,
} from "../spotify";
import { playlistSchema } from "./schemas";
import type { SpotifyTool, SpotifyToolFactory } from "./types";

export function definePlaylistTool(tool: SpotifyToolFactory): SpotifyTool {
  return tool({
    name: "spotify_get_playlist",
    label: "Spotify Playlist",
    description:
      "Get Spotify catalog metadata and tracks for a public playlist by Spotify playlist ID.",
    parameters: playlistSchema,
    async execute(params, config) {
      const sdk = getSpotifyClient(config);
      const market = resolveSpotifyMarket(params.market, config);
      const playlist = await sdk.playlists.getPlaylist(params.id, market);
      const tracks = await sdk.playlists.getPlaylistItems(
        params.id,
        market,
        undefined,
        clampSpotifyLimit(params.limit, 20),
        clampSpotifyOffset(params.offset),
      );

      return {
        playlist: summarizePlaylist(playlist),
        tracks: summarizePage(tracks, summarizePlaylistTrack),
      };
    },
  });
}
