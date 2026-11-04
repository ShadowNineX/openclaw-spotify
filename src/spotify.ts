import {
  clientCredentialsToken,
  createAuthorizeUrl,
  createPkceChallenge,
  createSpotifyClient,
  exchangeAuthorizationCode as exchangeFoxifyAuthorizationCode,
  refreshAccessToken as refreshFoxifyAccessToken,
} from "@shadownine/foxify";
import { SPOTIFY_PLUGIN_ID } from "./index";
import type {
  Album,
  Artist,
  Device,
  Episode,
  FetchLike,
  Paging as Page,
  PlaybackState,
  Playlist,
  Queue,
  SearchType,
  SpotifyClient,
  TokenResponse,
  Track,
} from "@shadownine/foxify";

const SPOTIFY_SEARCH_TYPES = [
  "track",
  "artist",
  "album",
  "playlist",
] as const satisfies readonly SearchType[];

export type SpotifySearchType = (typeof SPOTIFY_SEARCH_TYPES)[number];
type SpotifyAccessToken = TokenResponse & {
  expires: number;
  refresh_token: string;
};
type TrackItem = Track | Episode;
type PlaylistedTrack = {
  added_at?: string;
  item?: TrackItem | null;
  track?: TrackItem | null;
};
type SpotifyExternalUrls = {
  spotify?: string;
};
type SpotifyImage = {
  url: string;
};
type SpotifyArtistReference = Artist & {
  external_urls?: SpotifyExternalUrls;
  followers?: {
    total: number;
  };
  genres?: string[];
  images?: SpotifyImage[];
  name?: string;
  popularity?: number;
  uri?: string;
};
type SpotifyAlbumReference = Album & {
  album_type?: string;
  artists?: SpotifyArtistReference[];
  external_urls?: SpotifyExternalUrls;
  images?: SpotifyImage[];
  label?: string;
  name?: string;
  popularity?: number;
  release_date?: string;
  total_tracks?: number;
  uri?: string;
};
type SpotifyTrackReference = Track & {
  album?: SpotifyAlbumReference;
  artists?: SpotifyArtistReference[];
  disc_number?: number;
  duration_ms?: number;
  explicit?: boolean;
  external_urls?: SpotifyExternalUrls;
  name?: string;
  popularity?: number;
  preview_url?: string | null;
  track_number?: number;
  uri?: string;
};
type SpotifyEpisodeReference = Episode & {
  description?: string;
  duration_ms?: number;
  explicit?: boolean;
  external_urls?: SpotifyExternalUrls;
  name?: string;
  uri?: string;
};

export type SpotifyPluginConfig = {
  clientId?: unknown;
  clientSecret?: unknown;
  market?: unknown;
  redirectUri?: unknown;
  refreshToken?: unknown;
};

export type SpotifyCredentials = {
  clientId: string;
  clientSecret: string;
};

export type SpotifyOAuthTokenRecord = {
  refreshToken: string;
  scope?: string;
  savedAt: string;
};

export type SpotifyRefreshTokenPersistenceResult = {
  persisted: boolean;
  storage: "openclaw-config" | "openclaw-plugin-state" | "manual-config-or-env";
  error?: string;
};

type SpotifyTokenStore<T> = {
  register(key: string, value: T): Promise<void>;
  lookup(key: string): Promise<T | undefined>;
};

type SpotifyTokenStoreOptions = {
  namespace: string;
  maxEntries: number;
  defaultTtlMs?: number;
  env?: NodeJS.ProcessEnv;
};

type SpotifyTokenStoreOpener = <T>(
  options: SpotifyTokenStoreOptions,
) => SpotifyTokenStore<T>;

type MutableRecord = Record<string, unknown>;
type SpotifyRefreshTokenSource =
  | "last-oauth-login"
  | "openclaw-plugin-state"
  | "openclaw-config"
  | "environment";

type SpotifyRefreshTokenCandidate = {
  refreshToken: string;
  source: SpotifyRefreshTokenSource;
};

type SpotifyRefreshTokenRotationHandler = (
  refreshToken: string,
) => Promise<void>;

export type SpotifyRuntimeApi = {
  runtime?: {
    config?: {
      mutateConfigFile?: <T>(options: {
        afterWrite: {
          mode: "auto";
        };
        mutate: (draft: MutableRecord) => T | Promise<T>;
      }) => Promise<unknown>;
    };
    state?: {
      openKeyedStoreV2?: SpotifyTokenStoreOpener;
      openKeyedStore?: SpotifyTokenStoreOpener;
    };
  };
};

type SpotifyPlaylistSummarySource = {
  collaborative?: boolean;
  description?: string;
  external_urls?: SpotifyExternalUrls;
  followers?: {
    total: number;
  };
  id: string;
  images?: Array<{
    url: string;
  }>;
  items?: {
    total: number;
  } | null;
  name?: string;
  owner?: {
    display_name?: string;
    external_urls?: SpotifyExternalUrls;
    id?: string;
    uri?: string;
  };
  public?: boolean | null;
  snapshot_id?: string;
  tracks?: {
    total: number;
  } | null;
  uri?: string;
};

