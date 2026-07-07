import {
  clampSpotifyLimit,
  clampSpotifyOffset,
  getSpotifyClient,
  resolveSpotifyMarket,
  summarizeAlbum,
  summarizePage,
  summarizeTrack,
} from "../spotify";
import { albumSchema } from "./schemas";
import type { SpotifyTool, SpotifyToolFactory } from "./types";

export function defineAlbumTool(tool: SpotifyToolFactory): SpotifyTool {
  return tool({
    name: "spotify_get_album",
    label: "Spotify Album",
    description:
      "Get Spotify catalog metadata for an album by Spotify album ID.",
    parameters: albumSchema,
    async execute(params, config) {
      const sdk = getSpotifyClient(config);
      const market = resolveSpotifyMarket(params.market, config);
      const album = await sdk.albums.get(params.id, market);
      const includeTracks = params.includeTracks !== false;
      const tracks = includeTracks
        ? await sdk.albums.tracks(
            params.id,
            market,
            clampSpotifyLimit(params.limit, 20),
            clampSpotifyOffset(params.offset),
          )
        : undefined;

      return {
        album: summarizeAlbum(album),
        tracks: tracks ? summarizePage(tracks, summarizeTrack) : undefined,
      };
    },
  });
}
