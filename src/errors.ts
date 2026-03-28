export enum CalDAVErrorCode {
  AuthError = 'AuthError',
  NetworkError = 'NetworkError',
  ValidationError = 'ValidationError',
  ParseError = 'ParseError',
}

export class CalDAVMCPError extends Error {
  constructor(
    public readonly code: CalDAVErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = code;
  }
}

export class AuthError extends CalDAVMCPError {
  constructor(message: string, options?: ErrorOptions) {
    super(CalDAVErrorCode.AuthError, message, options);
  }
}

export class NetworkError extends CalDAVMCPError {
  constructor(message: string, options?: ErrorOptions) {
    super(CalDAVErrorCode.NetworkError, message, options);
  }
}

export class ValidationError extends CalDAVMCPError {
  constructor(message: string, options?: ErrorOptions) {
    super(CalDAVErrorCode.ValidationError, message, options);
  }
}

export class ParseError extends CalDAVMCPError {
  constructor(message: string, options?: ErrorOptions) {
    super(CalDAVErrorCode.ParseError, message, options);
  }
}
