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
    description:
      "List one page of the authorized Spotify user's playlists. Use nextOffset when hasMore is true to read the next page.",
    parameters: myPlaylistsSchema,
    async execute(params, config, context) {
      const client = await getSpotifyUserClient(config, context.api);
      const playlists = await client.playlists.getCurrentUserPlaylists({
        limit: clampSpotifyLimit(params.limit, 20),
        offset: clampSpotifyOffset(params.offset),
      });

      return summarizePage(playlists, summarizePlaylist);
    },
  });
}
