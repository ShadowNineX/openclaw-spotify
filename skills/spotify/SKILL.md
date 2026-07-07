---
name: spotify
description: "Use the OpenClaw Spotify plugin for catalog search, OAuth setup, and playlist management."
---

# Spotify

Use this skill when the user asks to search Spotify, inspect tracks/artists/albums/playlists, set up Spotify OAuth, or manage their own playlists through OpenClaw tools.

## Tool Routing

- Use `spotify_search` for broad discovery across tracks, artists, albums, and playlists.
- Use `spotify_get_track`, `spotify_get_artist`, `spotify_get_album`, or `spotify_get_playlist` when the user has a known Spotify URL, URI, or ID.
- Use `spotify_oauth_start` before any user-owned playlist action if OAuth is not configured.
- Use `spotify_oauth_status` when checking whether the local OAuth flow completed.
- Use `spotify_list_my_playlists` before modifying playlists when the user has not given a specific playlist ID.
- Use `spotify_create_playlist`, `spotify_update_playlist`, `spotify_add_playlist_tracks`, `spotify_remove_playlist_tracks`, and `spotify_reorder_playlist_tracks` only for the authorized user's playlists.

## OAuth Flow

1. Start OAuth with `spotify_oauth_start`.
2. Give the user the authorization URL.
3. After browser approval, expect the callback to save the refresh token into OpenClaw plugin state.
4. If the callback reports that plugin state is unavailable, tell the user to set `plugins.entries.spotify.config.refreshToken` or `SPOTIFY_REFRESH_TOKEN`.

The default callback is `http://127.0.0.1:4377/callback`. The Spotify app must allow that redirect URI unless config overrides it.

## Playlist Safety

- Confirm the target playlist before destructive edits like remove, reorder, visibility changes, or description changes.
- Prefer track URIs or IDs from `spotify_search` results when adding tracks.
- For remove or reorder operations, preserve and report returned snapshot IDs when available.
- If an operation fails due to missing OAuth, run OAuth setup instead of retrying the playlist tool.
