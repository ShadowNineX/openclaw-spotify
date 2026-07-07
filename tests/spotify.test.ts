import { describe, expect, it } from "vitest";
import type { Queue, Track } from "@shadownine/foxify";

import {
  buildSpotifyAuthorizationUrl,
  canPersistSpotifyRefreshToken,
  getSpotifyUserClient,
  getSpotifyRefreshTokenPersistenceTarget,
  normalizeSpotifyContextUri,
  normalizeSpotifyPlayableUri,
  refreshSpotifyAccessToken,
  saveSpotifyRefreshToken,
  SPOTIFY_PLAYBACK_SCOPES,
  SPOTIFY_PLAYLIST_SCOPES,
  SPOTIFY_USER_SCOPES,
  summarizeDevice,
  summarizePlaybackState,
  summarizeQueue,
  type SpotifyOAuthTokenRecord,
  type SpotifyRuntimeApi,
} from "../src/spotify";

describe("Spotify helpers", () => {
  it("requests playlist and playback scopes for user OAuth", () => {
    expect(SPOTIFY_USER_SCOPES).toEqual([
      ...SPOTIFY_PLAYLIST_SCOPES,
      ...SPOTIFY_PLAYBACK_SCOPES,
    ]);
    expect(new Set(SPOTIFY_USER_SCOPES).size).toBe(SPOTIFY_USER_SCOPES.length);
  });

  it("can force Spotify consent when building OAuth URLs", async () => {
    const auth = await buildSpotifyAuthorizationUrl(
      {
        clientId: "client-id",
        clientSecret: "client-secret",
      },
      SPOTIFY_USER_SCOPES,
      "state",
      true,
    );
    const url = new URL(auth.authorizationUrl);

    expect(url.searchParams.get("show_dialog")).toBe("true");
    expect(url.searchParams.get("scope")).toBe(SPOTIFY_USER_SCOPES.join(" "));
  });

  it("normalizes playable Spotify IDs, URIs, and URLs", () => {
    expect(normalizeSpotifyPlayableUri("  11dFghVXANMlKmJXsNCbNl  ")).toBe(
      "spotify:track:11dFghVXANMlKmJXsNCbNl",
    );
    expect(normalizeSpotifyPlayableUri("spotify:episode:abc123")).toBe(
      "spotify:episode:abc123",
    );
    expect(
      normalizeSpotifyPlayableUri(
        "https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl?si=ignored",
      ),
    ).toBe("spotify:track:11dFghVXANMlKmJXsNCbNl");
  });

  it("rejects non-playable URIs for playback items", () => {
    expect(() =>
      normalizeSpotifyPlayableUri("https://open.spotify.com/playlist/abc123"),
    ).toThrow("Invalid Spotify track, episode URI, URL, or ID");
  });

  it("normalizes context Spotify URIs and URLs", () => {
    expect(normalizeSpotifyContextUri("spotify:album:abc123")).toBe(
      "spotify:album:abc123",
    );
    expect(
      normalizeSpotifyContextUri("https://open.spotify.com/playlist/playlist123"),
    ).toBe("spotify:playlist:playlist123");
  });

  it("rejects playable items as playback contexts", () => {
    expect(() => normalizeSpotifyContextUri("spotify:track:abc123")).toThrow(
      "Invalid Spotify context URI or URL",
    );
  });

  it("summarizes playback devices", () => {
    expect(
      summarizeDevice({
        id: "device-1",
        is_active: true,
        is_private_session: false,
        is_restricted: false,
        name: "Desk",
        type: "Computer",
        volume_percent: 42,
      }),
    ).toEqual({
      id: "device-1",
      name: "Desk",
      type: "Computer",
      active: true,
      restricted: false,
      privateSession: false,
      volumePercent: 42,
    });
  });

  it("summarizes inactive playback state", () => {
    expect(summarizePlaybackState(null)).toEqual({
      active: false,
      isPlaying: false,
    });
  });

  it("summarizes queue entries without raw Spotify payload noise", () => {
    const queue = summarizeQueue({
      currently_playing: trackFixture("track-1", "Current"),
      queue: [trackFixture("track-2", "Next")],
    } as Queue);

    expect(queue).toMatchObject({
      currentlyPlaying: {
        id: "track-1",
        name: "Current",
        type: "track",
      },
      queue: [
        {
          id: "track-2",
          name: "Next",
          type: "track",
        },
      ],
    });
  });

  it("saves refresh tokens into OpenClaw config when available", async () => {
    const draft: Record<string, unknown> = {};
    const api: SpotifyRuntimeApi = {
      runtime: {
        config: {
          mutateConfigFile: async ({ mutate }) => {
            await mutate(draft);
          },
        },
      },
    };

    expect(canPersistSpotifyRefreshToken(api)).toBe(true);
    expect(getSpotifyRefreshTokenPersistenceTarget(api)).toBe(
      "openclaw-config",
    );
    await expect(
      saveSpotifyRefreshToken(api, {
        refreshToken: "refresh-token",
        scope: "playlist-read-private",
      }),
    ).resolves.toEqual({
      persisted: true,
      storage: "openclaw-config",
    });
    expect(draft).toEqual({
      plugins: {
        entries: {
          "openclaw-spotify": {
            enabled: true,
            config: {
              refreshToken: "refresh-token",
            },
          },
        },
      },
    });
  });

  it("saves refresh tokens into OpenClaw plugin state as a fallback", async () => {
    const records = new Map<string, SpotifyOAuthTokenRecord>();
    const api: SpotifyRuntimeApi = {
      runtime: {
        state: {
          openSyncKeyedStore: <T>() => ({
            lookup: (key: string) => records.get(key) as T | undefined,
            register: (key: string, value: T) => {
              records.set(key, value as SpotifyOAuthTokenRecord);
            },
          }),
        },
      },
    };

    expect(canPersistSpotifyRefreshToken(api)).toBe(true);
    expect(getSpotifyRefreshTokenPersistenceTarget(api)).toBe(
      "openclaw-plugin-state",
    );
    await expect(
      saveSpotifyRefreshToken(api, {
        refreshToken: "refresh-token",
        scope: "playlist-read-private",
      }),
    ).resolves.toEqual({
      persisted: true,
      storage: "openclaw-plugin-state",
    });
    expect(records.get("user-refresh-token")).toMatchObject({
      refreshToken: "refresh-token",
      scope: "playlist-read-private",
    });
    expect(records.get("user-refresh-token")?.savedAt).toEqual(
      expect.any(String),
    );
  });

  it("reports unavailable token persistence without runtime storage", async () => {
    expect(canPersistSpotifyRefreshToken()).toBe(false);
    expect(getSpotifyRefreshTokenPersistenceTarget()).toBe(
      "manual-config-or-env",
    );
    await expect(
      saveSpotifyRefreshToken(undefined, {
        refreshToken: "refresh-token",
      }),
    ).resolves.toEqual({
      persisted: false,
      storage: "manual-config-or-env",
      error: undefined,
    });
  });

  it("uses newly saved OAuth tokens before stale manual config tokens", async () => {
    const originalFetch = globalThis.fetch;
    const records = new Map<string, SpotifyOAuthTokenRecord>();
    const requests: string[] = [];
    const api: SpotifyRuntimeApi = {
      runtime: {
        state: {
          openSyncKeyedStore: <T>() => ({
            lookup: (key: string) => records.get(key) as T | undefined,
            register: (key: string, value: T) => {
              records.set(key, value as SpotifyOAuthTokenRecord);
            },
          }),
        },
      },
    };

    await saveSpotifyRefreshToken(api, {
      refreshToken: "fresh-login-token",
    });

    globalThis.fetch = (async (url, init) => {
      const href = url instanceof Request ? url.url : String(url);

      if (href === "https://accounts.spotify.com/api/token") {
        const body = String(init?.body);
        requests.push(body);

        if (body.includes("refresh_token=revoked-config-token")) {
          return new Response(JSON.stringify({ error: "invalid_grant" }), {
            status: 400,
          });
        }

        return new Response(
          JSON.stringify({
            access_token: "access-token",
            expires_in: 3600,
            token_type: "Bearer",
          }),
          { status: 200 },
        );
      }

      if (href === "https://api.spotify.com/v1/me") {
        return new Response(
          JSON.stringify({
            country: "US",
            display_name: "Me",
            email: "me@example.com",
            explicit_content: {
              filter_enabled: false,
              filter_locked: false,
            },
            external_urls: {
              spotify: "https://open.spotify.com/user/me",
            },
            followers: {
              total: 0,
            },
            href: href,
            id: "me",
            images: [],
            product: "premium",
            type: "user",
            uri: "spotify:user:me",
          }),
          { status: 200 },
        );
      }

      return new Response("Unexpected test request", { status: 404 });
    }) as typeof fetch;

    try {
      const client = getSpotifyUserClient(
        {
          clientId: "client-id",
          clientSecret: "client-secret",
          refreshToken: "revoked-config-token",
        },
        api,
      );

      await expect(client.users.getCurrentProfile()).resolves.toMatchObject({
        id: "me",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain("refresh_token=fresh-login-token");
  });

  it("persists rotated refresh tokens returned by Spotify", async () => {
    const originalFetch = globalThis.fetch;
    const records = new Map<string, SpotifyOAuthTokenRecord>();
    const refreshRequests: string[] = [];
    const api: SpotifyRuntimeApi = {
      runtime: {
        state: {
          openSyncKeyedStore: <T>() => ({
            lookup: (key: string) => records.get(key) as T | undefined,
            register: (key: string, value: T) => {
              records.set(key, value as SpotifyOAuthTokenRecord);
            },
          }),
        },
      },
    };

    await saveSpotifyRefreshToken(api, {
      refreshToken: "old-rotating-token",
    });

    globalThis.fetch = (async (url, init) => {
      const href = url instanceof Request ? url.url : String(url);

      if (href === "https://accounts.spotify.com/api/token") {
        const body = String(init?.body);
        refreshRequests.push(body);

        if (body.includes("refresh_token=old-rotating-token")) {
          return new Response(
            JSON.stringify({
              access_token: "access-token-1",
              expires_in: 1,
              refresh_token: "rotated-token",
              token_type: "Bearer",
            }),
            { status: 200 },
          );
        }

        if (body.includes("refresh_token=rotated-token")) {
          return new Response(
            JSON.stringify({
              access_token: "access-token-2",
              expires_in: 1,
              token_type: "Bearer",
            }),
            { status: 200 },
          );
        }

        return new Response(
          JSON.stringify({ error: "invalid_grant" }),
          { status: 400 },
        );
      }

      if (href === "https://api.spotify.com/v1/me") {
        return new Response(
          JSON.stringify({
            country: "US",
            display_name: "Me",
            email: "me@example.com",
            explicit_content: {
              filter_enabled: false,
              filter_locked: false,
            },
            external_urls: {
              spotify: "https://open.spotify.com/user/me",
            },
            followers: {
              total: 0,
            },
            href: href,
            id: "me",
            images: [],
            product: "premium",
            type: "user",
            uri: "spotify:user:me",
          }),
          { status: 200 },
        );
      }

      return new Response("Unexpected test request", { status: 404 });
    }) as typeof fetch;

    try {
      const client = getSpotifyUserClient(
        {
          clientId: "rotating-client-id",
          clientSecret: "rotating-client-secret",
        },
        api,
      );

      await expect(client.users.getCurrentProfile()).resolves.toMatchObject({
        id: "me",
      });
      await expect(client.users.getCurrentProfile()).resolves.toMatchObject({
        id: "me",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(refreshRequests).toHaveLength(2);
    expect(refreshRequests[0]).toContain("refresh_token=old-rotating-token");
    expect(refreshRequests[1]).toContain("refresh_token=rotated-token");
    expect(records.get("user-refresh-token")).toMatchObject({
      refreshToken: "rotated-token",
    });
  });

  it("refreshes OAuth access tokens before user API calls need them", async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{
      body: string;
      headers: unknown;
      method: string | undefined;
      url: string | URL | Request;
    }> = [];

    globalThis.fetch = (async (url, init) => {
      requests.push({
        body: String(init?.body),
        headers: init?.headers,
        method: init?.method,
        url,
      });

      return new Response(
        JSON.stringify({
          access_token: "access-token",
          expires_in: 3600,
          token_type: "Bearer",
        }),
        {
          status: 200,
        },
      );
    }) as typeof fetch;

    try {
      await expect(
        refreshSpotifyAccessToken(
          {
            clientId: "client-id",
            clientSecret: "client-secret",
          },
          "refresh-token",
        ),
      ).resolves.toMatchObject({
        access_token: "access-token",
        refresh_token: "refresh-token",
        token_type: "Bearer",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      method: "POST",
      url: "https://accounts.spotify.com/api/token",
    });
    expect(requests[0]?.body).toContain("grant_type=refresh_token");
    expect(requests[0]?.body).toContain("refresh_token=refresh-token");
    expect(
      new Headers(
        requests[0]?.headers as ConstructorParameters<typeof Headers>[0],
      ).get("authorization"),
    ).toBe(
      `Basic ${Buffer.from("client%2Did:client%2Dsecret").toString("base64")}`,
    );
  });
});

function trackFixture(id: string, name: string): Track {
  return {
    album: {
      album_type: "album",
      artists: [],
      available_markets: [],
      external_urls: { spotify: `https://open.spotify.com/album/${id}` },
      href: "",
      id: `album-${id}`,
      images: [],
      name: "Album",
      release_date: "2026",
      release_date_precision: "year",
      total_tracks: 1,
      type: "album",
      uri: `spotify:album:album-${id}`,
    },
    artists: [
      {
        external_urls: { spotify: `https://open.spotify.com/artist/${id}` },
        href: "",
        id: `artist-${id}`,
        name: "Artist",
        type: "artist",
        uri: `spotify:artist:artist-${id}`,
      },
    ],
    available_markets: [],
    disc_number: 1,
    duration_ms: 180000,
    episode: false,
    explicit: false,
    external_ids: { isrc: "", ean: "", upc: "" },
    external_urls: { spotify: `https://open.spotify.com/track/${id}` },
    href: "",
    id,
    is_local: false,
    name,
    popularity: 50,
    preview_url: null,
    track: true,
    track_number: 1,
    type: "track",
    uri: `spotify:track:${id}`,
  } as unknown as Track;
}
