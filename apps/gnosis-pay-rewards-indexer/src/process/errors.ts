export class LogAlreadyProcessedError extends Error {
  constructor(message: string) {
    super(message, {
      cause: 'LOG_ALREADY_PROCESSED',
    });
    this.name = 'LogAlreadyProcessedError';
  }
}

export class RateLimitError extends Error {
  constructor(message: string) {
    super(message, {
      cause: 'RATE_LIMIT',
    });
    this.name = 'RateLimitError';
  }
}
