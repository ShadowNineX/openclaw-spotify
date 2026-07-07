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
      const client = getSpotifyClient(config);
      const market = resolveSpotifyMarket(params.market, config);
      const album = await client.albums.get(params.id, { market });
      const includeTracks = params.includeTracks !== false;
      const tracks = includeTracks
        ? await client.albums.getTracks(params.id, {
            market,
            limit: clampSpotifyLimit(params.limit, 20),
            offset: clampSpotifyOffset(params.offset),
          })
        : undefined;

      return {
        album: summarizeAlbum(album),
        tracks: tracks ? summarizePage(tracks, summarizeTrack) : undefined,
      };
    },
  });
}
