import { createServer, type Server, type ServerResponse } from "node:http";

import {
  buildSpotifyAuthorizationUrl,
  canPersistSpotifyRefreshToken,
  exchangeSpotifyAuthorizationCode,
  getSpotifyRefreshTokenPersistenceTarget,
  saveSpotifyRefreshToken,
  SPOTIFY_USER_SCOPES,
  type SpotifyRefreshTokenPersistenceResult,
  type SpotifyRuntimeApi,
  type SpotifyPluginConfig,
} from "./spotify";

type ActiveOauthFlow = {
  callbackInProgress: boolean;
  id: number;
  server: Server;
  state: string;
  timeout?: ReturnType<typeof setTimeout>;
};

type CompletedOauthFlow = {
  completedAt: string;
  error?: string;
  flowId: number;
  persisted: boolean;
  scope?: string;
  storage: SpotifyRefreshTokenPersistenceResult["storage"];
};

let activeFlow: ActiveOauthFlow | undefined;
let completedFlow: CompletedOauthFlow | undefined;
let startingFlowId = 0;
let persistenceInFlight = false;
let pendingListener: ActiveOauthFlow | undefined;

export async function startSpotifyOauthFlow(
  config: SpotifyPluginConfig,
  options: {
    api?: SpotifyRuntimeApi;
    scopes?: readonly string[];
    state?: string;
    timeoutSeconds?: number;
  },
) {
  if (pendingListener) {
    throw new Error("Spotify OAuth login is busy starting its callback listener. Wait for it to finish before starting another login.");
  }
  if (persistenceInFlight) {
    throw new Error("Spotify OAuth login is busy saving a previous refresh token. Wait for it to finish before starting another login.");
  }
  const flowId = ++startingFlowId;
  stopActiveFlow();
  completedFlow = undefined;

  const state = options.state ?? crypto.randomUUID();
  const timeoutMs = clampTimeoutSeconds(options.timeoutSeconds) * 1000;
  const auth = await buildSpotifyAuthorizationUrl(
    config,
    options.scopes ?? SPOTIFY_USER_SCOPES,
    state,
    true,
  );
  if (startingFlowId !== flowId) {
    throw new Error("Spotify OAuth login was superseded before it could start.");
  }
  const redirectUrl = validateLoopbackRedirectUri(auth.redirectUri);
  const flow: ActiveOauthFlow = {
    callbackInProgress: false,
    id: flowId,
    server: undefined as unknown as Server,
    state,
  };

  const server = createServer(async (req, res) => {
    let requestUrl: URL;
    try {
      requestUrl = new URL(req.url ?? "/", auth.redirectUri);
    } catch {
      writeText(res, 400, "Spotify OAuth callback URL is invalid.");
      return;
    }

    if (requestUrl.pathname !== redirectUrl.pathname) {
      writeText(res, 404, "Spotify OAuth callback route not found.");
      return;
    }
    if (activeFlow !== flow) {
      writeHtml(res, 409, renderHtml("Spotify OAuth unavailable", "This login is no longer active."));
      return;
    }
    if (requestUrl.searchParams.get("state") !== state) {
      writeHtml(res, 400, renderHtml("Spotify OAuth failed", "State mismatch."));
      return;
    }
    if (flow.callbackInProgress) {
      writeHtml(res, 409, renderHtml("Spotify OAuth in progress", "This callback is already being processed."));
      return;
    }

    flow.callbackInProgress = true;
    const callbackError = requestUrl.searchParams.get("error");
    if (callbackError) {
      const message = callbackError === "access_denied"
        ? "Spotify authorization was cancelled."
        : "Spotify authorization failed.";
      completeFlow(flow, {
        error: message,
        persisted: false,
        storage: "manual-config-or-env",
      });
      writeHtml(res, 400, renderHtml("Spotify OAuth failed", message));
      stopFlow(flow);
      return;
    }

    const code = requestUrl.searchParams.get("code");
    if (!code) {
      completeFlow(flow, {
        error: "Spotify OAuth callback did not include an authorization code.",
        persisted: false,
        storage: "manual-config-or-env",
      });
      writeHtml(res, 400, renderHtml("Spotify OAuth failed", "Missing authorization code."));
      stopFlow(flow);
      return;
    }

    try {
      const token = await exchangeSpotifyAuthorizationCode(
        config,
        code,
        auth.codeVerifier,
        auth.redirectUri,
      );
      if (activeFlow !== flow) {
        writeHtml(res, 409, renderHtml("Spotify OAuth unavailable", "This login is no longer active."));
        return;
      }
      persistenceInFlight = true;
      let persistence: SpotifyRefreshTokenPersistenceResult;
      try {
        persistence = await saveSpotifyRefreshToken(options.api, {
          refreshToken: token.refreshToken,
          scope: token.scope,
        });
      } finally {
        persistenceInFlight = false;
      }
      if (activeFlow !== flow) {
        writeHtml(res, 409, renderHtml("Spotify OAuth unavailable", "This login is no longer active."));
        return;
      }
      const error = persistence.persisted
        ? undefined
        : "Spotify refresh token could not be saved to OpenClaw.";
      completeFlow(flow, {
        error,
        persisted: persistence.persisted,
        scope: token.scope,
        storage: persistence.storage,
      });
      writeHtml(
        res,
        persistence.persisted ? 200 : 500,
        renderHtml(
          persistence.persisted ? "Spotify OAuth complete" : "Spotify OAuth failed",
          getCompletionMessage(persistence),
        ),
      );
    } catch {
      completeFlow(flow, {
        error: "Spotify authorization code exchange failed.",
        persisted: false,
        storage: "manual-config-or-env",
      });
      writeHtml(res, 500, renderHtml("Spotify OAuth failed", "Spotify authorization code exchange failed."));
    } finally {
      stopFlow(flow);
    }
  });
  flow.server = server;

  pendingListener = flow;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(getRedirectPort(redirectUrl), getBindHost(redirectUrl), () => {
        server.off("error", reject);
        resolve();
      });
    });
  } catch (error) {
    server.close();
    throw error;
  } finally {
    if (pendingListener === flow) pendingListener = undefined;
  }

  if (startingFlowId !== flowId) {
    server.close();
    throw new Error("Spotify OAuth login was superseded before it could start.");
  }
  activeFlow = flow;
  flow.timeout = setTimeout(() => stopFlow(flow), timeoutMs);

  return {
    authorizationUrl: auth.authorizationUrl,
    callbackUrl: auth.redirectUri,
    expiresAt: new Date(Date.now() + timeoutMs).toISOString(),
    persistence: canPersistSpotifyRefreshToken(options.api)
      ? { enabled: true, storage: getSpotifyRefreshTokenPersistenceTarget(options.api) }
      : { enabled: false, storage: "manual-config-or-env" },
    scopes: auth.scopes,
  };
}

