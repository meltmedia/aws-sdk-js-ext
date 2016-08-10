"use strict";


class BaseError extends Error {
  constructor(message, cause) {
    super();
    this.message = message;
    this.cause = cause;
    this.name = this.constructor.name;
  }
}

class ValidationError extends BaseError {
  constructor(name, errors) {
    super(`Validation error took place while validating against schema: ${name}. ${JSON.stringify(errors)}`);
    this.errors = errors;
  }
}

class NonRetryableError extends BaseError {
  constructor(message, cause) {
    super(message, cause);
  }
}

module.exports = {
  BaseError: BaseError,
  ValidationError : ValidationError,
  NonRetryableError: NonRetryableError
};