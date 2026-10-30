# Changelog

Changes are reconstructed from version changes in `package.json` and the Git
history on `main`. Dates reflect those version changes, rather than independently
verified registry publication dates. Each version links to its relevant commits.

## [0.1.11] - 2026-10-30

- Prepare a new package version after the `0.1.10` ClawHub publication attempt
  failed because its scanner could not return a verdict.
- Retain the playlist approval, playlist reading, and async OAuth storage fixes
  from `0.1.10`; no runtime behavior changes in this version bump.

## [0.1.10] - 2026-10-30

- Migrate saved OAuth token storage to awaited async keyed-store operations,
  preferring V2 on newer gateways and retaining the async API on older supported
  versions. Preserve existing saved logins and isolate rotated tokens by runtime.
- Fix playlist approval prompts to read the registered plugin configuration, so
  playlist names and per-action approval settings work with OpenClaw's typed hooks.
- Show playlist names in approval titles and descriptions, with a Spotify link
  for identifying the target. Keep a plain action title if the name lookup fails.
- Make playlist reads easier to consume: include absolute zero-based item
  positions, snapshot IDs, explicit `hasMore` and `nextOffset` fields, episode
  references, and markers for unavailable items without dropping their slots.
- Support current `items.total` and older `tracks.total` playlist metadata, partial
  owner details, and unknown profile visibility.
- Return fresh snapshot IDs after adding or removing tracks, and improve AI
  guidance for playlist discovery, pagination, and follow-up edits.
- Update dependencies and the development SDK while retaining OpenClaw
  **2026.6.11** as the minimum gateway version.
- Remove unused exports, share add/remove track preparation, and add regression
  coverage for approval hooks, playlist reads, pagination, and edit requests.
- Add this changelog for every version recorded in Git.

## [0.1.9] - 2026-08-25

- Isolate recently saved OAuth refresh tokens by OpenClaw runtime instead of
  keeping one process-wide token, preventing one runtime from reusing another's
  most recently saved login.

## [0.1.8] - 2026-08-25

- Accept playlist IDs, Spotify playlist URIs, and copied Spotify playlist URLs
  across playlist tools.
- Include playlist display names, URIs, and links in mutation results while
  retaining IDs for follow-up tool calls.
- Normalize playlist references before metadata lookups and API requests, with
  stable ID/link fallbacks when metadata cannot be fetched.
- Update tool guidance and add tests for playlist input handling and named results.

## [0.1.7] - 2026-07-12

- Immediately use newly saved OAuth refresh tokens and invalidate cached user
  clients, including when saving to persistent storage fails.
- Report errors from both config and plugin-state token persistence attempts.
- Fix playlist removal requests to send `items` instead of the legacy `tracks`
  field, while preserving snapshot guards.
- Update `@shadownine/foxify` to `^0.1.5` and add regression tests for token caching
  and track removal requests.

## [0.1.6] - 2026-07-11

- Replace the playlist `public` input with `hiddenFromProfile` for creation and
  updates, reflecting what Spotify's API actually controls.
- Return clearer profile/search visibility metadata and document that hiding a
  playlist does not restrict access through its link.
- Update AI instructions and tests for profile visibility and collaboration.

## [0.1.5] - 2026-07-08

- Read playlist contents with the authorized user's OAuth credentials instead of
  client credentials.
- Summarize playlist entries from both the current `item` field and legacy
  `track` field.
- Update `@shadownine/foxify` to `^0.1.4`.

## [0.1.4] - 2026-07-07

- Add `spotify_upload_playlist_cover` for custom artwork supplied as an image
  URL, data URL, or base64 image.
- Convert, crop, and compress artwork into Spotify-compatible JPEG covers by
  default, with configurable image processing options.
- Request the `ugc-image-upload` OAuth scope and add cover processing/upload tests.
- Add `sharp` for image processing and update `@shadownine/foxify` to `^0.1.3`.

## [0.1.3] - 2026-07-07

- Clarify that Spotify's `public` flag controls discovery on profiles and in
  search, rather than access through a playlist link.
- Add visibility explanations to playlist summaries, tool schemas, and AI
  guidance, including support for unknown (`null`) visibility.

## [0.1.2] - 2026-07-07

- Explicitly apply the requested profile visibility and collaboration settings
  after playlist creation.
- Return those applied settings in the playlist summary and add regression
  coverage for playlists requested to be hidden from profiles/search.

## [0.1.1] - 2026-07-07

- Add a distribution build, compiled plugin entrypoint, and OpenClaw plugin
  build/validation commands.
- Prepare the scoped `@shadowninex/openclaw-spotify` package for ClawHub
  installation and standardize the plugin ID as `spotify`.
- Add Spotify Connect playback controls, device discovery, playback/queue reads,
  and the corresponding OAuth scopes.
- Move OAuth setup from agent tools to `openclaw spotify auth login`, keeping
  authorization codes and tokens out of chat.
- Persist OAuth tokens to OpenClaw config or plugin state, prefer newly saved
  logins over stale manual tokens, fall back on revoked-token errors, and save
  rotated refresh tokens automatically.
- Request the Spotify consent dialog during login and document remote-host SSH
  forwarding for the callback.
- Add configurable playlist approval policies and `spotify_delete_playlist`, with
  critical approval prompts for destructive actions.
- Replace `@spotify/web-api-ts-sdk` with `@shadownine/foxify` and refresh dependencies.
- Keep collaborative playlists hidden from profiles/search and add Spotify tool
  guidance plus helper/schema regression tests.

## [0.1.0] - 2026-07-07

- Introduce the OpenClaw Spotify plugin, manifest, configuration schema, and
  TypeScript tool definitions.
- Add catalog search and track, artist, album, and playlist lookup tools.
- Add user playlist listing, creation, detail updates, track additions/removals,
  and track reordering.
- Add client-credentials access for catalog requests and a PKCE OAuth callback
  flow for user-authorized operations.

[0.1.11]: https://github.com/ShadowNineX/openclaw-spotify/compare/a46ae60...main
[0.1.10]: https://github.com/ShadowNineX/openclaw-spotify/compare/2426a05...a46ae60
[0.1.9]: https://github.com/ShadowNineX/openclaw-spotify/compare/766283b...2426a05
[0.1.8]: https://github.com/ShadowNineX/openclaw-spotify/compare/336dbb4...766283b
[0.1.7]: https://github.com/ShadowNineX/openclaw-spotify/compare/385b177...336dbb4
[0.1.6]: https://github.com/ShadowNineX/openclaw-spotify/compare/32ed481...385b177
[0.1.5]: https://github.com/ShadowNineX/openclaw-spotify/compare/a4512e9...32ed481
[0.1.4]: https://github.com/ShadowNineX/openclaw-spotify/compare/30146f2...a4512e9
[0.1.3]: https://github.com/ShadowNineX/openclaw-spotify/compare/7a7a91d...30146f2
[0.1.2]: https://github.com/ShadowNineX/openclaw-spotify/compare/ea2280b...7a7a91d
[0.1.1]: https://github.com/ShadowNineX/openclaw-spotify/compare/233c638...ea2280b
[0.1.0]: https://github.com/ShadowNineX/openclaw-spotify/tree/233c638
