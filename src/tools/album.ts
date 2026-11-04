import {
  clampSpotifyLimit,
  clampSpotifyOffset,
  getSpotifyClient,
  normalizeSpotifyCatalogId,
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
      "Get Spotify catalog metadata for an album by ID, URI, or Spotify URL.",
    parameters: albumSchema,
    async execute(params, config) {
      const id = normalizeSpotifyCatalogId(params.id, "album");
      const client = getSpotifyClient(config);
      const market = resolveSpotifyMarket(params.market, config);
      const album = await client.albums.get(id, { market });
      const includeTracks = params.includeTracks !== false;
      const tracks = includeTracks
        ? await client.albums.getTracks(id, {
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
