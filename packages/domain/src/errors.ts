/**
 * Domain errors. Every adapter translates its own failures into these, and the
 * API maps them to HTTP statuses, so no caller ever sees a storage exception.
 */
export class PurrError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = new.target.name;
  }
}

export class NotFoundError extends PurrError {
  constructor(message: string) {
    super('NOT_FOUND', message);
  }
}

export class AlreadyExistsError extends PurrError {
  constructor(message: string) {
    super('ALREADY_EXISTS', message);
  }
}

export class ConflictError extends PurrError {
  constructor(message: string) {
    super('CONFLICT', message);
  }
}

export class VersionMismatchError extends PurrError {
  constructor(message: string) {
    super('VERSION_MISMATCH', message);
  }
}

export class ValidationError extends PurrError {
  constructor(message: string) {
    super('VALIDATION', message);
  }
}
