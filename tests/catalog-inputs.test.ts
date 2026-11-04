import { afterEach, describe, expect, it, vi } from "vitest";

import {
  normalizeSpotifyCatalogId,
  normalizeSpotifyContextUri,
  normalizeSpotifyPlayableUri,
  normalizeSpotifyPlaylistId,
  normalizeSpotifyTrackUris,
} from "../src/spotify";
import { defineAlbumTool } from "../src/tools/album";
import { defineArtistTool } from "../src/tools/artist";
import { defineTrackTool } from "../src/tools/track";

afterEach(() => vi.unstubAllGlobals());

const kinds = [
  { kind: "track", define: defineTrackTool },
  { kind: "artist", define: defineArtistTool },
  { kind: "album", define: defineAlbumTool },
] as const;
const formats = [
  { label: "bare ID", reference: (kind: string) => " item1 " },
  { label: "URI", reference: (kind: string) => `spotify:${kind}:item1` },
  { label: "share URL", reference: (kind: string) => `https://open.spotify.com/${kind}/item1?si=shared` },
  { label: "localized URL", reference: (kind: string) => `https://open.spotify.com/intl-de/${kind}/item1?si=shared` },
  { label: "embed URL", reference: (kind: string) => `https://open.spotify.com/embed/${kind}/item1` },
];

describe.each(kinds)("Catalog $kind input", ({ kind, define }) => {
  it.each(formats)("resolves a $label before catalog and related requests", async ({ reference }) => {
    const paths: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: Parameters<typeof globalThis.fetch>[0]) => {
      const url = new URL(String(input));
      if (url.hostname === "accounts.spotify.com") {
        return Response.json({ access_token: "access", token_type: "Bearer", expires_in: 3600 });
      }
      paths.push(url.pathname);
      if (url.pathname === `/v1/${kind}s/item1`) {
        return Response.json({ id: "item1", name: "Chosen item" });
      }
      if (url.pathname === "/v1/artists/item1/top-tracks") {
        return Response.json({ tracks: [{ id: "top1", name: "Top track" }] });
      }
      if (url.pathname === "/v1/albums/item1/tracks") {
        expect(url.searchParams.get("limit")).toBe("20");
        return Response.json({ items: [{ id: "song1", name: "Album song" }], limit: 20, offset: 0, total: 1, next: null, previous: null });
      }
      throw new Error(`Unexpected request: ${url}`);
    }));
    const tool = define(((definition: unknown) => definition) as never) as unknown as {
      execute(params: unknown, config: unknown): Promise<unknown>;
    };
    const result = await tool.execute({ id: reference(kind) }, {
      clientId: `catalog-input-${kind}-${reference(kind)}`,
      clientSecret: "secret",
    });
    if (kind === "track") {
      expect(result).toMatchObject({ id: "item1", name: "Chosen item" });
      expect(paths).toEqual(["/v1/tracks/item1"]);
    } else if (kind === "artist") {
      expect(result).toMatchObject({ artist: { id: "item1" }, topTracks: [{ id: "top1" }] });
      expect(paths).toEqual(["/v1/artists/item1", "/v1/artists/item1/top-tracks"]);
    } else {
      expect(result).toMatchObject({ album: { id: "item1" }, tracks: { items: [{ id: "song1" }] } });
      expect(paths).toEqual(["/v1/albums/item1", "/v1/albums/item1/tracks"]);
    }
  });

  it("rejects another item kind before requesting credentials or making requests", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const tool = define(((definition: unknown) => definition) as never) as unknown as {
      execute(params: unknown, config: unknown): Promise<unknown>;
    };
    await expect(tool.execute({ id: "spotify:playlist:wrong1" }, {})).rejects.toThrow(`Invalid Spotify ${kind}`);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("Spotify reference validation", () => {
  it.each([
    { label: "empty", input: " " },
    { label: "wrong host", input: "https://example.com/track/item1" },
    { label: "lookalike host", input: "https://open.spotify.com.example.com/track/item1" },
    { label: "unsupported protocol", input: "ftp://open.spotify.com/track/item1" },
    { label: "embedded credentials", input: "https://user@open.spotify.com/track/item1" },
    { label: "unexpected port", input: "https://open.spotify.com:8080/track/item1" },
    { label: "extra path", input: "https://open.spotify.com/track/item1/other" },
    { label: "wrong URL kind", input: "https://open.spotify.com/album/item1" },
    { label: "missing ID", input: "https://open.spotify.com/track/" },
  ])("rejects $label references", ({ input }) => {
    expect(() => normalizeSpotifyCatalogId(input, "track")).toThrow("Invalid Spotify track");
  });

  it("accepts localized links in playlist, playback, and track edit helpers", () => {
    expect(normalizeSpotifyPlaylistId("https://open.spotify.com/intl-sv/playlist/list1")).toBe("list1");
    expect(normalizeSpotifyContextUri("https://open.spotify.com/intl-sv/album/album1")).toBe("spotify:album:album1");
    expect(normalizeSpotifyPlayableUri("https://open.spotify.com/intl-sv/episode/episode1")).toBe("spotify:episode:episode1");
    expect(normalizeSpotifyTrackUris(["https://open.spotify.com/intl-sv/track/track1"])).toEqual(["spotify:track:track1"]);
  });
});
