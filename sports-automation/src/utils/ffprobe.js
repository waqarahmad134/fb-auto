import ffmpeg from "fluent-ffmpeg";

/**
 * Get the duration (in seconds) of a media file via ffprobe.
 * @param {string} filePath
 * @returns {Promise<number>}
 */
export function getDurationSeconds(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) return reject(err);
      const duration = data?.format?.duration;
      if (!duration) return reject(new Error(`ffprobe returned no duration for ${filePath}`));
      resolve(duration);
    });
  });
}
