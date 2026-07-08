import {
  clampSpotifyLimit,
  clampSpotifyOffset,
  getSpotifyUserClient,
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
    async execute(params, config, context) {
      const client = getSpotifyUserClient(config, context.api);
      const market = resolveSpotifyMarket(params.market, config);
      const playlist = await client.playlists.get(params.id, { market });
      const tracks = await client.playlists.getItems(params.id, {
        market,
        limit: clampSpotifyLimit(params.limit, 20),
        offset: clampSpotifyOffset(params.offset),
      });

      return {
        playlist: summarizePlaylist(playlist),
        tracks: summarizePage(tracks, summarizePlaylistTrack),
      };
    },
  });
}
