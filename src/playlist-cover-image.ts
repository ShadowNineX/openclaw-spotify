const MAX_SPOTIFY_COVER_IMAGE_BODY_BYTES = 256 * 1024;
const MAX_INPUT_IMAGE_BYTES = 12 * 1024 * 1024;
const DEFAULT_COVER_SIZE = 640;
const DEFAULT_JPEG_QUALITY = 82;
const JPEG_MAGIC = [0xff, 0xd8, 0xff] as const;

export type PlaylistCoverImageInput = {
  imageBase64?: string;
  imageDataUrl?: string;
  imageUrl?: string;
  processImage?: boolean;
  quality?: number;
  size?: number;
};

export type PreparedPlaylistCoverImage = {
  byteLength: number;
  jpegBase64: string;
  processed: boolean;
  source: "base64" | "data-url" | "url";
};

type ResolvedPlaylistCoverImageInput = {
  bytes: Uint8Array;
  source: PreparedPlaylistCoverImage["source"];
};

export async function preparePlaylistCoverImage(
  input: PlaylistCoverImageInput,
  fetchImplementation: typeof fetch = fetch,
): Promise<PreparedPlaylistCoverImage> {
  const resolvedInput = await resolvePlaylistCoverImageInput(
    input,
    fetchImplementation,
  );
  const processImage = input.processImage !== false;

  if (!processImage) {
    assertJpeg(resolvedInput.bytes);
    const jpegBase64 = encodeBase64(resolvedInput.bytes);
    assertSpotifyCoverImageBodySize(jpegBase64);

    return {
      byteLength: measureBodyBytes(jpegBase64),
      jpegBase64,
      processed: false,
      source: resolvedInput.source,
    };
  }

  return {
    ...(await processPlaylistCoverImage(resolvedInput.bytes, {
      quality: input.quality,
      size: input.size,
    })),
    processed: true,
    source: resolvedInput.source,
  };
}

async function resolvePlaylistCoverImageInput(
  input: PlaylistCoverImageInput,
  fetchImplementation: typeof fetch,
): Promise<ResolvedPlaylistCoverImageInput> {
  const sources = [
    input.imageBase64 ? "imageBase64" : undefined,
    input.imageDataUrl ? "imageDataUrl" : undefined,
    input.imageUrl ? "imageUrl" : undefined,
  ].filter(Boolean);

  if (sources.length !== 1) {
    throw new Error(
      "Provide exactly one playlist cover image source: imageUrl, imageDataUrl, or imageBase64.",
    );
  }

  if (input.imageUrl) {
    return {
      bytes: await fetchImageBytes(input.imageUrl, fetchImplementation),
      source: "url",
    };
  }

  if (input.imageDataUrl) {
    return {
      bytes: decodeDataUrl(input.imageDataUrl),
      source: "data-url",
    };
  }

  return {
    bytes: decodeBase64(input.imageBase64 ?? ""),
    source: "base64",
  };
}

async function fetchImageBytes(
  imageUrl: string,
  fetchImplementation: typeof fetch,
): Promise<Uint8Array> {
  const url = new URL(imageUrl);

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Playlist cover imageUrl must use HTTP or HTTPS.");
  }

  const response = await fetchImplementation(url);

  if (!response.ok) {
    throw new Error(
      `Failed to fetch playlist cover image: HTTP ${response.status}.`,
    );
  }

  const contentLength = response.headers.get("content-length");

  if (contentLength && Number(contentLength) > MAX_INPUT_IMAGE_BYTES) {
    throw new Error("Playlist cover image input is larger than 12 MB.");
  }

  const bytes = new Uint8Array(await response.arrayBuffer());

  if (bytes.byteLength > MAX_INPUT_IMAGE_BYTES) {
    throw new Error("Playlist cover image input is larger than 12 MB.");
  }

  return bytes;
}

function decodeDataUrl(dataUrl: string): Uint8Array {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl.trim());

  if (!match) {
    throw new Error("Playlist cover imageDataUrl must be a valid data URL.");
  }

  if (match[2] !== ";base64") {
    throw new Error("Playlist cover imageDataUrl must be base64 encoded.");
  }

  return decodeBase64(match[3] ?? "");
}

function decodeBase64(value: string): Uint8Array {
  const normalized = stripBase64Whitespace(value);

  if (!normalized) {
    throw new Error("Playlist cover image base64 input is empty.");
  }

  return Uint8Array.from(Buffer.from(normalized, "base64"));
}

async function processPlaylistCoverImage(
  bytes: Uint8Array,
  options: {
    quality?: number;
    size?: number;
  },
): Promise<Omit<PreparedPlaylistCoverImage, "processed" | "source">> {
  const { default: sharp } = await import("sharp");
  const startingSize = clampInteger(
    options.size,
    64,
    1024,
    DEFAULT_COVER_SIZE,
  );
  const startingQuality = clampInteger(
    options.quality,
    1,
    100,
    DEFAULT_JPEG_QUALITY,
  );
  const sizes = uniqueNumbers([startingSize, 640, 512, 384, 256]);
  const qualities = uniqueNumbers([
    startingQuality,
    82,
    74,
    66,
    58,
    50,
    42,
    34,
  ]);

  for (const size of sizes) {
    for (const quality of qualities) {
      const jpeg = await sharp(bytes, {
        animated: false,
        limitInputPixels: 64_000_000,
      })
        .rotate()
        .resize(size, size, {
          fit: "cover",
        })
        .jpeg({
          mozjpeg: true,
          quality,
        })
        .toBuffer();
      const jpegBase64 = encodeBase64(jpeg);
      const byteLength = measureBodyBytes(jpegBase64);

      if (byteLength <= MAX_SPOTIFY_COVER_IMAGE_BODY_BYTES) {
        return {
          byteLength,
          jpegBase64,
        };
      }
    }
  }

  throw new Error(
    "Could not compress playlist cover image under Spotify's 256 KB upload limit.",
  );
}

function assertJpeg(bytes: Uint8Array): void {
  if (!JPEG_MAGIC.every((byte, index) => bytes[index] === byte)) {
    throw new Error(
      "Playlist cover image must be JPEG when processImage is false.",
    );
  }
}

function assertSpotifyCoverImageBodySize(jpegBase64: string): void {
  const byteLength = measureBodyBytes(jpegBase64);

  if (byteLength > MAX_SPOTIFY_COVER_IMAGE_BODY_BYTES) {
    throw new Error(
      `Spotify playlist cover image body must be 256 KB or smaller; got ${byteLength} bytes.`,
    );
  }
}

function clampInteger(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  if (value === undefined) {
    return fallback;
  }

  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Playlist cover image option must be ${min}-${max}.`);
  }

  return value;
}

function uniqueNumbers(values: readonly number[]): number[] {
  return [...new Set(values)];
}

function encodeBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function stripBase64Whitespace(value: string): string {
  return value.replace(/\s+/g, "");
}

function measureBodyBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
