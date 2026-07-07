---
name: spotify
description: "Use the OpenClaw Spotify plugin for catalog search, playlist management, and playback control."
---

# Spotify

Use this skill when the user asks to search Spotify, inspect tracks/artists/albums/playlists, manage their own playlists, or control Spotify playback through OpenClaw tools.

## Tool Routing

- Use `spotify_search` for broad discovery across tracks, artists, albums, and playlists.
- Use `spotify_get_track`, `spotify_get_artist`, `spotify_get_album`, or `spotify_get_playlist` when the user has a known Spotify URL, URI, or ID.
- Use `spotify_list_my_playlists` before modifying playlists when the user has not given a specific playlist ID.
- Use `spotify_create_playlist`, `spotify_update_playlist`, `spotify_add_playlist_tracks`, `spotify_remove_playlist_tracks`, and `spotify_reorder_playlist_tracks` only for the authorized user's playlists.
- Use `spotify_get_playback`, `spotify_get_currently_playing`, `spotify_list_devices`, and `spotify_get_queue` for playback state, devices, and queue inspection.
- Use `spotify_transfer_playback`, `spotify_play`, `spotify_pause`, `spotify_next`, `spotify_previous`, `spotify_seek`, `spotify_set_repeat`, `spotify_set_volume`, `spotify_set_shuffle`, and `spotify_add_to_queue` for Spotify Connect playback control.

## OAuth Flow

OAuth setup is not exposed as an agent tool. If OAuth is missing, tell the user to run this on the OpenClaw host:

```bash
openclaw spotify auth login
```

For a VPS, tell the user to use an SSH port forward from their browser machine:

```bash
ssh -L 4377:127.0.0.1:4377 user@your-vps
```

Do not ask the user to paste OAuth codes, callback URLs, refresh tokens, or access tokens into chat.

The default callback is `http://127.0.0.1:4377/callback`. The Spotify app must allow that redirect URI unless config overrides it.

## Playlist Safety

- Confirm the target playlist before destructive edits like remove, reorder, visibility changes, or description changes.
- Confirm the target device before transferring playback or changing playback on a specific device.
- Prefer track URIs or IDs from `spotify_search` results when adding tracks.
- For remove or reorder operations, preserve and report returned snapshot IDs when available.
- If an operation fails due to missing OAuth, tell the user to run the terminal OAuth command instead of retrying the playlist tool.
