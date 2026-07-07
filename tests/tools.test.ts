import { getToolPluginMetadata } from "openclaw/plugin-sdk/tool-plugin";
import { describe, expect, it } from "vitest";

import entry from "../index";
import { buildSpotifyToolApproval } from "../src/approval-policy";
import { defineCreatePlaylistTool } from "../src/tools/create-playlist";

const spotifyToolNames = [
  "spotify_search",
  "spotify_get_track",
  "spotify_get_artist",
  "spotify_get_album",
  "spotify_get_playlist",
  "spotify_list_my_playlists",
  "spotify_create_playlist",
  "spotify_update_playlist",
  "spotify_delete_playlist",
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

    expect(metadata?.id).toBe("openclaw-spotify");
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

  it("requires approval before destructive playlist mutations", async () => {
    expect(
      await buildSpotifyToolApproval({
        toolName: "spotify_delete_playlist",
        params: {
          id: "playlist-1",
        },
      }),
    ).toEqual({
      requireApproval: {
        title: "Delete Spotify playlist",
        description:
          "Delete playlist playlist-1 from the authorized user's library.",
        severity: "critical",
        allowedDecisions: ["allow-once", "deny"],
        timeoutMs: 120_000,
        timeoutBehavior: "deny",
      },
    });
  });

  it("fetches playlist names before building approval prompts", async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async (url, init) => {
      const href = url instanceof Request ? url.url : String(url);

      if (href === "https://accounts.spotify.com/api/token") {
        expect(init?.method).toBe("POST");

        return new Response(
          JSON.stringify({
            access_token: "access-token",
            expires_in: 3600,
            token_type: "Bearer",
          }),
          { status: 200 },
        );
      }

      if (href.includes("https://api.spotify.com/v1/playlists/playlist-1")) {
        return new Response(
          JSON.stringify({
            collaborative: false,
            description: "",
            external_urls: {
              spotify: "https://open.spotify.com/playlist/playlist-1",
            },
            followers: {
              total: 0,
            },
            href: href,
            id: "playlist-1",
            images: [],
            name: "Road trip",
            owner: {
              display_name: "Me",
              external_urls: {
                spotify: "https://open.spotify.com/user/me",
              },
              href: "https://api.spotify.com/v1/users/me",
              id: "me",
              type: "user",
              uri: "spotify:user:me",
            },
            public: false,
            snapshot_id: "snapshot-1",
            tracks: {
              href: `${href}/tracks`,
              total: 0,
            },
            type: "playlist",
            uri: "spotify:playlist:playlist-1",
          }),
          { status: 200 },
        );
      }

      return new Response("Unexpected test request", { status: 404 });
    }) as typeof fetch;

    try {
      await expect(
        buildSpotifyToolApproval({
          context: {
            pluginConfig: {
              clientId: "client-id",
              clientSecret: "client-secret",
              refreshToken: "refresh-token",
            },
          },
          toolName: "spotify_delete_playlist",
          params: {
            id: "playlist-1",
          },
        }),
      ).resolves.toMatchObject({
        requireApproval: {
          description:
            'Delete playlist "Road trip" (id: playlist-1) from the authorized user\'s library.',
        },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("does not require approval before additive playlist changes", async () => {
    expect(
      await buildSpotifyToolApproval({
        toolName: "spotify_add_playlist_tracks",
        params: {
          id: "playlist-1",
          uris: ["spotify:track:track-1"],
        },
      }),
    ).toBeUndefined();
    expect(
      await buildSpotifyToolApproval({
        toolName: "spotify_create_playlist",
        params: {
          name: "Road trip",
        },
      }),
    ).toBeUndefined();
  });

  it("sends private playlist creation as an explicit boolean false", async () => {
    const originalFetch = globalThis.fetch;
    let createPlaylistBody: unknown;
    const createPlaylistTool = defineCreatePlaylistTool(
      ((definition: unknown) => definition) as never,
    ) as unknown as {
      execute(
        params: {
          collaborative?: boolean;
          description?: string;
          name: string;
          public?: boolean;
        },
        config: {
          clientId: string;
          clientSecret: string;
          refreshToken: string;
        },
        context: {
          api?: unknown;
        },
      ): Promise<unknown>;
    };

    globalThis.fetch = (async (url, init) => {
      const href = url instanceof Request ? url.url : String(url);

      if (href === "https://accounts.spotify.com/api/token") {
        return new Response(
          JSON.stringify({
            access_token: "access-token",
            expires_in: 3600,
            token_type: "Bearer",
          }),
          { status: 200 },
        );
      }

      if (href === "https://api.spotify.com/v1/me/playlists") {
        createPlaylistBody = JSON.parse(String(init?.body));

        return new Response(
          JSON.stringify({
            collaborative: false,
            description: "Hidden from profile",
            external_urls: {
              spotify: "https://open.spotify.com/playlist/private-1",
            },
            followers: {
              total: 0,
            },
            href,
            id: "private-1",
            images: [],
            name: "Private test",
            owner: {
              display_name: "Me",
              external_urls: {
                spotify: "https://open.spotify.com/user/me",
              },
              href: "https://api.spotify.com/v1/users/me",
              id: "me",
              type: "user",
              uri: "spotify:user:me",
            },
            public: false,
            snapshot_id: "snapshot-1",
            tracks: {
              href: `${href}/private-1/tracks`,
              total: 0,
            },
            type: "playlist",
            uri: "spotify:playlist:private-1",
          }),
          { status: 200 },
        );
      }

      return new Response("Unexpected test request", { status: 404 });
    }) as typeof fetch;

    try {
      await expect(
        createPlaylistTool.execute(
          {
            name: "Private test",
            description: "Hidden from profile",
            public: false,
          },
          {
            clientId: "create-private-client-id",
            clientSecret: "create-private-client-secret",
            refreshToken: "create-private-refresh-token",
          },
          {},
        ),
      ).resolves.toMatchObject({
        public: false,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(createPlaylistBody).toMatchObject({
      name: "Private test",
      description: "Hidden from profile",
      public: false,
      collaborative: false,
    });
  });

  it("falls back to playlist IDs when no display name is available", async () => {
    expect(
      await buildSpotifyToolApproval({
        toolName: "spotify_remove_playlist_tracks",
        params: {
          id: "playlist-1",
          uris: ["spotify:track:track-1"],
        },
      }),
    ).toMatchObject({
      requireApproval: {
        description: "Remove 1 track(s) from playlist playlist-1.",
      },
    });
  });

  it("lets operators configure Spotify playlist approvals per action", async () => {
    expect(
      await buildSpotifyToolApproval({
        context: {
          pluginConfig: {
            playlistApprovals: {
              update: "allow",
              delete: "prompt",
            },
          },
        },
        toolName: "spotify_update_playlist",
        params: {
          id: "playlist-1",
        },
      }),
    ).toBeUndefined();

    expect(
      await buildSpotifyToolApproval({
        context: {
          pluginConfig: {
            playlistApprovals: {
              update: "allow",
              delete: "prompt",
            },
          },
        },
        toolName: "spotify_delete_playlist",
        params: {
          id: "playlist-1",
        },
      }),
    ).toMatchObject({
      requireApproval: {
        title: "Delete Spotify playlist",
      },
    });
  });
});
