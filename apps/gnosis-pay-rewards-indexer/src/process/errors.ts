export class LogAlreadyProcessedError extends Error {
  constructor(message: string) {
    super(message, {
      cause: 'LOG_ALREADY_PROCESSED',
    });
    this.name = 'LogAlreadyProcessedError';
  }
}

export class NotGnosisPaySafeAddressError extends Error {
  constructor(message: string) {
    super(message, {
      cause: 'NOT_GNOSIS_PAY_SAFE_ADDRESS',
    });
    this.name = 'NotGnosisPaySafeAddressError';
  }
}
