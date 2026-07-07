import { SpotifyApi } from "@spotify/web-api-ts-sdk";
import type {
  AccessToken,
  Album,
  Artist,
  Device,
  ItemTypes,
  Market,
  MaxInt,
  Page,
  PlaybackState,
  Playlist,
  PlaylistedTrack,
  Queue,
  SimplifiedAlbum,
  SimplifiedEpisode,
  SimplifiedPlaylist,
  SimplifiedTrack,
  Track,
  TrackItem,
  IAuthStrategy,
  SdkConfiguration,
} from "@spotify/web-api-ts-sdk";

export const SPOTIFY_SEARCH_TYPES = [
  "track",
  "artist",
  "album",
  "playlist",
] as const satisfies readonly ItemTypes[];

export type SpotifySearchType = (typeof SPOTIFY_SEARCH_TYPES)[number];
export type SpotifyLimit = Exclude<MaxInt<50>, 0>;

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
  register(key: string, value: T): void;
  lookup(key: string): T | undefined;
};

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
      openSyncKeyedStore?: <T>(options: {
        namespace: string;
        maxEntries: number;
        defaultTtlMs?: number;
        env?: NodeJS.ProcessEnv;
      }) => SpotifyTokenStore<T>;
    };
  };
};

type SpotifyPlaylistSummarySource = {
  collaborative: boolean;
  description: string;
  external_urls: {
    spotify: string;
  };
  followers?: {
    total: number;
  };
  id: string;
  images: Array<{
    url: string;
  }>;
  name: string;
  owner?: {
    display_name: string;
    external_urls: {
      spotify: string;
    };
    id: string;
    uri: string;
  };
  public: boolean;
  tracks?: {
    total: number;
  } | null;
  uri: string;
};

let cachedClient:
  | {
      cacheKey: string;
      sdk: SpotifyApi;
    }
  | undefined;

let cachedUserClient:
  | {
      cacheKey: string;
      sdk: SpotifyApi;
    }
  | undefined;
let lastSavedRefreshToken: string | undefined;

