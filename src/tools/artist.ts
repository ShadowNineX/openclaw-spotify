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
      const client = getSpotifyClient(config);
      const artist = await client.artists.get(params.id);
      const includeTopTracks = params.includeTopTracks !== false;
      const topTracks = includeTopTracks
        ? await client.artists.getTopTracks(params.id, {
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
