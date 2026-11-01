// Stamps public/sw.js with this deploy's commit so the service worker file changes
// on every deploy (see the BUILD_ID note in sw.js). Runs before `next build`.
//
// Safety: this must never be able to break a build or ship a broken worker —
//  * no commit id in the environment (a local build) -> file left untouched;
//  * the id is validated against a strict pattern before being written into JS;
//  * the result is syntax-checked before it replaces the file;
//  * any problem is reported as a warning and the original file is kept; exit code is always 0.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const MARKER = /const BUILD_ID = "[A-Za-z0-9_-]*";/;

/** Returns the stamped source, or null (with a reason) when it can't be done safely. */
export function stampServiceWorker(source, id) {
  if (!id) return { code: null, reason: "no commit id in the environment (local build) - left as is" };
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return { code: null, reason: "commit id has unexpected characters" };
  if (!MARKER.test(source)) return { code: null, reason: 'BUILD_ID marker not found in sw.js' };
  const code = source.replace(MARKER, `const BUILD_ID = "${id}";`);
  try {
    new vm.Script(code); // compile only - never executed
  } catch (e) {
    return { code: null, reason: `stamped file failed the syntax check: ${e.message}` };
  }
  return { code, reason: null };
}

function main() {
  const file = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "sw.js");
  const id = (process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || "").slice(0, 40).replace(/[^A-Za-z0-9_-]/g, "");
  try {
    const { code, reason } = stampServiceWorker(readFileSync(file, "utf8"), id);
    if (code === null) {
      console.warn(`[stamp-sw] skipped: ${reason}`);
      return;
    }
    writeFileSync(file, code);
    console.log(`[stamp-sw] sw.js stamped with ${id}`);
  } catch (e) {
    console.warn(`[stamp-sw] skipped: ${e.message}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
