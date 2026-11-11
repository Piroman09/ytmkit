import { createContext, Script } from 'node:vm';
import { Platform } from 'youtubei.js';

let configured = false;

/**
 * YouTube.js can retrieve stream URLs, but it needs a JavaScript evaluator to
 * run YouTube's obfuscated player script. We run that script in an isolated
 * vm context with a timeout and no I/O globals.
 *
 * Call this once per process; createClient() does it for you.
 */
export function configureJavaScriptEvaluator(): void {
  if (configured) return;

  Platform.shim.eval = async (data) => {
    const script = new Script(`(function () {\n${data.output}\n})()`);
    return script.runInContext(createContext({}), { timeout: 10_000 });
  };

  configured = true;
}
