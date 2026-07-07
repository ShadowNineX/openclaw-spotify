import {
  clampSpotifyLimit,
  clampSpotifyOffset,
  getSpotifyUserClient,
  summarizePage,
  summarizePlaylist,
} from "../spotify";
import { myPlaylistsSchema } from "./schemas";
import type { SpotifyTool, SpotifyToolFactory } from "./types";

export function defineMyPlaylistsTool(tool: SpotifyToolFactory): SpotifyTool {
  return tool({
    name: "spotify_list_my_playlists",
    label: "Spotify My Playlists",
    description: "List playlists for the authorized Spotify user.",
    parameters: myPlaylistsSchema,
    async execute(params, config, context) {
      const client = getSpotifyUserClient(config, context.api);
      const playlists = await client.playlists.getCurrentUserPlaylists({
        limit: clampSpotifyLimit(params.limit, 20),
        offset: clampSpotifyOffset(params.offset),
      });

      return summarizePage(playlists, summarizePlaylist);
    },
  });
}
