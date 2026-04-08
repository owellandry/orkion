export class OrkionConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrkionConfigurationError";
  }
}
