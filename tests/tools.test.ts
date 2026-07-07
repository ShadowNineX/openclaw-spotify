import { getToolPluginMetadata } from "openclaw/plugin-sdk/tool-plugin";
import { describe, expect, it } from "vitest";

import entry from "../index";

const spotifyToolNames = [
  "spotify_search",
  "spotify_get_track",
  "spotify_get_artist",
  "spotify_get_album",
  "spotify_get_playlist",
  "spotify_list_my_playlists",
  "spotify_create_playlist",
  "spotify_update_playlist",
  "spotify_add_playlist_tracks",
  "spotify_remove_playlist_tracks",
  "spotify_reorder_playlist_tracks",
  "spotify_get_playback",
  "spotify_get_currently_playing",
  "spotify_list_devices",
  "spotify_get_queue",
  "spotify_transfer_playback",
  "spotify_play",
  "spotify_pause",
  "spotify_next",
  "spotify_previous",
  "spotify_seek",
  "spotify_set_repeat",
  "spotify_set_volume",
  "spotify_set_shuffle",
  "spotify_add_to_queue",
];

describe("Spotify tool plugin metadata", () => {
  it("exposes the Spotify tools OpenClaw discovers", () => {
    const metadata = getToolPluginMetadata(entry);

    expect(metadata?.id).toBe("spotify");
    expect(metadata?.tools.map((tool) => tool.name)).toEqual(spotifyToolNames);
  });

  it("keeps search parameters discoverable as JSON schema", () => {
    const metadata = getToolPluginMetadata(entry);
    const searchTool = metadata?.tools.find(
      (tool) => tool.name === "spotify_search",
    );

    expect(searchTool?.parameters).toMatchObject({
      type: "object",
      additionalProperties: false,
      properties: {
        query: {
          type: "string",
          minLength: 1,
        },
      },
    });
  });

  it("keeps playback controls discoverable as JSON schema", () => {
    const metadata = getToolPluginMetadata(entry);
    const playTool = metadata?.tools.find(
      (tool) => tool.name === "spotify_play",
    );
    const volumeTool = metadata?.tools.find(
      (tool) => tool.name === "spotify_set_volume",
    );

    expect(playTool?.parameters).toMatchObject({
      type: "object",
      additionalProperties: false,
      properties: {
        contextUri: {
          type: "string",
          minLength: 1,
        },
        uris: {
          type: "array",
          minItems: 1,
          maxItems: 100,
        },
      },
    });
    expect(volumeTool?.parameters).toMatchObject({
      type: "object",
      properties: {
        volumePercent: {
          type: "integer",
          minimum: 0,
          maximum: 100,
        },
      },
    });
  });
});
