---
name: spotify
description: Use Spotify tools for search, playlist management, cover art, and Spotify Connect playback.
---

# Spotify

Use these tools for Spotify catalog lookup, the authorized user's playlists, and playback.

## Choose the tool

- Discover: `spotify_search`.
- Inspect a known item: `spotify_get_track`, `spotify_get_artist`, `spotify_get_album`, or `spotify_get_playlist` with its Spotify ID, URI, or URL.
- Find one of the user's playlists: `spotify_list_my_playlists`. Do this before an edit when no playlist ID was supplied.
- Manage playlists: `spotify_create_playlist`, `spotify_update_playlist`, `spotify_delete_playlist`, `spotify_add_playlist_tracks`, `spotify_remove_playlist_tracks`, `spotify_reorder_playlist_tracks`, or `spotify_upload_playlist_cover`.
- Inspect playback: `spotify_get_playback`, `spotify_get_currently_playing`, `spotify_list_devices`, or `spotify_get_queue`.
- Control playback: `spotify_transfer_playback`, `spotify_play`, `spotify_pause`, `spotify_next`, `spotify_previous`, `spotify_seek`, `spotify_set_repeat`, `spotify_set_volume`, `spotify_set_shuffle`, or `spotify_add_to_queue`.

Prefer IDs or URIs returned by Spotify tools instead of guessing identifiers. For online cover art, pass `imageUrl`; the cover tool prepares Spotify-compatible JPEG artwork.

## Playlist visibility is not privacy

Spotify's Web API **cannot make a playlist private or restrict link access**. The `hiddenFromProfile` input only controls discovery:

- `true`: hide the playlist from the owner's profile and Spotify search.
- `false`: publish it on the owner's profile and make it searchable.

Anyone with the playlist link can still open it in either state. Never describe `hiddenFromProfile: true` as "private," never report link access as a failure, and never retry the operation merely because the link still works.

If the user asks to make a playlist private, explain the API limitation. Offer to hide it from their profile with `hiddenFromProfile: true`; tell them true access privacy must be changed manually in a Spotify client. Collaborative playlists are necessarily hidden from the profile because Spotify does not allow collaborative and profile-published states together.

## Safe workflow

1. Resolve the exact playlist, track, and device IDs needed for the request.
2. Confirm the target before removals, reordering, deletion, description changes, or profile-visibility changes.
3. Call the narrowest matching tool once. Playlist update/delete tools may show an OpenClaw approval prompt; creation and track additions do not.
4. Report what changed. Preserve returned snapshot IDs for remove or reorder operations.

## OAuth

If a user-scoped tool reports missing OAuth, tell the user to run this on the OpenClaw host instead of retrying:

```bash
openclaw spotify auth login
```

For a remote host, the user can forward the default callback port before logging in:

```bash
ssh -L 4377:127.0.0.1:4377 user@your-vps
```

The default callback is `http://127.0.0.1:4377/callback` and must be registered in the Spotify app unless configured otherwise. Never ask the user to paste OAuth codes, callback URLs, access tokens, or refresh tokens into chat.
