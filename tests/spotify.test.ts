import { describe, expect, it } from "vitest";
import type { Queue, Track } from "@spotify/web-api-ts-sdk";

import {
  canPersistSpotifyRefreshToken,
  normalizeSpotifyContextUri,
  normalizeSpotifyPlayableUri,
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

  it("saves refresh tokens into OpenClaw plugin state when available", () => {
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
    expect(
      saveSpotifyRefreshToken(api, {
        refreshToken: "refresh-token",
        scope: "playlist-read-private",
      }),
    ).toBe(true);
    expect(records.get("user-refresh-token")).toMatchObject({
      refreshToken: "refresh-token",
      scope: "playlist-read-private",
    });
    expect(records.get("user-refresh-token")?.savedAt).toEqual(
      expect.any(String),
    );
  });

  it("reports unavailable token persistence without a runtime state store", () => {
    expect(canPersistSpotifyRefreshToken()).toBe(false);
    expect(
      saveSpotifyRefreshToken(undefined, {
        refreshToken: "refresh-token",
      }),
    ).toBe(false);
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
