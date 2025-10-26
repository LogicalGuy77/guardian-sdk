// detects if same object is coming repeatedly within a threshold
import { createHash } from 'crypto';

// in-memory store: key => timestamp
const recentObjects = new Map();

/**
 * Detect if the same object was received again within threshold (ms)
 * @param {object} obj - The object to check
 * @param {number} thresholdMs - Time threshold in ms (e.g., 4000 = 4s)
 * @returns {boolean} true if it's above threshold (i.e., repeated too soon)
 */
export function detectRepeatedObject(obj, thresholdMs = 4000) {
  // create a stable hash from the object
  const key = createHash('sha256')
    .update(JSON.stringify(obj))
    .digest('hex');

  const now = Date.now();
  const lastTime = recentObjects.get(key);

  if (lastTime && (now - lastTime) < thresholdMs) {
    // same object within threshold → flag it
    return true;
  }

  // update last seen timestamp
  recentObjects.set(key, now);

  // optional cleanup for memory safety
  if (recentObjects.size > 10000) {
    const cutoff = now - thresholdMs * 2;
    for (const [k, t] of recentObjects.entries()) {
      if (t < cutoff) recentObjects.delete(k);
    }
  }

  return false;
}
