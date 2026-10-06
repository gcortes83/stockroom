import type { FieldError } from '@stockroom/contracts';

export class DomainError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly extensions: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends DomainError {
  constructor(
    readonly errors: FieldError[],
    message = 'The request is invalid',
  ) {
    super('VALIDATION', 400, message, { errors });
  }
}

export class NotFoundError extends DomainError {
  constructor(code: string, message: string) {
    super(code, 404, message);
  }
}

export class ConflictError extends DomainError {
  constructor(code: string, message: string, extensions: Record<string, unknown> = {}) {
    super(code, 409, message, extensions);
  }
}

export class TransientError extends Error {}

export class PermanentMessageError extends Error {}