let cachedClient:
  | {
      cacheKey: string;
      client: SpotifyClient;
    }
  | undefined;

let cachedUserClient:
  | {
      cacheKey: string;
      credentialsKey: string;
      client: SpotifyClient;
      tokenProvider: SpotifyRefreshTokenAuthProvider;
      api: SpotifyRuntimeApi | undefined;
    }
  | undefined;
const lastSavedRefreshTokensByRuntime = new WeakMap<
  SpotifyRuntimeApi,
  string
>();
const tokenVersionsByRuntime = new WeakMap<SpotifyRuntimeApi, number>();
const pendingTokenWritesByRuntime = new WeakMap<
  SpotifyRuntimeApi,
  Promise<SpotifyRefreshTokenPersistenceResult>
>();

export const SPOTIFY_PLAYLIST_SCOPES = [
  "playlist-read-private",
  "playlist-read-collaborative",
  "playlist-modify-private",
  "playlist-modify-public",
  "ugc-image-upload",
] as const;
export const SPOTIFY_PLAYBACK_SCOPES = [
  "user-read-playback-position",
  "user-read-playback-state",
  "user-read-currently-playing",
  "user-modify-playback-state",
  "app-remote-control",
  "streaming",
] as const;
export const SPOTIFY_USER_SCOPES = [
  ...SPOTIFY_PLAYLIST_SCOPES,
  ...SPOTIFY_PLAYBACK_SCOPES,
] as const;
const DEFAULT_SPOTIFY_REDIRECT_URI =
  "http://127.0.0.1:4377/callback";
const SPOTIFY_OAUTH_STORE_NAMESPACE = "oauth";
const SPOTIFY_REFRESH_TOKEN_STORE_KEY = "user-refresh-token";

export function getSpotifyClient(config: SpotifyPluginConfig): SpotifyClient {
  const credentials = resolveSpotifyCredentials(config);
  const cacheKey = `${credentials.clientId}:${credentials.clientSecret}`;

  if (cachedClient?.cacheKey === cacheKey) {
    return cachedClient.client;
  }

  const tokenProvider = new SpotifyClientCredentialsAuthProvider(credentials);
  const client = createSpotifyClient({
    getAccessToken: () => tokenProvider.getAccessToken(),
  });

  cachedClient = { cacheKey, client };
  return client;
}

export async function getSpotifyUserClient(
  config: SpotifyPluginConfig,
  api?: SpotifyRuntimeApi,
): Promise<SpotifyClient> {
  const credentials = resolveSpotifyCredentials(config);
  const refreshTokens = await resolveSpotifyRefreshTokenCandidates(config, api);
  const credentialsKey = `${credentials.clientId}:${credentials.clientSecret}`;
  const cacheKey = [
    credentials.clientId,
    credentials.clientSecret,
    ...refreshTokens.map((token) => `${token.source}:${token.refreshToken}`),
  ].join(":");

  if (
    cachedUserClient && cachedUserClient.api === api &&
    cachedUserClient.credentialsKey === credentialsKey &&
    (cachedUserClient.cacheKey === cacheKey ||
      cachedUserClient.tokenProvider.usesRotatedRefreshToken(refreshTokens[0]?.refreshToken))
  ) {
    cachedUserClient.tokenProvider.updateRefreshTokenCandidates(refreshTokens);
    cachedUserClient.cacheKey = cacheKey;
    return cachedUserClient.client;
  }

  let tokenVersion = api ? tokenVersionsByRuntime.get(api) ?? 0 : 0;
  const tokenProvider = new SpotifyRefreshTokenAuthProvider(
    credentials,
    refreshTokens,
    async (
      refreshToken,
    ) => {
      // A new login wins over an older client's in-flight refresh. Rotation
      // keeps this provider (and its valid access token) cached for later tools.
      if (api) {
        if ((tokenVersionsByRuntime.get(api) ?? 0) !== tokenVersion) return;
        tokenVersion = rememberSpotifyRefreshToken(api, refreshToken);
      }
      await persistSpotifyRefreshToken(api, { refreshToken });
    },
  );
  const client = createSpotifyClient({
    getAccessToken: () => tokenProvider.getAccessToken(),
  });

  cachedUserClient = { cacheKey, credentialsKey, client, tokenProvider, api };
  return client;
}

export function canPersistSpotifyRefreshToken(api?: SpotifyRuntimeApi): boolean {
  return getSpotifyRefreshTokenPersistenceTarget(api) !==
    "manual-config-or-env";
}

export function getSpotifyRefreshTokenPersistenceTarget(
  api?: SpotifyRuntimeApi,
): SpotifyRefreshTokenPersistenceResult["storage"] {
  if (api?.runtime?.config?.mutateConfigFile) {
    return "openclaw-config";
  }

  const state = api?.runtime?.state;
  if (
    typeof state?.openKeyedStoreV2 === "function" ||
    typeof state?.openKeyedStore === "function"
  ) {
    return "openclaw-plugin-state";
  }

  return "manual-config-or-env";
}