export const SPOTIFY_PLAYLIST_SCOPES = [
  "playlist-read-private",
  "playlist-read-collaborative",
  "playlist-modify-private",
  "playlist-modify-public",
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
export const DEFAULT_SPOTIFY_REDIRECT_URI =
  "http://127.0.0.1:4377/callback";
const SPOTIFY_OAUTH_STORE_NAMESPACE = "oauth";
const SPOTIFY_REFRESH_TOKEN_STORE_KEY = "user-refresh-token";

export function getSpotifyClient(config: SpotifyPluginConfig): SpotifyApi {
  const credentials = resolveSpotifyCredentials(config);
  const cacheKey = `${credentials.clientId}:${credentials.clientSecret}`;

  if (cachedClient?.cacheKey === cacheKey) {
    return cachedClient.sdk;
  }

  const sdk = SpotifyApi.withClientCredentials(
    credentials.clientId,
    credentials.clientSecret,
  );

  cachedClient = { cacheKey, sdk };
  return sdk;
}

export function getSpotifyUserClient(
  config: SpotifyPluginConfig,
  api?: SpotifyRuntimeApi,
): SpotifyApi {
  const credentials = resolveSpotifyCredentials(config);
  const refreshTokens = resolveSpotifyRefreshTokenCandidates(config, api);
  const cacheKey = [
    credentials.clientId,
    credentials.clientSecret,
    ...refreshTokens.map((token) => `${token.source}:${token.refreshToken}`),
  ].join(":");

  if (cachedUserClient?.cacheKey === cacheKey) {
    return cachedUserClient.sdk;
  }

  const sdk = new SpotifyApi(
    new SpotifyRefreshTokenAuthStrategy(credentials, refreshTokens, async (
      refreshToken,
    ) => {
      await saveSpotifyRefreshToken(api, { refreshToken });
    }),
  );

  cachedUserClient = { cacheKey, sdk };
  return sdk;
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

  if (openSpotifyOAuthStore(api)) {
    return "openclaw-plugin-state";
  }

  return "manual-config-or-env";
}

export async function saveSpotifyRefreshToken(
  api: SpotifyRuntimeApi | undefined,
  token: Omit<SpotifyOAuthTokenRecord, "savedAt">,
): Promise<SpotifyRefreshTokenPersistenceResult> {
  const configResult = await saveSpotifyRefreshTokenToConfig(api, token);

  if (configResult.persisted) {
    return configResult;
  }

  const stateResult = saveSpotifyRefreshTokenToState(api, token);

  if (stateResult.persisted) {
    return stateResult;
  }

  return {
    persisted: false,
    storage: "manual-config-or-env",
    error: configResult.error ?? stateResult.error,
  };
}

function saveSpotifyRefreshTokenToState(
  api: SpotifyRuntimeApi | undefined,
  token: Omit<SpotifyOAuthTokenRecord, "savedAt">,
): SpotifyRefreshTokenPersistenceResult {
  const store = openSpotifyOAuthStore(api);

  if (!store) {
    return {
      persisted: false,
      storage: "manual-config-or-env",
    };
  }

  try {
    store.register(SPOTIFY_REFRESH_TOKEN_STORE_KEY, {
      ...token,
      savedAt: new Date().toISOString(),
    });
    lastSavedRefreshToken = token.refreshToken;
    cachedUserClient = undefined;
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
        const spotify = ensureRecord(entries, "spotify");
        const config = ensureRecord(spotify, "config");

        if (spotify.enabled === undefined) {
          spotify.enabled = true;
        }

        config.refreshToken = token.refreshToken;
      },
    });

    lastSavedRefreshToken = token.refreshToken;
    cachedUserClient = undefined;
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
  const codeVerifier = createCodeVerifier();
  const codeChallenge = await createCodeChallenge(codeVerifier);
  const url = new URL("https://accounts.spotify.com/authorize");

  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", credentials.clientId);
  url.searchParams.set("scope", scopes.join(" "));
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("code_challenge", codeChallenge);

  if (showDialog) {
    url.searchParams.set("show_dialog", "true");
  }

  if (state) {
    url.searchParams.set("state", state);
  }

  return {
    authorizationUrl: url.toString(),
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

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: resolvedRedirectUri,
    client_id: credentials.clientId,
    code_verifier: codeVerifier,
  });
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Spotify OAuth token exchange failed: ${text}`);
  }

  const token = JSON.parse(text) as AccessToken & { scope?: string };

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
): Market | undefined {
  const market = firstNonEmptyString(value, config.market)?.toUpperCase();

  if (!market) {
    return undefined;
  }

  if (!/^[A-Z]{2}$/.test(market)) {
    throw new Error(
      `Spotify market must be a two-letter country code: ${market}`,
    );
  }

  return market as Market;
}

export function clampSpotifyLimit(
  value: number | undefined,
  fallback: SpotifyLimit,
): SpotifyLimit {
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

export function summarizeTrack(track: Track | SimplifiedTrack) {
  return {
    id: track.id,
    name: track.name,
    artists: track.artists.map((artist) => ({
      id: artist.id,
      name: artist.name,
      uri: artist.uri,
      url: artist.external_urls.spotify,
    })),
    album:
      "album" in track
        ? {
            id: track.album.id,
            name: track.album.name,
            releaseDate: track.album.release_date,
            uri: track.album.uri,
            url: track.album.external_urls.spotify,
          }
        : undefined,
    durationMs: track.duration_ms,
    explicit: track.explicit,
    popularity: "popularity" in track ? track.popularity : undefined,
    previewUrl: track.preview_url,
    trackNumber: track.track_number,
    discNumber: track.disc_number,
    uri: track.uri,
    url: track.external_urls.spotify,
  };
}

export function summarizeArtist(artist: Artist) {
  return {
    id: artist.id,
    name: artist.name,
    genres: artist.genres,
    followers: artist.followers.total,
    popularity: artist.popularity,
    image: artist.images[0]?.url,
    uri: artist.uri,
    url: artist.external_urls.spotify,
  };
}

export function summarizeAlbum(album: Album | SimplifiedAlbum) {
  return {
    id: album.id,
    name: album.name,
    albumType: album.album_type,
    artists: album.artists.map((artist) => ({
      id: artist.id,
      name: artist.name,
      uri: artist.uri,
      url: artist.external_urls.spotify,
    })),
    releaseDate: album.release_date,
    totalTracks: album.total_tracks,
    label: "label" in album ? album.label : undefined,
    popularity: "popularity" in album ? album.popularity : undefined,
    image: album.images[0]?.url,
    uri: album.uri,
    url: album.external_urls.spotify,
  };
}

export function summarizePlaylist(
  playlist: Playlist | SimplifiedPlaylist | SpotifyPlaylistSummarySource,
) {
  const trackReference =
    "tracks" in playlist && playlist.tracks ? playlist.tracks : undefined;

  return {
    id: playlist.id,
    name: playlist.name,
    description: playlist.description,
    owner: playlist.owner
      ? {
          id: playlist.owner.id,
          displayName: playlist.owner.display_name,
          uri: playlist.owner.uri,
          url: playlist.owner.external_urls.spotify,
        }
      : undefined,
    public: playlist.public,
    collaborative: playlist.collaborative,
    followers: playlist.followers?.total,
    totalTracks: trackReference?.total,
    image: playlist.images[0]?.url,
    uri: playlist.uri,
    url: playlist.external_urls.spotify,
  };
}

export function summarizePlaylistTrack(item: PlaylistedTrack<TrackItem>) {
  const track = item.track;

  if (track?.type !== "track") {
    return {
      addedAt: item.added_at,
      type: track?.type,
      name: track?.name,
      uri: track?.uri,
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
          url: playback.context.external_urls.spotify,
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

export function summarizePage<T>(
  page: Page<T>,
  summarize: (item: T) => unknown,
) {
  return {
    total: page.total,
    limit: page.limit,
    offset: page.offset,
    next: page.next,
    previous: page.previous,
    items: page.items.map(summarize),
  };
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
      "Spotify credentials are missing. Set plugins.entries.spotify.config.clientId/clientSecret or SPOTIFY_CLIENT_ID/SPOTIFY_CLIENT_SECRET.",
    );
  }

  return { clientId, clientSecret };
}

class SpotifyRefreshTokenAuthStrategy implements IAuthStrategy {
  private accessToken: AccessToken | null = null;
  private configuration: SdkConfiguration | undefined;
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

  setConfiguration(configuration: SdkConfiguration): void {
    this.configuration = configuration;
  }

  async getOrCreateAccessToken(): Promise<AccessToken> {
    if (
      this.accessToken &&
      (this.accessToken.expires ?? 0) > Date.now() + 60_000
    ) {
      return this.accessToken;
    }

    this.accessToken = await refreshSpotifyAccessTokenFromCandidates(
      this.credentials,
      this.refreshTokens,
      this.configuration?.fetch,
      (refreshToken) => this.handleRefreshTokenRotated(refreshToken),
    );
    return this.accessToken;
  }

  async getAccessToken(): Promise<AccessToken | null> {
    return this.accessToken;
  }

  removeAccessToken(): void {
    this.accessToken = null;
  }

  private async handleRefreshTokenRotated(refreshToken: string): Promise<void> {
    this.refreshTokens = dedupeRefreshTokenCandidates([
      {
        refreshToken,
        source: "last-oauth-login",
      },
      ...this.refreshTokens,
    ]);

    await this.onRefreshTokenRotated?.(refreshToken);
  }
}

export async function refreshSpotifyAccessToken(
  credentials: SpotifyCredentials,
  refreshToken: string,
  fetchImplementation: SdkConfiguration["fetch"] = fetch,
): Promise<AccessToken> {
  const body = new URLSearchParams({
    client_id: credentials.clientId,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const response = await fetchImplementation(
    "https://accounts.spotify.com/api/token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    },
  );
  const text = await response.text();

  if (!response.ok) {
    throw new SpotifyTokenRefreshError(
      `Spotify access token refresh failed: ${text}`,
      text,
    );
  }

  const token = JSON.parse(text) as Partial<AccessToken>;

  if (!token.access_token || !token.expires_in) {
    throw new Error("Spotify access token refresh returned an invalid token.");
  }

  return {
    access_token: token.access_token,
    token_type: token.token_type ?? "Bearer",
    expires_in: token.expires_in,
    refresh_token: token.refresh_token ?? refreshToken,
    expires: Date.now() + token.expires_in * 1000,
  };
}

async function refreshSpotifyAccessTokenFromCandidates(
  credentials: SpotifyCredentials,
  refreshTokens: readonly SpotifyRefreshTokenCandidate[],
  fetchImplementation: SdkConfiguration["fetch"] = fetch,
  onRefreshTokenRotated?: SpotifyRefreshTokenRotationHandler,
): Promise<AccessToken> {
  let invalidGrantError: unknown;

  for (const candidate of refreshTokens) {
    try {
      const accessToken = await refreshSpotifyAccessToken(
        credentials,
        candidate.refreshToken,
        fetchImplementation,
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
    `Spotify refresh token is expired, revoked, or invalid for every configured token source (${sources}). Run \`openclaw spotify auth login\` again, then remove stale plugins.entries.spotify.config.refreshToken or SPOTIFY_REFRESH_TOKEN values if they still override the saved login.${cause}`,
  );
}

