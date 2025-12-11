/**
 * This is a wrapper around the async-retry package with correct types.
 */
// @deno-types="npm:@types/async-retry@^1.4.9"
import retry, { Options as AsyncRetryOptions } from 'async-retry';

export { type AsyncRetryOptions, retry };
