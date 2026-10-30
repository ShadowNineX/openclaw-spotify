import type { SpotifyPluginConfig } from "../index";
import {
  getSpotifyPlaylistReference,
  getSpotifyUserClient,
  normalizeSpotifyTrackUris,
  type SpotifyRuntimeApi,
} from "../spotify";

export async function preparePlaylistTrackEdit(
  params: { id: string; uris: readonly string[] },
  config: SpotifyPluginConfig,
  api?: SpotifyRuntimeApi,
) {
  const uris = normalizeSpotifyTrackUris(params.uris);
  const client = await getSpotifyUserClient(config, api);
  const playlist = await getSpotifyPlaylistReference(client, params.id);
  return { client, playlist, uris };
}
