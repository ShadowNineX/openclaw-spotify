import { getToolPluginMetadata } from "openclaw/plugin-sdk/tool-plugin";
import { Check } from "typebox/value";
import { afterEach, describe, expect, it, vi } from "vitest";

import entry from "../index";
import { defineAlbumTool } from "../src/tools/album";
import { defineMyPlaylistsTool } from "../src/tools/my-playlists";
import { definePlaylistTool } from "../src/tools/playlist";
import { defineSearchTool } from "../src/tools/search";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Spotify tool contracts", () => {
  it.each([
    { label: "add", name: "spotify_add_playlist_tracks", supported: { position: 0 }, unsupported: { snapshotId: "snapshot" } },
    { label: "remove", name: "spotify_remove_playlist_tracks", supported: { snapshotId: "snapshot" }, unsupported: { position: 0 } },
  ])("rejects irrelevant options in the advertised $label schema", ({ name, supported, unsupported }) => {
    const schema = getToolPluginMetadata(entry)!.tools.find((tool) => tool.name === name)!.parameters;
    const params = { id: "playlist1", uris: ["spotify:track:track1"] };
    expect(Check(schema, params)).toBe(true);
    expect(Check(schema, { ...params, ...supported })).toBe(true);
    expect(Check(schema, { ...params, ...unsupported })).toBe(false);
  });

  it.each([
    { label: "search", name: "spotify_search", define: defineSearchTool, params: { query: "song" }, limit: 10 },
    { label: "album", name: "spotify_get_album", define: defineAlbumTool, params: { id: "album1" }, limit: 20 },
    { label: "playlist", name: "spotify_get_playlist", define: definePlaylistTool, params: { id: "playlist1" }, limit: 20 },
    { label: "my playlists", name: "spotify_list_my_playlists", define: defineMyPlaylistsTool, params: {}, limit: 20 },
  ])("matches the advertised default page size for $label", async ({ name, define, params, limit }) => {
    vi.stubEnv("SPOTIFY_REFRESH_TOKEN", undefined);
    const pageRequests: URL[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: Parameters<typeof globalThis.fetch>[0]) => {
      const url = new URL(String(input));
      if (url.hostname === "accounts.spotify.com") {
        return Response.json({ access_token: "contract-access", token_type: "Bearer", expires_in: 3600 });
      }
      if (url.searchParams.has("limit")) {
        pageRequests.push(url);
        const page = { items: [], offset: 0, limit, total: 0, next: null, previous: null };
        return Response.json(url.pathname.endsWith("/search") ? { tracks: page } : page);
      }
      return Response.json({ id: "item1", name: "Item" });
    }));
    const schema = getToolPluginMetadata(entry)!.tools.find((tool) => tool.name === name)!.parameters;
    expect(schema).toMatchObject({ properties: { limit: { default: limit } } });
    const tool = define(((definition: unknown) => definition) as never) as unknown as {
      execute(params: unknown, config: unknown, context: unknown): Promise<unknown>;
    };
    await tool.execute(params, { clientId: name, clientSecret: "secret", refreshToken: "refresh" }, {});
    expect(pageRequests).toHaveLength(1);
    expect(pageRequests[0]!.searchParams.get("limit")).toBe(String(limit));
  });
});
