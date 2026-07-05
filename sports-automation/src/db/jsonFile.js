import fs from "node:fs/promises";
import path from "node:path";

/**
 * A small atomic, serialized JSON file store. Writes go to a temp file then
 * rename() so a crash mid-write can never leave a corrupt/partial file.
 * Reads-and-writes go through the same in-process queue so concurrent
 * mutate() calls never interleave and clobber each other.
 */
export function createJsonFile(filePath, defaultValue) {
  let queue = Promise.resolve();

  async function read() {
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      return JSON.parse(raw);
    } catch (err) {
      if (err.code === "ENOENT") return structuredClone(defaultValue);
      throw err;
    }
  }

  async function write(data) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tmpPath = `${filePath}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(data, null, 2));
    await fs.rename(tmpPath, filePath);
  }

  /** Serialize a read-modify-write. fn mutates `data` in place and may return a value. */
  function mutate(fn) {
    const runner = queue.then(async () => {
      const data = await read();
      const returned = await fn(data);
      await write(data);
      return returned;
    });
    queue = runner.then(() => {}, () => {});
    return runner;
  }

  return { read, mutate };
}
