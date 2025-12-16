/**
 * Polyfill for Node.js globals needed by libraries like Mongoose
 * This allows us to avoid using --unstable-node-globals flag
 */

// Polyfill global object for Node.js compatibility
// Mongoose and other Node.js libraries expect `global` to exist
if (typeof global === 'undefined') {
  (globalThis as any).global = globalThis;
}

// Note: Other Node.js globals like Buffer, process, etc. are provided
// by Deno's npm compatibility layer automatically when using npm: imports
