import {
  getSpotifyClient,
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
      "Get Spotify catalog metadata for an artist by Spotify artist ID.",
    parameters: artistSchema,
    async execute(params, config) {
      const sdk = getSpotifyClient(config);
      const artist = await sdk.artists.get(params.id);
      const includeTopTracks = params.includeTopTracks !== false;
      const topTracks = includeTopTracks
        ? await sdk.artists.topTracks(
            params.id,
            resolveSpotifyMarket(params.market, config) ?? "US",
          )
        : undefined;

      return {
        artist: summarizeArtist(artist),
        topTracks: topTracks?.tracks.map(summarizeTrack),
      };
    },
  });
}