export async function saveSpotifyRefreshToken(
  api: SpotifyRuntimeApi | undefined,
  token: Omit<SpotifyOAuthTokenRecord, "savedAt">,
): Promise<SpotifyRefreshTokenPersistenceResult> {
  if (api) {
    rememberSpotifyRefreshToken(api, token.refreshToken);
  }
  cachedUserClient = undefined;

  return persistSpotifyRefreshToken(api, token);
}

function rememberSpotifyRefreshToken(api: SpotifyRuntimeApi, refreshToken: string): number {
  const version = (tokenVersionsByRuntime.get(api) ?? 0) + 1;
  tokenVersionsByRuntime.set(api, version);
  lastSavedRefreshTokensByRuntime.set(api, refreshToken);
  return version;
}

async function persistSpotifyRefreshToken(
  api: SpotifyRuntimeApi | undefined,
  token: Omit<SpotifyOAuthTokenRecord, "savedAt">,
): Promise<SpotifyRefreshTokenPersistenceResult> {
  // Preserve write order when a login and automatic rotation overlap. The
  // newest token must also be the final value on disk, not only in memory.
  const previous = api ? pendingTokenWritesByRuntime.get(api) : undefined;
  const commit = () => persistSpotifyRefreshTokenNow(api, token);
  const pending = previous ? previous.then(commit, commit) : commit();
  if (api) pendingTokenWritesByRuntime.set(api, pending);
  try {
    return await pending;
  } finally {
    if (api && pendingTokenWritesByRuntime.get(api) === pending) {
      pendingTokenWritesByRuntime.delete(api);
    }
  }
}

async function persistSpotifyRefreshTokenNow(
  api: SpotifyRuntimeApi | undefined,
  token: Omit<SpotifyOAuthTokenRecord, "savedAt">,
): Promise<SpotifyRefreshTokenPersistenceResult> {
  const configResult = await saveSpotifyRefreshTokenToConfig(api, token);

  if (configResult.persisted) {
    return configResult;
  }

  const stateResult = await saveSpotifyRefreshTokenToState(api, token);

  if (stateResult.persisted) {
    return stateResult;
  }

  const errors = [
    configResult.error
      ? `openclaw-config: ${configResult.error}`
      : undefined,
    stateResult.error
      ? `openclaw-plugin-state: ${stateResult.error}`
      : undefined,
  ].filter((error): error is string => error !== undefined);

  return {
    persisted: false,
    storage: "manual-config-or-env",
    error: errors.length > 0 ? errors.join("; ") : undefined,
  };
}