export async function waitForSpotifyOauthFlowCompletion(
  timeoutSeconds = 300,
): Promise<CompletedOauthFlow> {
  const flowId = activeFlow?.id ?? completedFlow?.flowId;
  const deadline = Date.now() + clampTimeoutSeconds(timeoutSeconds) * 1000;
  while (true) {
    if (flowId !== undefined && completedFlow?.flowId === flowId) {
      return completedFlow;
    }
    if (flowId !== undefined && startingFlowId !== flowId) {
      throw new Error("Spotify OAuth login was superseded before the callback finished.");
    }
    if (!activeFlow || Date.now() >= deadline) break;
    await sleep(Math.min(500, deadline - Date.now()));
  }
  throw new Error("Spotify OAuth login timed out before the callback finished.");
}

function completeFlow(
  flow: ActiveOauthFlow,
  completed: Omit<CompletedOauthFlow, "completedAt" | "flowId">,
): void {
  if (activeFlow === flow) {
    completedFlow = { completedAt: new Date().toISOString(), ...completed, flowId: flow.id };
  }
}

function stopActiveFlow(): void {
  if (activeFlow) stopFlow(activeFlow);
}

function stopFlow(flow: ActiveOauthFlow): void {
  if (flow.timeout) clearTimeout(flow.timeout);
  flow.server.close();
  if (activeFlow === flow) activeFlow = undefined;
}

function validateLoopbackRedirectUri(value: string): URL {
  let redirectUrl: URL;
  try {
    redirectUrl = new URL(value);
  } catch {
    throw new Error("Spotify OAuth redirect URI must be a valid http://127.0.0.1 or http://[::1] URL.");
  }
  if (redirectUrl.protocol !== "http:") {
    throw new Error("Spotify OAuth callback helper only supports HTTP loopback redirect URIs.");
  }
  if (redirectUrl.hostname !== "127.0.0.1" && redirectUrl.hostname !== "[::1]") {
    throw new Error("Spotify OAuth callback redirect URI must use the explicit loopback IP 127.0.0.1 or [::1], not localhost.");
  }
  if (redirectUrl.username || redirectUrl.password || redirectUrl.search || redirectUrl.hash) {
    throw new Error("Spotify OAuth callback redirect URI cannot include credentials, a query string, or a fragment.");
  }
  if (redirectUrl.port === "0") {
    throw new Error("Spotify OAuth callback redirect URI cannot use port 0; configure a fixed callback port.");
  }
  return redirectUrl;
}

function getRedirectPort(redirectUrl: URL): number {
  return redirectUrl.port === "" ? 80 : Number(redirectUrl.port);
}

function getBindHost(redirectUrl: URL): string {
  return redirectUrl.hostname === "[::1]" ? "::1" : redirectUrl.hostname;
}

function clampTimeoutSeconds(value: number | undefined): number {
  if (value === undefined) return 300;
  if (!Number.isInteger(value) || value < 30 || value > 900) {
    throw new Error("Spotify OAuth timeout must be an integer from 30 to 900.");
  }
  return value;
}

function writeText(res: ServerResponse, statusCode: number, text: string): void {
  res.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

function writeHtml(res: ServerResponse, statusCode: number, html: string): void {
  res.writeHead(statusCode, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function renderHtml(title: string, message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></body></html>`;
}

function getCompletionMessage(persistence: SpotifyRefreshTokenPersistenceResult): string {
  if (persistence.storage === "openclaw-config" && persistence.persisted) {
    return "Refresh token saved to OpenClaw config. You can close this page.";
  }
  if (persistence.storage === "openclaw-plugin-state" && persistence.persisted) {
    return "Refresh token saved to OpenClaw plugin state. You can close this page.";
  }
  return "Automatic token save failed, so no token was displayed. Fix OpenClaw config write access and run the Spotify OAuth login command again.";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
