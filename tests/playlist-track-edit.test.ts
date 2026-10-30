import { afterEach, describe, expect, it, vi } from "vitest";

import { defineAddPlaylistTracksTool } from "../src/tools/add-playlist-tracks";
import { defineRemovePlaylistTracksTool } from "../src/tools/remove-playlist-tracks";

afterEach(() => vi.unstubAllGlobals());

const actions = [
  { label: "add", define: defineAddPlaylistTracksTool, method: "POST", count: "added" },
  { label: "remove", define: defineRemovePlaylistTracksTool, method: "DELETE", count: "removed" },
] as const;

describe("Playlist track edits", () => {
  it.each(actions)("preserves normalized targets and request options for $label", async ({ label, define, method, count }) => {
    const fetch = vi.fn(async (input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === "https://accounts.spotify.com/api/token") {
        return Response.json({ access_token: "edit-access", token_type: "Bearer", expires_in: 3600 });
      }
      if (url === "https://api.spotify.com/v1/playlists/playlist1") {
        return Response.json({ name: "Road trip" });
      }
      if (new URL(url).pathname === "/v1/playlists/playlist1/items") {
        expect(init?.method).toBe(method);
        expect(new URL(url).searchParams.get("position")).toBe(label === "add" ? "3" : null);
        expect(JSON.parse(String(init?.body))).toEqual(label === "add"
          ? { uris: ["spotify:track:track1"] }
          : { items: [{ uri: "spotify:track:track1" }], snapshot_id: "before-edit" });
        return Response.json({ snapshot_id: "after-edit" });
      }
      throw new Error(`Unexpected test request: ${url}`);
    });
    vi.stubGlobal("fetch", fetch);
    const tool = define(((definition: unknown) => definition) as never) as unknown as {
      execute(params: unknown, config: unknown, context: unknown): Promise<unknown>;
    };

    await expect(tool.execute({
      id: "https://open.spotify.com/playlist/playlist1?si=shared",
      uris: ["track1"],
      position: 3,
      snapshotId: "before-edit",
    }, {
      clientId: `${label}-edit-client`,
      clientSecret: "edit-secret",
      refreshToken: "edit-refresh",
    }, {})).resolves.toMatchObject({
      id: "playlist1",
      name: "Road trip",
      playlist: { id: "playlist1", name: "Road trip", url: "https://open.spotify.com/playlist/playlist1" },
      snapshotId: "after-edit",
      [count]: 1,
      uris: ["spotify:track:track1"],
    });
    expect(fetch.mock.calls.filter(([input]) => new URL(String(input)).pathname.endsWith("/items"))).toHaveLength(1);
  });

  it.each(actions)("rejects invalid tracks before any request for $label", async ({ define }) => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const tool = define(((definition: unknown) => definition) as never) as unknown as {
      execute(params: unknown, config: unknown, context: unknown): Promise<unknown>;
    };
    await expect(tool.execute({ id: "playlist1", uris: ["spotify:playlist:playlist1"] }, {}, {})).rejects.toThrow("Invalid Spotify track URI or ID");
    expect(fetch).not.toHaveBeenCalled();
  });
});
