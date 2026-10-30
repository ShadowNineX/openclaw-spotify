import { afterEach, describe, expect, it, vi } from "vitest";

import {
  summarizePage,
  summarizePlaylist,
  summarizePlaylistTrack,
} from "../src/spotify";
import { defineMyPlaylistsTool } from "../src/tools/my-playlists";
import { definePlaylistTool } from "../src/tools/playlist";

afterEach(() => vi.unstubAllGlobals());

describe("playlist reading", () => {
  it("summarizes playlist snapshots, item totals, partial owners, and unknown visibility", () => {
    expect(summarizePlaylist({
      id: "playlist-1",
      name: "Road trip",
      owner: { id: "me" },
      items: { total: 7 },
      public: undefined,
      snapshot_id: "snapshot-1",
    } as never)).toMatchObject({
      id: "playlist-1",
      snapshotId: "snapshot-1",
      totalTracks: 7,
      owner: { id: "me" },
      visibility: { hiddenFromProfile: null, searchable: null },
    });
  });

  it("uses legacy tracks totals when item totals are absent", () => {
    expect(summarizePlaylist({
      id: "playlist-legacy",
      name: "Legacy",
      tracks: { total: 12 },
    } as never)).toMatchObject({ totalTracks: 12 });
  });

  it("prefers an item total of zero over a legacy tracks total", () => {
    expect(summarizePlaylist({
      id: "playlist-empty",
      name: "Empty",
      items: { total: 0 },
      tracks: { total: 12 },
    } as never)).toMatchObject({ totalTracks: 0 });
  });

  it.each([
    { label: "published", value: true, hiddenFromProfile: false, searchable: true },
    { label: "hidden from profile", value: false, hiddenFromProfile: true, searchable: false },
    { label: "unknown", value: null, hiddenFromProfile: null, searchable: null },
  ])("represents $label playlist visibility without guessing", ({ value, hiddenFromProfile, searchable }) => {
    expect(summarizePlaylist({ id: "visibility", name: "Visibility", public: value } as never)).toMatchObject({
      visibility: { hiddenFromProfile, searchable },
    });
  });

  it("preserves unavailable slots and episode references", () => {
    expect(summarizePlaylistTrack(null)).toEqual({ unavailable: true });
    expect(summarizePlaylistTrack({ item: null, added_at: "2026-10-30" })).toEqual({
      addedAt: "2026-10-30",
      unavailable: true,
    });
    expect(summarizePlaylistTrack({
      item: {
        id: "episode-1",
        name: "Episode",
        type: "episode",
        uri: "spotify:episode:episode-1",
        external_urls: { spotify: "https://open.spotify.com/episode/episode-1" },
      },
    } as never)).toEqual({
      type: "episode",
      id: "episode-1",
      name: "Episode",
      uri: "spotify:episode:episode-1",
      url: "https://open.spotify.com/episode/episode-1",
    });
  });

  it("supplies explicit paging progress without dropping unavailable results", () => {
    const summary = summarizePage({
      href: "",
      items: [{ id: "one" }, null, { id: "three" }],
      limit: 3,
      next: "https://next",
      offset: 20,
      previous: "https://previous",
      total: 24,
    }, (item) => item);

    expect(summary).toEqual({
      total: 24,
      limit: 3,
      offset: 20,
      next: "https://next",
      previous: "https://previous",
      hasMore: true,
      nextOffset: 23,
      items: [{ id: "one" }, { unavailable: true }, { id: "three" }],
    });
    expect(summarizePage({ href: "", items: [], limit: 20, next: null, offset: 40, previous: null, total: 40 }, (item: string) => item)).toMatchObject({
      hasMore: false,
      nextOffset: null,
    });
  });

  it.each([
    { label: "Spotify next URL", next: "https://api.spotify.com/v1/me/playlists?limit=20&offset=40", expected: 40 },
    { label: "missing next offset", next: "https://api.spotify.com/v1/me/playlists?limit=20", expected: 25 },
    { label: "malformed next offset", next: "not a URL", expected: 25 },
  ])("uses the $label when advancing a short page", ({ next, expected }) => {
    expect(summarizePage({
      href: "",
      items: [{ id: "only-result" }],
      limit: 20,
      next,
      offset: 5,
      previous: null,
      total: 40,
    }, (item) => item)).toMatchObject({ hasMore: true, nextOffset: expected });
  });

  it("reads a nonzero playlist page with absolute positions and duplicate tracks", async () => {
    const fetch = vi.fn(async (input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
      const url = String(input);
      if (url === "https://accounts.spotify.com/api/token") {
        return Response.json({ access_token: "token", expires_in: 3600, token_type: "Bearer" });
      }
      if (url === "https://api.spotify.com/v1/playlists/playlist-1") {
        return Response.json({
          id: "playlist-1", name: "Road trip", type: "playlist", uri: "spotify:playlist:playlist-1",
          snapshot_id: "snapshot-2", items: { total: 9 }, owner: { id: "me" }, external_urls: { spotify: "https://open.spotify.com/playlist/playlist-1" },
        });
      }
      if (url === "https://api.spotify.com/v1/playlists/playlist-1/items?limit=3&offset=4") {
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer token");
        return Response.json({
          href: url, items: [
            { item: { id: "duplicate", name: "Same song", type: "track", uri: "spotify:track:duplicate", artists: [] } },
            { item: null },
            { item: { id: "duplicate", name: "Same song", type: "track", uri: "spotify:track:duplicate", artists: [] } },
          ], limit: 3, next: "https://next", offset: 4, previous: "https://previous", total: 9,
        });
      }
      return new Response(`Unexpected request: ${url}`, { status: 404 });
    });
    vi.stubGlobal("fetch", fetch);
    const tool = definePlaylistTool(((definition: unknown) => definition) as never) as never as {
      execute(params: unknown, config: unknown, context: unknown): Promise<unknown>;
    };

    await expect(tool.execute({ id: "playlist-1", limit: 3, offset: 4 }, spotifyConfig(), {})).resolves.toMatchObject({
      playlist: { snapshotId: "snapshot-2", totalTracks: 9 },
      tracks: {
        offset: 4,
        hasMore: true,
        nextOffset: 7,
        items: [
          { position: 4, id: "duplicate", type: "track" },
          { position: 5, unavailable: true },
          { position: 6, id: "duplicate", type: "track" },
        ],
      },
    });
  });

  it("lists the authorized user's playlists with a usable next offset", async () => {
    const fetch = vi.fn(async (input: Parameters<typeof globalThis.fetch>[0]) => {
      const url = String(input);
      if (url === "https://accounts.spotify.com/api/token") return Response.json({ access_token: "list-token", expires_in: 3600, token_type: "Bearer" });
      if (url === "https://api.spotify.com/v1/me/playlists?limit=2&offset=2") return Response.json({
        href: url, items: [{ id: "playlist-3", name: "Third", type: "playlist", owner: { id: "me" } }, null], limit: 2, next: "https://next", offset: 2, previous: "https://previous", total: 5,
      });
      return new Response(`Unexpected request: ${url}`, { status: 404 });
    });
    vi.stubGlobal("fetch", fetch);
    const tool = defineMyPlaylistsTool(((definition: unknown) => definition) as never) as never as {
      execute(params: unknown, config: unknown, context: unknown): Promise<unknown>;
    };

    await expect(tool.execute({ limit: 2, offset: 2 }, spotifyConfig("list"), {})).resolves.toMatchObject({
      hasMore: true,
      nextOffset: 4,
      items: [{ id: "playlist-3", visibility: { searchable: null } }, { unavailable: true }],
    });
  });
});

function spotifyConfig(suffix = "read") {
  return { clientId: `playlist-reader-${suffix}-client`, clientSecret: `playlist-reader-${suffix}-secret`, refreshToken: `playlist-reader-${suffix}-refresh` };
}
