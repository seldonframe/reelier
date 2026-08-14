export class ContinuityBindingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContinuityBindingError";
  }
}

export class ContinuityConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContinuityConfigurationError";
  }
}
