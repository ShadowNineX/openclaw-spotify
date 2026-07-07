import type { Album, Artist, Paging, Playlist, Track } from "@shadownine/foxify";

import {
  clampSpotifyLimit,
  clampSpotifyOffset,
  getSpotifyClient,
  resolveSpotifyMarket,
  summarizeAlbum,
  summarizeArtist,
  summarizePage,
  summarizePlaylist,
  summarizeTrack,
  type SpotifySearchType,
} from "../spotify";
import { searchSchema } from "./schemas";
import type { SpotifyTool, SpotifyToolFactory } from "./types";

export function defineSearchTool(tool: SpotifyToolFactory): SpotifyTool {
  return tool({
    name: "spotify_search",
    label: "Spotify Search",
    description:
      "Search Spotify catalog metadata for tracks, artists, albums, and playlists.",
    parameters: searchSchema,
    async execute(params, config) {
      const client = getSpotifyClient(config);
      const types = (
        params.types?.length ? params.types : ["track", "artist"]
      ) as SpotifySearchType[];
      const market = resolveSpotifyMarket(params.market, config);
      const limit = clampSpotifyLimit(params.limit, 10);
      const offset = clampSpotifyOffset(params.offset);
      const result = await client.search.items(
        params.query,
        types,
        {
          market,
          limit,
          offset,
        },
      );

      return {
        query: params.query,
        types,
        tracks:
          "tracks" in result && result.tracks
            ? summarizePage(result.tracks as Paging<Track>, summarizeTrack)
            : undefined,
        artists:
          "artists" in result && result.artists
            ? summarizePage(result.artists as Paging<Artist>, summarizeArtist)
            : undefined,
        albums:
          "albums" in result && result.albums
            ? summarizePage(result.albums as Paging<Album>, summarizeAlbum)
            : undefined,
        playlists:
          "playlists" in result && result.playlists
            ? summarizePage(
                result.playlists as Paging<Playlist>,
                summarizePlaylist,
              )
            : undefined,
      };
    },
  });
}
