// Pure geometry helpers for centering the Ken Burns zoom on a detected face (or
// group of faces), isolated from the ML/image-decoding side so they're unit-testable.

/** Union bounding box center of one or more face boxes ({x,y,width,height}) in the same coordinate space. Null if none given. */
export function computeFaceCenter(faces) {
  if (!faces || faces.length === 0) return null;
  const minX = Math.min(...faces.map((f) => f.x));
  const minY = Math.min(...faces.map((f) => f.y));
  const maxX = Math.max(...faces.map((f) => f.x + f.width));
  const maxY = Math.max(...faces.map((f) => f.y + f.height));
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

/**
 * Map a point from the original image's pixel space into the final canvas's pixel
 * space, given ffmpeg's `scale=W:H:force_original_aspect_ratio=increase,crop=W:H`
 * transform (scale to cover the canvas, then center-crop). Clamped to the canvas
 * bounds in case the point falls in the cropped-away margin.
 */
export function mapPointThroughScaleCrop(point, original, canvas) {
  const scale = Math.max(canvas.width / original.width, canvas.height / original.height);
  const scaledWidth = original.width * scale;
  const scaledHeight = original.height * scale;
  const cropOffsetX = (scaledWidth - canvas.width) / 2;
  const cropOffsetY = (scaledHeight - canvas.height) / 2;

  const x = point.x * scale - cropOffsetX;
  const y = point.y * scale - cropOffsetY;

  return {
    x: Math.min(Math.max(x, 0), canvas.width),
    y: Math.min(Math.max(y, 0), canvas.height)
  };
}

/** ffmpeg zoompan x/y expressions that keep the zoom centered on (fx, fy), clamped so the crop window never leaves the frame. */
export function buildZoompanFocusExpressions(focus) {
  return {
    x: `min(max(${focus.x.toFixed(2)}-(iw/zoom/2),0),iw-iw/zoom)`,
    y: `min(max(${focus.y.toFixed(2)}-(ih/zoom/2),0),ih-ih/zoom)`
  };
}
