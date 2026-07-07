# openclaw-spotify

Plain OpenClaw plugin for Spotify catalog integrations.

## Files

- `openclaw.plugin.json` declares the plugin manifest OpenClaw discovers.
- `index.ts` exports the tool plugin entrypoint with `defineToolPlugin`.
- `src/index.ts` keeps the shared plugin identity and config schema.
- `src/tools/` declares the OpenClaw tools.
- `src/spotify.ts` wraps the Spotify SDK and response shaping.
- `skills/spotify/SKILL.md` teaches OpenClaw when and how to use the tools.

## Config

The read-only catalog tools use Spotify Client Credentials. Playlist management
and playback tools also need a Spotify OAuth refresh token. Configure OpenClaw
plugin config with your Spotify app credentials. The refresh token is normally
saved automatically by the plugin CLI command, so it only needs to be configured
manually as a fallback:

```json
{
  "plugins": {
    "entries": {
      "spotify": {
        "enabled": true,
        "config": {
          "clientId": "your-client-id",
          "clientSecret": "your-client-secret",
          "market": "US",
          "playlistApprovals": {
            "update": "prompt",
            "removeTracks": "prompt",
            "reorderTracks": "prompt",
            "delete": "prompt"
          }
        }
      }
    }
  }
}
```

Or environment variables:

```bash
SPOTIFY_CLIENT_ID=your-client-id
SPOTIFY_CLIENT_SECRET=your-client-secret
```

For first-time OAuth setup, add `http://127.0.0.1:4377/callback` to your
Spotify app settings and run this on the machine where OpenClaw runs:

```bash
openclaw spotify auth login
```

If OpenClaw runs on a VPS, use an SSH port forward from your local browser
machine before opening the authorization URL:

```bash
ssh -L 4377:127.0.0.1:4377 user@your-vps
```

The command prints the Spotify authorization URL, waits for the callback, and
saves the refresh token into OpenClaw config. It does not expose the refresh
token in chat or on the callback page. Set `redirectUri` or
`SPOTIFY_REDIRECT_URI` only if you want to use a different localhost callback.
Tokens saved by `openclaw spotify auth login` are preferred over manual
`refreshToken` or `SPOTIFY_REFRESH_TOKEN` values. If Spotify reports a saved
token as revoked, the plugin tries the next configured token source before
failing. When Spotify rotates a refresh token during an API token refresh, the
plugin saves the replacement token back to OpenClaw automatically.

## Tools

- `spotify_search`: search tracks, artists, albums, and playlists.
- `spotify_get_track`: get track metadata.
- `spotify_get_artist`: get artist metadata and optional top tracks.
- `spotify_get_album`: get album metadata and optional tracks.
- `spotify_get_playlist`: get public playlist metadata and tracks.
- `spotify_list_my_playlists`: list the authorized user's playlists.
- `spotify_create_playlist`: create a playlist.
- `spotify_update_playlist`: update playlist details.
- `spotify_delete_playlist`: delete or remove a playlist from the authorized user's library.
- `spotify_add_playlist_tracks`: add tracks to a playlist.
- `spotify_remove_playlist_tracks`: remove tracks from a playlist.
- `spotify_reorder_playlist_tracks`: reorder tracks in a playlist.
- `spotify_upload_playlist_cover`: upload a custom playlist cover from an image URL, data URL, or base64 image. The plugin converts/crops/compresses images to Spotify's JPEG cover format by default. OAuth must include Spotify's `ugc-image-upload` scope.
- `spotify_get_playback`: get current playback state.
- `spotify_get_currently_playing`: get the current item.
- `spotify_list_devices`: list Spotify Connect devices.
- `spotify_get_queue`: get the playback queue.
- `spotify_transfer_playback`: transfer playback to a device.
- `spotify_play`: start or resume playback.
- `spotify_pause`: pause playback.
- `spotify_next`: skip to next item.
- `spotify_previous`: skip to previous item.
- `spotify_seek`: seek to a playback position.
- `spotify_set_repeat`: set repeat mode.
- `spotify_set_volume`: set volume.
- `spotify_set_shuffle`: enable or disable shuffle.
- `spotify_add_to_queue`: add a track or episode to the queue.

Playlist edit/delete tools request an OpenClaw plugin approval before they run.
Adding tracks and creating playlists do not prompt. Destructive actions like
removing tracks or deleting a playlist are marked critical and only offer
approve-once or deny. On headless/server setups, route plugin approvals with
`approvals.plugin`; this is separate from exec approvals.
The approval hook fetches the playlist name from Spotify before prompting when
OAuth is configured, and falls back to the playlist ID if lookup is unavailable.

Each protected playlist action is configurable. Set an action to `"allow"` if it
should run without a plugin approval prompt:

```json
{
  "plugins": {
    "entries": {
      "spotify": {
        "config": {
          "playlistApprovals": {
            "update": "allow",
            "removeTracks": "prompt",
            "reorderTracks": "allow",
            "delete": "prompt"
          }
        }
      }
    }
  }
}
```

## Check

Install dependencies:

```bash
bun install
```

Run the TypeScript check:

```bash
bun run check
```

Run tests:

```bash
bun run test
```
