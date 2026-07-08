import { getToolPluginMetadata } from "openclaw/plugin-sdk/tool-plugin";
import { describe, expect, it } from "vitest";

import entry from "../index";
import { buildSpotifyToolApproval } from "../src/approval-policy";
import { defineCreatePlaylistTool } from "../src/tools/create-playlist";
import { definePlaylistTool } from "../src/tools/playlist";
import { defineUploadPlaylistCoverTool } from "../src/tools/upload-playlist-cover";

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
  "spotify_upload_playlist_cover",
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

  it("sends profile-hidden playlist creation as an explicit boolean false", async () => {
    const originalFetch = globalThis.fetch;
    let createPlaylistBody: unknown;
    let changeDetailsBody: unknown;
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
              spotify: "https://open.spotify.com/playlist/profile-hidden-1",
            },
            followers: {
              total: 0,
            },
            href,
            id: "profile-hidden-1",
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
              href: `${href}/profile-hidden-1/tracks`,
              total: 0,
            },
            type: "playlist",
            uri: "spotify:playlist:profile-hidden-1",
          }),
          { status: 200 },
        );
      }

      if (href === "https://api.spotify.com/v1/playlists/profile-hidden-1") {
        expect(init?.method).toBe("PUT");
        changeDetailsBody = JSON.parse(String(init?.body));

        return new Response(null, { status: 200 });
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
            clientId: "create-profile-hidden-client-id",
            clientSecret: "create-profile-hidden-client-secret",
            refreshToken: "create-profile-hidden-refresh-token",
          },
          {},
        ),
      ).resolves.toMatchObject({
        public: false,
        visibility: {
          publishedOnProfileAndSearch: false,
          controlsLinkAccess: false,
        },
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
    expect(changeDetailsBody).toMatchObject({
      public: false,
      collaborative: false,
    });
  });

  it("describes Spotify playlist public flags as profile and search visibility", () => {
    const metadata = getToolPluginMetadata(entry);
    const createTool = metadata?.tools.find(
      (tool) => tool.name === "spotify_create_playlist",
    );
    const updateTool = metadata?.tools.find(
      (tool) => tool.name === "spotify_update_playlist",
    );
    const createParameters = createTool?.parameters as {
      properties: { public: { description: string } };
    };
    const updateParameters = updateTool?.parameters as {
      properties: { public: { description: string } };
    };

    expect(
      createParameters.properties.public.description,
    ).toContain("profile and in search");
    expect(
      createParameters.properties.public.description,
    ).toContain("does not control who can open the playlist link");
    expect(
      updateParameters.properties.public.description,
    ).toContain("profile and in search");
    expect(
      updateParameters.properties.public.description,
    ).toContain("does not control who can open the playlist link");
  });

  it("reads playlist tracks with user OAuth instead of client credentials", async () => {
    const originalFetch = globalThis.fetch;
    const tokenRequests: URLSearchParams[] = [];
    const playlistTool = definePlaylistTool(
      ((definition: unknown) => definition) as never,
    ) as unknown as {
      execute(
        params: {
          id: string;
          limit?: number;
          market?: string;
          offset?: number;
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
        expect(init?.method).toBe("POST");
        tokenRequests.push(new URLSearchParams(String(init?.body)));

        return new Response(
          JSON.stringify({
            access_token: "user-access-token",
            expires_in: 3600,
            token_type: "Bearer",
          }),
          { status: 200 },
        );
      }

      if (href === "https://api.spotify.com/v1/playlists/playlist-1?market=SE") {
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer user-access-token",
        );

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
            href,
            id: "playlist-1",
            images: [],
            name: "Good Signal",
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
            public: true,
            snapshot_id: "snapshot-1",
            tracks: {
              href: "https://api.spotify.com/v1/playlists/playlist-1/tracks",
              total: 1,
            },
            type: "playlist",
            uri: "spotify:playlist:playlist-1",
          }),
          { status: 200 },
        );
      }

      if (
        href ===
        "https://api.spotify.com/v1/playlists/playlist-1/items?market=SE&limit=20&offset=0"
      ) {
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer user-access-token",
        );

        return new Response(
          JSON.stringify({
            href,
            items: [
              {
                item: {
                  album: {
                    id: "album-1",
                    name: "Album",
                    release_date: "2026",
                    uri: "spotify:album:album-1",
                  },
                  artists: [
                    {
                      id: "artist-1",
                      name: "Artist",
                      uri: "spotify:artist:artist-1",
                    },
                  ],
                  disc_number: 1,
                  duration_ms: 123,
                  explicit: false,
                  id: "track-1",
                  name: "Track",
                  track_number: 1,
                  type: "track",
                  uri: "spotify:track:track-1",
                },
              },
            ],
            limit: 20,
            next: null,
            offset: 0,
            previous: null,
            total: 1,
          }),
          { status: 200 },
        );
      }

      return new Response(`Unexpected test request: ${href}`, { status: 404 });
    }) as typeof fetch;

    try {
      await expect(
        playlistTool.execute(
          {
            id: "playlist-1",
            market: "SE",
          },
          {
            clientId: "playlist-client-id",
            clientSecret: "playlist-client-secret",
            refreshToken: "playlist-refresh-token",
          },
          {},
        ),
      ).resolves.toMatchObject({
        playlist: {
          id: "playlist-1",
          name: "Good Signal",
        },
        tracks: {
          total: 1,
          items: [
            {
              name: "Track",
              uri: "spotify:track:track-1",
            },
          ],
        },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(tokenRequests).toHaveLength(1);
    expect(tokenRequests[0]?.get("grant_type")).toBe("refresh_token");
    expect(tokenRequests[0]?.get("refresh_token")).toBe(
      "playlist-refresh-token",
    );
  });

  it("uploads playlist covers as raw JPEG base64", async () => {
    const originalFetch = globalThis.fetch;
    let uploadedCoverBody: unknown;
    let uploadedCoverContentType: string | undefined;
    const uploadCoverTool = defineUploadPlaylistCoverTool(
      ((definition: unknown) => definition) as never,
    ) as unknown as {
      execute(
        params: {
          id: string;
          imageUrl?: string;
          processImage?: boolean;
          quality?: number;
          size?: number;
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

      if (href === "https://example.com/cover.svg") {
        return new Response(
          '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#f7b733"/></svg>',
          {
            headers: {
              "content-type": "image/svg+xml",
            },
          },
        );
      }

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

      if (href === "https://api.spotify.com/v1/playlists/playlist-1/images") {
        expect(init?.method).toBe("PUT");
        uploadedCoverBody = init?.body;
        uploadedCoverContentType = new Headers(init?.headers).get(
          "content-type",
        ) ?? undefined;

        return new Response(null, { status: 202 });
      }

      return new Response("Unexpected test request", { status: 404 });
    }) as typeof fetch;

    try {
      await expect(
        uploadCoverTool.execute(
          {
            id: "playlist-1",
            imageUrl: "https://example.com/cover.svg",
            size: 128,
            quality: 80,
          },
          {
            clientId: "cover-client-id",
            clientSecret: "cover-client-secret",
            refreshToken: "cover-refresh-token",
          },
          {},
        ),
      ).resolves.toMatchObject({
        id: "playlist-1",
        uploaded: true,
        image: {
          processed: true,
          source: "url",
        },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(uploadedCoverContentType).toBe("image/jpeg");
    expect(typeof uploadedCoverBody).toBe("string");
    expect((uploadedCoverBody as string).length).toBeLessThanOrEqual(
      256 * 1024,
    );
    expect(uploadedCoverBody).not.toContain("data:image");
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