async function saveSpotifyRefreshTokenToState(
  api: SpotifyRuntimeApi | undefined,
  token: Omit<SpotifyOAuthTokenRecord, "savedAt">,
): Promise<SpotifyRefreshTokenPersistenceResult> {
  try {
    const store = openSpotifyOAuthStore(api);
    if (!store) {
      return { persisted: false, storage: "manual-config-or-env" };
    }

    await store.register(SPOTIFY_REFRESH_TOKEN_STORE_KEY, {
      ...token,
      savedAt: new Date().toISOString(),
    });
    return {
      persisted: true,
      storage: "openclaw-plugin-state",
    };
  } catch (error) {
    return {
      persisted: false,
      storage: "manual-config-or-env",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function saveSpotifyRefreshTokenToConfig(
  api: SpotifyRuntimeApi | undefined,
  token: Omit<SpotifyOAuthTokenRecord, "savedAt">,
): Promise<SpotifyRefreshTokenPersistenceResult> {
  const mutateConfigFile = api?.runtime?.config?.mutateConfigFile;

  if (!mutateConfigFile) {
    return {
      persisted: false,
      storage: "manual-config-or-env",
    };
  }

  try {
    await mutateConfigFile({
      afterWrite: {
        mode: "auto",
      },
      mutate: (draft) => {
        const plugins = ensureRecord(draft, "plugins");
        const entries = ensureRecord(plugins, "entries");
        const spotify = ensureRecord(entries, SPOTIFY_PLUGIN_ID);
        const config = ensureRecord(spotify, "config");

        if (spotify.enabled === undefined) {
          spotify.enabled = true;
        }

        config.refreshToken = token.refreshToken;
      },
    });

    return {
      persisted: true,
      storage: "openclaw-config",
    };
  } catch (error) {
    return {
      persisted: false,
      storage: "manual-config-or-env",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function buildSpotifyAuthorizationUrl(
  config: SpotifyPluginConfig,
  scopes: readonly string[] = SPOTIFY_PLAYLIST_SCOPES,
  state?: string,
  showDialog = false,
) {
  const credentials = resolveSpotifyCredentials(config);
  const redirectUri = resolveSpotifyRedirectUri(config);
  const { codeVerifier, codeChallenge, codeChallengeMethod } =
    await createPkceChallenge();

  return {
    authorizationUrl: createAuthorizeUrl({
      clientId: credentials.clientId,
      redirectUri,
      scopes,
      state,
      showDialog,
      codeChallenge,
      codeChallengeMethod,
    }),
    codeVerifier,
    redirectUri,
    scopes,
  };
}

export async function exchangeSpotifyAuthorizationCode(
  config: SpotifyPluginConfig,
  code: string,
  codeVerifier: string,
  redirectUri?: string,
) {
  const credentials = resolveSpotifyCredentials(config);
  const resolvedRedirectUri = firstNonEmptyString(
    redirectUri,
    config.redirectUri,
    process.env.SPOTIFY_REDIRECT_URI,
  ) ?? DEFAULT_SPOTIFY_REDIRECT_URI;
  const token = await exchangeFoxifyAuthorizationCode({
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
    code,
    codeVerifier,
    redirectUri: resolvedRedirectUri,
  });

  if (!token.access_token || !token.refresh_token) {
    throw new Error("Spotify OAuth token exchange returned an invalid token.");
  }

  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    tokenType: token.token_type,
    expiresIn: token.expires_in,
    scope: token.scope,
  };
}

export function resolveSpotifyMarket(
  value: string | undefined,
  config: SpotifyPluginConfig,
): string | undefined {
  const market = firstNonEmptyString(value, config.market)?.toUpperCase();

  if (!market) {
    return undefined;
  }

  if (!/^[A-Z]{2}$/.test(market)) {
    throw new Error(
      `Spotify market must be a two-letter country code: ${market}`,
    );
  }

  return market;
}

export function clampSpotifyLimit(
  value: number | undefined,
  fallback: number,
): number {
  const limit = value ?? fallback;

  if (!isSpotifyLimit(limit)) {
    throw new Error("Spotify limit must be an integer from 1 to 50.");
  }

  return limit;
}

export function clampSpotifyOffset(value: number | undefined): number {
  if (value === undefined) {
    return 0;
  }

  if (!Number.isInteger(value) || value < 0) {
    throw new Error("Spotify offset must be a non-negative integer.");
  }

  return value;
}

export function normalizeSpotifyTrackUris(uris: readonly string[]): string[] {
  if (uris.length === 0 || uris.length > 100) {
    throw new Error("Spotify track URI list must contain 1 to 100 items.");
  }

  return uris.map((uri) => normalizeSpotifyTrackUri(uri));
}

export function normalizeSpotifyPlayableUri(value: string): string {
  const trimmed = value.trim();

  if (/^spotify:(track|episode):[A-Za-z0-9]+$/.test(trimmed)) {
    return trimmed;
  }

  const url = parseSpotifyUrl(trimmed);

  if (url && (url.type === "track" || url.type === "episode")) {
    return `spotify:${url.type}:${url.id}`;
  }

  if (/^[A-Za-z0-9]+$/.test(trimmed)) {
    return `spotify:track:${trimmed}`;
  }

  throw new Error(`Invalid Spotify track, episode URI, URL, or ID: ${value}`);
}

export function normalizeSpotifyContextUri(value: string): string {
  const trimmed = value.trim();

  if (/^spotify:(album|artist|playlist|show):[A-Za-z0-9]+$/.test(trimmed)) {
    return trimmed;
  }

  const url = parseSpotifyUrl(trimmed);

  if (
    url &&
    (url.type === "album" ||
      url.type === "artist" ||
      url.type === "playlist" ||
      url.type === "show")
  ) {
    return `spotify:${url.type}:${url.id}`;
  }

  throw new Error(`Invalid Spotify context URI or URL: ${value}`);
}

/** Normalize a catalog reference without accidentally looking up another kind. */
export function normalizeSpotifyCatalogId(
  value: string,
  type: "track" | "artist" | "album",
): string {
  const trimmed = value.trim();
  const uriMatch = new RegExp(`^spotify:${type}:([A-Za-z0-9]+)$`).exec(trimmed);
  if (uriMatch?.[1]) {
    return uriMatch[1];
  }

  const url = parseSpotifyUrl(trimmed);
  if (url?.type === type) {
    return url.id;
  }

  if (/^[A-Za-z0-9]+$/.test(trimmed)) {
    return trimmed;
  }

  throw new Error(`Invalid Spotify ${type} ID, URI, or URL: ${value}`);
}

/** Accept the playlist formats people commonly paste into chat and API calls. */
export function normalizeSpotifyPlaylistId(value: string): string {
  const trimmed = value.trim();
  const uriMatch = /^spotify:playlist:([A-Za-z0-9_-]+)$/.exec(trimmed);

  if (uriMatch?.[1]) {
    return uriMatch[1];
  }

  const url = parseSpotifyUrl(trimmed);

  if (url?.type === "playlist") {
    return url.id;
  }

  if (/^[A-Za-z0-9_-]+$/.test(trimmed)) {
    return trimmed;
  }

  throw new Error(`Invalid Spotify playlist ID, URI, or URL: ${value}`);
}

export async function getSpotifyPlaylistReference(
  client: SpotifyClient,
  value: string,
): Promise<{ id: string; name?: string; uri: string; url: string }> {
  const id = normalizeSpotifyPlaylistId(value);

  try {
    const playlist = await client.playlists.get(id);

    return {
      id,
      name: playlist.name?.trim() || undefined,
      uri: playlist.uri ?? `spotify:playlist:${id}`,
      url:
        playlist.external_urls?.spotify ??
        `https://open.spotify.com/playlist/${id}`,
    };
  } catch {
    // A metadata read can occasionally be unavailable even though a write is
    // permitted. Keep the requested operation usable and return stable links.
    return {
      id,
      uri: `spotify:playlist:${id}`,
      url: `https://open.spotify.com/playlist/${id}`,
    };
  }
}

export function summarizeTrack(track: Track) {
  const source = track as SpotifyTrackReference;
  const artists = source.artists ?? [];
  const album = source.album;

  return {
    type: "track",
    id: source.id,
    name: source.name,
    artists: artists.map((artist) => ({
      id: artist.id,
      name: artist.name,
      uri: artist.uri,
      url: artist.external_urls?.spotify,
    })),
    album: album
        ? {
            id: album.id,
            name: album.name,
            releaseDate: album.release_date,
            uri: album.uri,
            url: album.external_urls?.spotify,
          }
        : undefined,
    durationMs: source.duration_ms,
    explicit: source.explicit,
    popularity: source.popularity,
    previewUrl: source.preview_url,
    trackNumber: source.track_number,
    discNumber: source.disc_number,
    uri: source.uri,
    url: source.external_urls?.spotify,
  };
}

export function summarizeArtist(artist: Artist) {
  const source = artist as SpotifyArtistReference;

  return {
    id: source.id,
    name: source.name,
    genres: source.genres,
    followers: source.followers?.total,
    popularity: source.popularity,
    image: source.images?.[0]?.url,
    uri: source.uri,
    url: source.external_urls?.spotify,
  };
}

export function summarizeAlbum(album: Album) {
  const source = album as SpotifyAlbumReference;
  const artists = source.artists ?? [];

  return {
    id: source.id,
    name: source.name,
    albumType: source.album_type,
    artists: artists.map((artist) => ({
      id: artist.id,
      name: artist.name,
      uri: artist.uri,
      url: artist.external_urls?.spotify,
    })),
    releaseDate: source.release_date,
    totalTracks: source.total_tracks,
    label: source.label,
    popularity: source.popularity,
    image: source.images?.[0]?.url,
    uri: source.uri,
    url: source.external_urls?.spotify,
  };
}

export function summarizePlaylist(
  playlist: Playlist | SpotifyPlaylistSummarySource,
) {
  const source = playlist as Playlist & SpotifyPlaylistSummarySource;
  const trackReference = source.tracks;

  return {
    id: source.id,
    name: source.name,
    description: source.description,
    owner: source.owner
      ? {
          id: source.owner.id,
          displayName: source.owner.display_name,
          uri: source.owner.uri,
          url: source.owner.external_urls?.spotify,
        }
      : undefined,
    visibility: {
      hiddenFromProfile:
        source.public == null ? null : !source.public,
      searchable: source.public ?? null,
      linkAccessRestricted: false,
      note:
        "Profile visibility is not playlist privacy. Spotify's Web API cannot restrict access; anyone with the link can still open this playlist.",
    },
    collaborative: source.collaborative,
    followers: source.followers?.total,
    snapshotId: source.snapshot_id,
    totalTracks: source.items?.total ?? trackReference?.total,
    image: source.images?.[0]?.url,
    uri: source.uri,
    url: source.external_urls?.spotify,
  };
}

export function summarizePlaylistTrack(item: PlaylistedTrack | null) {
  if (!item) {
    return { unavailable: true };
  }

  const track = item.track ?? item.item;

  if (!track) {
    return {
      addedAt: item.added_at,
      unavailable: true,
    };
  }

  if (track.type !== "track") {
    const source = track as SpotifyEpisodeReference;

    return {
      addedAt: item.added_at,
      type: source.type,
      id: source.id,
      name: source.name,
      uri: source.uri,
      url: source.external_urls?.spotify,
    };
  }

  return {
    addedAt: item.added_at,
    ...summarizeTrack(track as Track),
  };
}

export function summarizeDevice(device: Device) {
  return {
    id: device.id,
    name: device.name,
    type: device.type,
    active: device.is_active,
    restricted: device.is_restricted,
    privateSession: device.is_private_session,
    volumePercent: device.volume_percent,
  };
}

export function summarizePlaybackState(playback: PlaybackState | null) {
  if (!playback) {
    return {
      active: false,
      isPlaying: false,
    };
  }

  return {
    active: true,
    isPlaying: playback.is_playing,
    progressMs: playback.progress_ms,
    timestamp: playback.timestamp,
    repeatState: playback.repeat_state,
    shuffleState: playback.shuffle_state,
    currentlyPlayingType: playback.currently_playing_type,
    device: playback.device ? summarizeDevice(playback.device) : undefined,
    context: playback.context
      ? {
          type: playback.context.type,
          uri: playback.context.uri,
          url: (
            playback.context.external_urls as SpotifyExternalUrls | undefined
          )?.spotify,
        }
      : undefined,
    item: summarizeTrackItem(playback.item),
    actions: playback.actions,
  };
}

export function summarizeQueue(queue: Queue) {
  return {
    currentlyPlaying: summarizeTrackItem(queue.currently_playing),
    queue: queue.queue.map(summarizeTrackItem),
  };
}

export function summarizePage<T, TSummary>(
  page: Page<T | null>,
  summarize: (item: T, index: number) => TSummary,
) {
  const hasMore = page.items.length > 0 && page.next !== null;
  const nextOffset = hasMore
    ? getSpotifyPageOffset(page.next) ?? page.offset + page.limit
    : null;

  return {
    total: page.total,
    limit: page.limit,
    offset: page.offset,
    next: page.next,
    previous: page.previous,
    hasMore,
    nextOffset,
    items: page.items.map((item, index) =>
      item === null ? { unavailable: true } : summarize(item, index),
    ),
  };
}

function getSpotifyPageOffset(next: string | null): number | undefined {
  if (!next) {
    return undefined;
  }

  try {
    const offset = new URL(next).searchParams.get("offset");

    if (offset === null || !/^\d+$/.test(offset)) {
      return undefined;
    }

    return Number(offset);
  } catch {
    return undefined;
  }
}

function resolveSpotifyCredentials(
  config: SpotifyPluginConfig,
): SpotifyCredentials {
  const clientId = firstNonEmptyString(
    config.clientId,
    process.env.SPOTIFY_CLIENT_ID,
  );
  const clientSecret = firstNonEmptyString(
    config.clientSecret,
    process.env.SPOTIFY_CLIENT_SECRET,
  );

  if (!clientId || !clientSecret) {
    throw new Error(
      `Spotify credentials are missing. Set plugins.entries.${SPOTIFY_PLUGIN_ID}.config.clientId/clientSecret or SPOTIFY_CLIENT_ID/SPOTIFY_CLIENT_SECRET.`,
    );
  }

  return { clientId, clientSecret };
}

class SpotifyClientCredentialsAuthProvider {
  private accessToken: SpotifyAccessToken | null = null;
  private pendingAccessToken: Promise<string> | undefined;

  constructor(private readonly credentials: SpotifyCredentials) {}

  async getAccessToken(): Promise<string> {
    if (this.accessToken && this.accessToken.expires > Date.now() + 60_000) {
      return this.accessToken.access_token;
    }

    this.pendingAccessToken ??= this.requestAccessToken().finally(() => {
      this.pendingAccessToken = undefined;
    });
    return this.pendingAccessToken;
  }

  private async requestAccessToken(): Promise<string> {
    const token = await clientCredentialsToken({
      clientId: this.credentials.clientId,
      clientSecret: this.credentials.clientSecret,
    });

    if (!token.access_token || !token.expires_in) {
      throw new Error(
        "Spotify client credentials token request returned an invalid token.",
      );
    }

    this.accessToken = {
      access_token: token.access_token,
      token_type: normalizeSpotifyTokenType(token.token_type),
      expires_in: token.expires_in,
      refresh_token: "",
      expires: Date.now() + token.expires_in * 1000,
    };

    return this.accessToken.access_token;
  }
}

class SpotifyRefreshTokenAuthProvider {
  private accessToken: SpotifyAccessToken | null = null;
  private pendingAccessToken: Promise<string> | undefined;
  private rotatedRefreshToken: string | undefined;
  private refreshTokens: SpotifyRefreshTokenCandidate[];

  constructor(
    private readonly credentials: SpotifyCredentials,
    refreshTokens: readonly SpotifyRefreshTokenCandidate[],
    private readonly onRefreshTokenRotated:
      | SpotifyRefreshTokenRotationHandler
      | undefined,
  ) {
    this.refreshTokens = [...refreshTokens];
  }

  usesRotatedRefreshToken(refreshToken: string | undefined): boolean {
    return refreshToken !== undefined && refreshToken === this.rotatedRefreshToken;
  }

  updateRefreshTokenCandidates(candidates: readonly SpotifyRefreshTokenCandidate[]): void {
    this.refreshTokens = dedupeRefreshTokenCandidates([
      { refreshToken: this.rotatedRefreshToken, source: "last-oauth-login" },
      ...candidates,
    ]);
  }

  async getAccessToken(): Promise<string> {
    if (this.accessToken && this.accessToken.expires > Date.now() + 60_000) {
      return this.accessToken.access_token;
    }

    // Concurrent tools must share refresh and persistence: a rotated token may
    // invalidate the previous one before a second refresh request reaches Spotify.
    this.pendingAccessToken ??= this.requestAccessToken().finally(() => {
      this.pendingAccessToken = undefined;
    });
    return this.pendingAccessToken;
  }

  private async requestAccessToken(): Promise<string> {
    this.accessToken = await refreshSpotifyAccessTokenFromCandidates(
      this.credentials,
      this.refreshTokens,
      (refreshToken) => this.handleRefreshTokenRotated(refreshToken),
    );

    return this.accessToken.access_token;
  }

  private async handleRefreshTokenRotated(refreshToken: string): Promise<void> {
    this.rotatedRefreshToken = refreshToken;
    this.updateRefreshTokenCandidates(this.refreshTokens);

    await this.onRefreshTokenRotated?.(refreshToken);
  }
}

export async function refreshSpotifyAccessToken(
  credentials: SpotifyCredentials,
  refreshToken: string,
  fetchImplementation: FetchLike = fetch,
): Promise<SpotifyAccessToken> {
  const token = await refreshFoxifyAccessToken({
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
    refreshToken,
    fetch: fetchImplementation,
  }).catch((error) => {
    throw new SpotifyTokenRefreshError(
      `Spotify access token refresh failed: ${String(error)}`,
      serializeErrorForInvalidGrantDetection(error),
    );
  });

  if (!token.access_token || !token.expires_in) {
    throw new Error("Spotify access token refresh returned an invalid token.");
  }

  return {
    access_token: token.access_token,
    token_type: normalizeSpotifyTokenType(token.token_type),
    expires_in: token.expires_in,
    refresh_token: token.refresh_token ?? refreshToken,
    expires: Date.now() + token.expires_in * 1000,
  };
}

async function refreshSpotifyAccessTokenFromCandidates(
  credentials: SpotifyCredentials,
  refreshTokens: readonly SpotifyRefreshTokenCandidate[],
  onRefreshTokenRotated?: SpotifyRefreshTokenRotationHandler,
): Promise<SpotifyAccessToken> {
  let invalidGrantError: unknown;

  for (const candidate of refreshTokens) {
    try {
      const accessToken = await refreshSpotifyAccessToken(
        credentials,
        candidate.refreshToken,
      );

      if (accessToken.refresh_token !== candidate.refreshToken) {
        await onRefreshTokenRotated?.(accessToken.refresh_token);
      }

      return accessToken;
    } catch (error) {
      if (!isInvalidGrantError(error)) {
        throw error;
      }

      invalidGrantError = error;
    }
  }

  const sources = refreshTokens.map((candidate) => candidate.source).join(", ");
  const cause =
    invalidGrantError instanceof Error
      ? ` Last Spotify error: ${invalidGrantError.message}`
      : "";

  throw new Error(
    `Spotify refresh token is expired, revoked, or invalid for every configured token source (${sources}). Run \`openclaw spotify auth login\` again, then remove stale plugins.entries.${SPOTIFY_PLUGIN_ID}.config.refreshToken or SPOTIFY_REFRESH_TOKEN values if they still override the saved login.${cause}`,
  );
}

async function resolveSpotifyRefreshTokenCandidates(
  config: SpotifyPluginConfig,
  api?: SpotifyRuntimeApi,
): Promise<SpotifyRefreshTokenCandidate[]> {
  const storedRefreshToken = await readStoredSpotifyRefreshToken(api);
  // A login may finish while the store read is pending. Read the runtime's
  // newest saved token after that await so the completed login still wins.
  const candidates = dedupeRefreshTokenCandidates([
    {
      refreshToken: firstNonEmptyString(
        api ? lastSavedRefreshTokensByRuntime.get(api) : undefined,
      ),
      source: "last-oauth-login",
    },
    {
      refreshToken: storedRefreshToken,
      source: "openclaw-plugin-state",
    },
    {
      refreshToken: firstNonEmptyString(config.refreshToken),
      source: "openclaw-config",
    },
    {
      refreshToken: firstNonEmptyString(process.env.SPOTIFY_REFRESH_TOKEN),
      source: "environment",
    },
  ]);

  if (candidates.length === 0) {
    throw new Error(
      `Spotify OAuth refresh token is missing. Run \`openclaw spotify auth login\` on the OpenClaw host, or set plugins.entries.${SPOTIFY_PLUGIN_ID}.config.refreshToken or SPOTIFY_REFRESH_TOKEN.`,
    );
  }

  return candidates;
}

function dedupeRefreshTokenCandidates(
  candidates: Array<{
    refreshToken: string | undefined;
    source: SpotifyRefreshTokenSource;
  }>,
): SpotifyRefreshTokenCandidate[] {
  const seen = new Set<string>();
  const resolved: SpotifyRefreshTokenCandidate[] = [];

  for (const candidate of candidates) {
    if (!candidate.refreshToken || seen.has(candidate.refreshToken)) {
      continue;
    }

    seen.add(candidate.refreshToken);
    resolved.push({
      refreshToken: candidate.refreshToken,
      source: candidate.source,
    });
  }

  return resolved;
}

function ensureRecord(parent: MutableRecord, key: string): MutableRecord {
  const value = parent[key];

  if (isMutableRecord(value)) {
    return value;
  }

  const next: MutableRecord = {};
  parent[key] = next;
  return next;
}

function isMutableRecord(value: unknown): value is MutableRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveSpotifyRedirectUri(config: SpotifyPluginConfig): string {
  return (
    firstNonEmptyString(
      config.redirectUri,
      process.env.SPOTIFY_REDIRECT_URI,
    ) ?? DEFAULT_SPOTIFY_REDIRECT_URI
  );
}

async function readStoredSpotifyRefreshToken(
  api?: SpotifyRuntimeApi,
): Promise<string | undefined> {
  const store = openSpotifyOAuthStore(api);
  const record = await store?.lookup(SPOTIFY_REFRESH_TOKEN_STORE_KEY);

  return firstNonEmptyString(record?.refreshToken);
}

function openSpotifyOAuthStore(
  api?: SpotifyRuntimeApi,
): SpotifyTokenStore<SpotifyOAuthTokenRecord> | undefined {
  const state = api?.runtime?.state;
  const options = { namespace: SPOTIFY_OAUTH_STORE_NAMESPACE, maxEntries: 1 };
  if (typeof state?.openKeyedStoreV2 === "function") {
    return state.openKeyedStoreV2<SpotifyOAuthTokenRecord>(options);
  }

  // Older supported gateways expose the async data operations on this opener.
  return state?.openKeyedStore?.<SpotifyOAuthTokenRecord>(options);
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }

    const trimmed = value.trim();

    if (trimmed) {
      return trimmed;
    }
  }

  return undefined;
}

class SpotifyTokenRefreshError extends Error {
  constructor(
    message: string,
    readonly responseBody: string,
  ) {
    super(message);
    this.name = "SpotifyTokenRefreshError";
  }
}

function isInvalidGrantError(error: unknown): boolean {
  if (!(error instanceof SpotifyTokenRefreshError)) {
    return false;
  }

  try {
    const body = JSON.parse(error.responseBody) as { error?: unknown };

    return body.error === "invalid_grant";
  } catch {
    return error.responseBody.includes("invalid_grant");
  }
}

function serializeErrorForInvalidGrantDetection(error: unknown): string {
  const parts: string[] = [];
  const seen = new WeakSet<object>();

  const collect = (value: unknown, depth: number): void => {
    if (value === undefined || value === null || depth > 4) {
      return;
    }

    if (typeof value === "string") {
      parts.push(value);
      return;
    }

    if (value instanceof Error) {
      parts.push(value.name, value.message);
      collect((value as { cause?: unknown }).cause, depth + 1);
      return;
    }

    if (typeof value !== "object") {
      parts.push(serializePrimitive(value));
      return;
    }

    if (seen.has(value)) {
      return;
    }

    seen.add(value);

    parts.push(serializeObject(value));

    const record = value as Record<string, unknown>;
    collect(record.error, depth + 1);
    collect(record.error_description, depth + 1);
    collect(record.cause, depth + 1);
  };

  collect(error, 0);
  return parts.join(" ");
}

function normalizeSpotifyTokenType(value: string | undefined): string {
  return value?.toLowerCase() === "bearer" ? "Bearer" : (value ?? "Bearer");
}

function serializePrimitive(value: unknown): string {
  switch (typeof value) {
    case "number":
    case "boolean":
    case "bigint":
      return value.toString();
    case "symbol":
      return value.description ?? value.toString();
    case "function":
      return "[function]";
    case "undefined":
      return "undefined";
    default:
      return "[unknown primitive]";
  }
}

function serializeObject(value: object): string {
  try {
    return JSON.stringify(value) ?? "[unserializable object]";
  } catch {
    return "[unserializable object]";
  }
}

function isSpotifyLimit(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 50;
}

function normalizeSpotifyTrackUri(value: string): string {
  const trimmed = value.trim();

  if (/^spotify:track:[A-Za-z0-9]+$/.test(trimmed)) {
    return trimmed;
  }

  const url = parseSpotifyUrl(trimmed);

  if (url?.type === "track") {
    return `spotify:track:${url.id}`;
  }

  if (/^[A-Za-z0-9]+$/.test(trimmed)) {
    return `spotify:track:${trimmed}`;
  }

  throw new Error(`Invalid Spotify track URI or ID: ${value}`);
}

function summarizeTrackItem(item: TrackItem | null | undefined) {
  if (!item) {
    return undefined;
  }

  if (item.type === "track") {
    return summarizeTrack(item as Track);
  }

  const episode = item as SpotifyEpisodeReference;

  return {
    type: "episode",
    id: episode.id,
    name: episode.name,
    description: episode.description,
    durationMs: episode.duration_ms,
    explicit: episode.explicit,
    uri: episode.uri,
    url: episode.external_urls?.spotify,
  };
}

function parseSpotifyUrl(
  value: string,
): { type: string; id: string } | undefined {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    return undefined;
  }

  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.hostname !== "open.spotify.com" ||
    url.username || url.password || url.port
  ) {
    return undefined;
  }

  const segments = url.pathname.split("/").filter(Boolean);
  if (/^intl-[a-z]{2}(?:-[a-z]{2})?$/i.test(segments[0] ?? "")) {
    segments.shift();
  }
  if (segments[0] === "embed") {
    segments.shift();
  }
  const [type, id] = segments;

  if (segments.length !== 2 || !type || !id || !/^[A-Za-z0-9]+$/.test(id)) {
    return undefined;
  }

  return { type, id };
}
