/**
 * Application errors the service/route layer raises on purpose.
 *
 * These carry an HTTP `status` and a stable `code`, so a route handler can turn
 * a thrown error into the right response without a chain of `if` checks. Any
 * error that is NOT an `AppError` is an unexpected fault and must become a
 * generic 500 — never echoed to the client.
 */

export class AppError extends Error {
  constructor(message, { status = 500, code = "INTERNAL_ERROR" } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
    this.code = code;
  }
}

export class ValidationError extends AppError {
  constructor(message = "Please check the form.", { fields } = {}) {
    super(message, { status: 422, code: "VALIDATION_ERROR" });
    this.fields = fields;
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Sign in to continue.") {
    super(message, { status: 401, code: "UNAUTHORIZED" });
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have access to this.") {
    super(message, { status: 403, code: "FORBIDDEN" });
  }
}

export class ConflictError extends AppError {
  constructor(message = "That record already exists.") {
    super(message, { status: 409, code: "CONFLICT" });
  }
}
