import {
  getSpotifyClient,
  normalizeSpotifyCatalogId,
  resolveSpotifyMarket,
  summarizeArtist,
  summarizeTrack,
} from "../spotify";
import { artistSchema } from "./schemas";
import type { SpotifyTool, SpotifyToolFactory } from "./types";

export function defineArtistTool(tool: SpotifyToolFactory): SpotifyTool {
  return tool({
    name: "spotify_get_artist",
    label: "Spotify Artist",
    description:
      "Get Spotify catalog metadata for an artist by ID, URI, or Spotify URL.",
    parameters: artistSchema,
    async execute(params, config) {
      const id = normalizeSpotifyCatalogId(params.id, "artist");
      const client = getSpotifyClient(config);
      const artist = await client.artists.get(id);
      const includeTopTracks = params.includeTopTracks !== false;
      const topTracks = includeTopTracks
        ? await client.artists.getTopTracks(id, {
            market: resolveSpotifyMarket(params.market, config) ?? "US",
          })
        : undefined;

      return {
        artist: summarizeArtist(artist),
        topTracks: topTracks?.tracks.map(summarizeTrack),
      };
    },
  });
}
