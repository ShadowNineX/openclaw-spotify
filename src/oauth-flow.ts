import { createServer, type Server, type ServerResponse } from "node:http";

import {
  buildSpotifyAuthorizationUrl,
  canPersistSpotifyRefreshToken,
  exchangeSpotifyAuthorizationCode,
  saveSpotifyRefreshToken,
  SPOTIFY_USER_SCOPES,
  type SpotifyRuntimeApi,
  type SpotifyPluginConfig,
} from "./spotify";

type ActiveOauthFlow = {
  server: Server;
  state: string;
  timeout: ReturnType<typeof setTimeout>;
};

type CompletedOauthFlow = {
  completedAt: string;
  persisted: boolean;
  refreshToken?: string;
  scope?: string;
};

let activeFlow: ActiveOauthFlow | undefined;
let completedFlow: CompletedOauthFlow | undefined;

export async function startSpotifyOauthFlow(
  config: SpotifyPluginConfig,
  options: {
    api?: SpotifyRuntimeApi;
    scopes?: readonly string[];
    state?: string;
    timeoutSeconds?: number;
  },
) {
  stopActiveFlow();

  const state = options.state ?? crypto.randomUUID();
  const timeoutMs = clampTimeoutSeconds(options.timeoutSeconds) * 1000;
  const auth = await buildSpotifyAuthorizationUrl(
    config,
    options.scopes ?? SPOTIFY_USER_SCOPES,
    state,
  );
  const redirectUrl = new URL(auth.redirectUri);

  if (!isLocalhost(redirectUrl.hostname)) {
    throw new Error(
      "Spotify OAuth callback helper only supports localhost redirect URIs.",
    );
  }

  const server = createServer(async (req, res) => {
    const requestUrl = new URL(req.url ?? "/", auth.redirectUri);

    if (requestUrl.pathname !== redirectUrl.pathname) {
      writeText(res, 404, "Spotify OAuth callback route not found.");
      return;
    }

    const error = requestUrl.searchParams.get("error");

    if (error) {
      writeHtml(res, 400, renderHtml("Spotify OAuth failed", error));
      stopActiveFlow();
      return;
    }

    if (requestUrl.searchParams.get("state") !== state) {
      writeHtml(
        res,
        400,
        renderHtml("Spotify OAuth failed", "State mismatch."),
      );
      stopActiveFlow();
      return;
    }

    const code = requestUrl.searchParams.get("code");

    if (!code) {
      writeHtml(
        res,
        400,
        renderHtml("Spotify OAuth failed", "Missing authorization code."),
      );
      stopActiveFlow();
      return;
    }

    try {
      const token = await exchangeSpotifyAuthorizationCode(
        config,
        code,
        auth.codeVerifier,
        auth.redirectUri,
      );
      const persisted = saveSpotifyRefreshToken(options.api, {
        refreshToken: token.refreshToken,
        scope: token.scope,
      });

      completedFlow = {
        completedAt: new Date().toISOString(),
        persisted,
        refreshToken: persisted ? undefined : token.refreshToken,
        scope: token.scope,
      };

      writeHtml(
        res,
        200,
        renderHtml(
          "Spotify OAuth complete",
          persisted
            ? "Refresh token saved to OpenClaw plugin state. You can close this page."
            : "OpenClaw plugin state was unavailable, so copy this refresh token into plugins.entries.spotify.config.refreshToken or SPOTIFY_REFRESH_TOKEN.",
          persisted ? undefined : token.refreshToken,
        ),
      );
    } catch (error_) {
      writeHtml(
        res,
        500,
        renderHtml(
          "Spotify OAuth failed",
          error_ instanceof Error ? error_.message : String(error_),
        ),
      );
    } finally {
      stopActiveFlow();
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(Number(redirectUrl.port), redirectUrl.hostname, () => {
      server.off("error", reject);
      resolve();
    });
  });

  activeFlow = {
    server,
    state,
    timeout: setTimeout(stopActiveFlow, timeoutMs),
  };

  return {
    authorizationUrl: auth.authorizationUrl,
    callbackUrl: auth.redirectUri,
    expiresAt: new Date(Date.now() + timeoutMs).toISOString(),
    persistence: canPersistSpotifyRefreshToken(options.api)
      ? {
          enabled: true,
          storage: "openclaw-plugin-state",
        }
      : {
          enabled: false,
          storage: "manual-config-or-env",
        },
    scopes: auth.scopes,
  };
}

export function getSpotifyOauthFlowStatus() {
  return {
    active: Boolean(activeFlow),
    completed: completedFlow,
  };
}

function stopActiveFlow(): void {
  if (!activeFlow) {
    return;
  }

  clearTimeout(activeFlow.timeout);
  activeFlow.server.close();
  activeFlow = undefined;
}

function clampTimeoutSeconds(value: number | undefined): number {
  if (value === undefined) {
    return 300;
  }

  if (!Number.isInteger(value) || value < 30 || value > 900) {
    throw new Error("Spotify OAuth timeout must be an integer from 30 to 900.");
  }

  return value;
}

function isLocalhost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

function writeText(
  res: ServerResponse,
  statusCode: number,
  text: string,
): void {
  res.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

function writeHtml(
  res: ServerResponse,
  statusCode: number,
  html: string,
): void {
  res.writeHead(statusCode, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function renderHtml(
  title: string,
  message: string,
  refreshToken?: string,
): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>${
    refreshToken
      ? `<textarea rows="6" cols="90" readonly>${escapeHtml(refreshToken)}</textarea>`
      : ""
  }</body></html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