function resolveSpotifyRefreshTokenCandidates(
  config: SpotifyPluginConfig,
  api?: SpotifyRuntimeApi,
): SpotifyRefreshTokenCandidate[] {
  const candidates = dedupeRefreshTokenCandidates([
    {
      refreshToken: firstNonEmptyString(lastSavedRefreshToken),
      source: "last-oauth-login",
    },
    {
      refreshToken: readStoredSpotifyRefreshToken(api),
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
      "Spotify OAuth refresh token is missing. Run `openclaw spotify auth login` on the OpenClaw host, or set plugins.entries.spotify.config.refreshToken or SPOTIFY_REFRESH_TOKEN.",
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

function readStoredSpotifyRefreshToken(
  api?: SpotifyRuntimeApi,
): string | undefined {
  const store = openSpotifyOAuthStore(api);
  const record = store?.lookup(SPOTIFY_REFRESH_TOKEN_STORE_KEY);

  return firstNonEmptyString(record?.refreshToken);
}

function openSpotifyOAuthStore(
  api?: SpotifyRuntimeApi,
): SpotifyTokenStore<SpotifyOAuthTokenRecord> | undefined {
  try {
    return api?.runtime?.state?.openSyncKeyedStore?.<SpotifyOAuthTokenRecord>({
      namespace: SPOTIFY_OAUTH_STORE_NAMESPACE,
      maxEntries: 1,
    });
  } catch {
    return undefined;
  }
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

function isSpotifyLimit(value: number): value is SpotifyLimit {
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
    return {
      type: "track",
      ...summarizeTrack(item as Track),
    };
  }

  return {
    type: "episode",
    id: item.id,
    name: item.name,
    description: (item as SimplifiedEpisode).description,
    durationMs: item.duration_ms,
    explicit: item.explicit,
    uri: item.uri,
    url: item.external_urls.spotify,
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

  if (url.hostname !== "open.spotify.com") {
    return undefined;
  }

  const [type, id] = url.pathname.split("/").filter(Boolean);

  if (!type || !id || !/^[A-Za-z0-9]+$/.test(id)) {
    return undefined;
  }

  return { type, id };
}

function createCodeVerifier(): string {
  const bytes = new Uint8Array(64);
  crypto.getRandomValues(bytes);

  return base64UrlEncode(bytes);
}

async function createCodeChallenge(codeVerifier: string): Promise<string> {
  const bytes = new TextEncoder().encode(codeVerifier);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return base64UrlEncode(new Uint8Array(digest));
}

function base64UrlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
