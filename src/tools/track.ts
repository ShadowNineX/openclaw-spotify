import {
  getSpotifyClient,
  resolveSpotifyMarket,
  summarizeTrack,
} from "../spotify";
import { idSchema } from "./schemas";
import type { SpotifyTool, SpotifyToolFactory } from "./types";

export function defineTrackTool(tool: SpotifyToolFactory): SpotifyTool {
  return tool({
    name: "spotify_get_track",
    label: "Spotify Track",
    description:
      "Get Spotify catalog metadata for a track by Spotify track ID.",
    parameters: idSchema,
    async execute(params, config) {
      const client = getSpotifyClient(config);
      const track = await client.tracks.get(params.id, {
        market: resolveSpotifyMarket(params.market, config),
      });

      return summarizeTrack(track);
    },
  });
}
