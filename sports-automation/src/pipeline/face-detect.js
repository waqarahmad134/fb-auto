import "@tensorflow/tfjs-backend-cpu";
import * as tf from "@tensorflow/tfjs-core";
import * as blazeface from "@tensorflow-models/blazeface";
import { Jimp } from "jimp";
import logger from "../utils/logger.js";

let modelPromise = null;

/** Loads the blazeface model once per process and reuses it across every run. */
function getModel() {
  if (!modelPromise) {
    modelPromise = (async () => {
      await tf.setBackend("cpu");
      await tf.ready();
      return blazeface.load();
    })();
  }
  return modelPromise;
}

/**
 * Detect faces in an image file. Best-effort: any failure (model unavailable,
 * decode error, etc.) logs a warning and returns an empty array rather than
 * throwing — face-aware zoom is a nice-to-have, never a reason to fail a run.
 * @param {string} imagePath
 * @returns {Promise<{ faces: Array<{x:number,y:number,width:number,height:number}>, imageSize: {width:number,height:number} }>}
 */
export async function detectFaces(imagePath) {
  try {
    const image = await Jimp.read(imagePath);
    const { width, height } = image.bitmap;
    const rgba = new Uint8Array(image.bitmap.data.buffer, image.bitmap.data.byteOffset, width * height * 4);
    const rgb = new Uint8Array(width * height * 3);
    for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
      rgb[j] = rgba[i]; rgb[j + 1] = rgba[i + 1]; rgb[j + 2] = rgba[i + 2];
    }

    const model = await getModel();
    const tensor = tf.tidy(() => tf.tensor3d(rgb, [height, width, 3]));
    let predictions;
    try {
      predictions = await model.estimateFaces(tensor, false);
    } finally {
      tensor.dispose();
    }

    const faces = predictions.map((p) => ({
      x: p.topLeft[0],
      y: p.topLeft[1],
      width: p.bottomRight[0] - p.topLeft[0],
      height: p.bottomRight[1] - p.topLeft[1]
    }));

    return { faces, imageSize: { width, height } };
  } catch (err) {
    logger.warn({ err: err.message }, "step 06: face detection failed — falling back to center-framed zoom");
    return { faces: [], imageSize: null };
  }
}
