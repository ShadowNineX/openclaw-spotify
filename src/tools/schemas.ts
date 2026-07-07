import { Type } from "typebox";

export const marketSchema = Type.String({
  description: "ISO 3166-1 alpha-2 market code, for example US or SE.",
  minLength: 2,
  maxLength: 2,
});

export const limitSchema = Type.Integer({
  description: "Maximum results to return, from 1 to 50.",
  minimum: 1,
  maximum: 50,
  default: 10,
});

export const offsetSchema = Type.Integer({
  description: "Zero-based result offset.",
  minimum: 0,
  default: 0,
});

export const searchTypeSchema = Type.Union([
  Type.Literal("track"),
  Type.Literal("artist"),
  Type.Literal("album"),
  Type.Literal("playlist"),
]);

export const searchSchema = Type.Object(
  {
    query: Type.String({
      description: "Spotify search query.",
      minLength: 1,
    }),
    types: Type.Optional(
      Type.Array(searchTypeSchema, {
        description: "Catalog item types to search.",
        minItems: 1,
        default: ["track", "artist"],
      }),
    ),
    market: Type.Optional(marketSchema),
    limit: Type.Optional(limitSchema),
    offset: Type.Optional(offsetSchema),
  },
  { additionalProperties: false },
);

export const idSchema = Type.Object(
  {
    id: Type.String({
      description: "Spotify catalog ID.",
      minLength: 1,
    }),
    market: Type.Optional(marketSchema),
  },
  { additionalProperties: false },
);

export const artistSchema = Type.Object(
  {
    id: Type.String({
      description: "Spotify artist ID.",
      minLength: 1,
    }),
    includeTopTracks: Type.Optional(
      Type.Boolean({
        description: "Include the artist's top tracks.",
        default: true,
      }),
    ),
    market: Type.Optional(marketSchema),
  },
  { additionalProperties: false },
);

export const albumSchema = Type.Object(
  {
    id: Type.String({
      description: "Spotify album ID.",
      minLength: 1,
    }),
    includeTracks: Type.Optional(
      Type.Boolean({
        description: "Include album tracks.",
        default: true,
      }),
    ),
    market: Type.Optional(marketSchema),
    limit: Type.Optional(limitSchema),
    offset: Type.Optional(offsetSchema),
  },
  { additionalProperties: false },
);

export const playlistSchema = Type.Object(
  {
    id: Type.String({
      description: "Spotify playlist ID.",
      minLength: 1,
    }),
    market: Type.Optional(marketSchema),
    limit: Type.Optional(limitSchema),
    offset: Type.Optional(offsetSchema),
  },
  { additionalProperties: false },
);

export const oauthStartSchema = Type.Object(
  {
    scopes: Type.Optional(
      Type.Array(Type.String({ minLength: 1 }), {
        description:
          "Spotify OAuth scopes. Defaults to playlist read/write scopes.",
        minItems: 1,
      }),
    ),
    state: Type.Optional(
      Type.String({
        description: "Optional OAuth state value.",
      }),
    ),
    timeoutSeconds: Type.Optional(
      Type.Integer({
        description: "How long to keep the local callback server open.",
        minimum: 30,
        maximum: 900,
        default: 300,
      }),
    ),
  },
  { additionalProperties: false },
);

export const oauthStatusSchema = Type.Object({}, { additionalProperties: false });

export const myPlaylistsSchema = Type.Object(
  {
    limit: Type.Optional(limitSchema),
    offset: Type.Optional(offsetSchema),
  },
  { additionalProperties: false },
);

export const createPlaylistSchema = Type.Object(
  {
    name: Type.String({
      description: "Playlist name.",
      minLength: 1,
    }),
    description: Type.Optional(
      Type.String({
        description: "Playlist description.",
      }),
    ),
    public: Type.Optional(
      Type.Boolean({
        description: "Whether the playlist should be public.",
        default: false,
      }),
    ),
    collaborative: Type.Optional(
      Type.Boolean({
        description: "Whether the playlist should be collaborative.",
        default: false,
      }),
    ),
  },
  { additionalProperties: false },
);

export const updatePlaylistSchema = Type.Object(
  {
    id: Type.String({
      description: "Spotify playlist ID.",
      minLength: 1,
    }),
    name: Type.Optional(
      Type.String({
        description: "New playlist name.",
        minLength: 1,
      }),
    ),
    description: Type.Optional(
      Type.String({
        description: "New playlist description.",
      }),
    ),
    public: Type.Optional(
      Type.Boolean({
        description: "Whether the playlist should be public.",
      }),
    ),
    collaborative: Type.Optional(
      Type.Boolean({
        description: "Whether the playlist should be collaborative.",
      }),
    ),
  },
  { additionalProperties: false },
);

export const playlistTracksEditSchema = Type.Object(
  {
    id: Type.String({
      description: "Spotify playlist ID.",
      minLength: 1,
    }),
    uris: Type.Array(
      Type.String({
        description: "Spotify track URI or track ID.",
        minLength: 1,
      }),
      {
        description: "Tracks to add or remove.",
        minItems: 1,
        maxItems: 100,
      },
    ),
    position: Type.Optional(
      Type.Integer({
        description: "Zero-based insert position for adding tracks.",
        minimum: 0,
      }),
    ),
    snapshotId: Type.Optional(
      Type.String({
        description: "Playlist snapshot ID for guarded removals.",
        minLength: 1,
      }),
    ),
  },
  { additionalProperties: false },
);

export const reorderPlaylistTracksSchema = Type.Object(
  {
    id: Type.String({
      description: "Spotify playlist ID.",
      minLength: 1,
    }),
    rangeStart: Type.Integer({
      description: "Position of the first item to move.",
      minimum: 0,
    }),
    insertBefore: Type.Integer({
      description: "Position where the moved items should be inserted.",
      minimum: 0,
    }),
    rangeLength: Type.Optional(
      Type.Integer({
        description: "Number of items to move.",
        minimum: 1,
        default: 1,
      }),
    ),
    snapshotId: Type.Optional(
      Type.String({
        description: "Playlist snapshot ID for guarded reordering.",
        minLength: 1,
      }),
    ),
  },
  { additionalProperties: false },
);
