import {
  clampSpotifyLimit,
  clampSpotifyOffset,
  getSpotifyUserClient,
  normalizeSpotifyPlaylistId,
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
      "Get a Spotify playlist and one page of tracks. Use nextOffset when hasMore is true to read the next page; each track has its absolute zero-based playlist position.",
    parameters: playlistSchema,
    async execute(params, config, context) {
      const client = await getSpotifyUserClient(config, context.api);
      const id = normalizeSpotifyPlaylistId(params.id);
      const market = resolveSpotifyMarket(params.market, config);
      const playlist = await client.playlists.get(id, { market });
      const tracks = await client.playlists.getItems(id, {
        market,
        limit: clampSpotifyLimit(params.limit, 20),
        offset: clampSpotifyOffset(params.offset),
      });

      const trackPage = summarizePage(tracks, summarizePlaylistTrack);

      return {
        playlist: summarizePlaylist(playlist),
        tracks: {
          ...trackPage,
          items: trackPage.items.map((item, index) => ({
            position: tracks.offset + index,
            ...item,
          })),
        },
      };
    },
  });
}
