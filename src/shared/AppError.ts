export class AppError extends Error {
  constructor(
    public readonly message: string,
    public readonly statusCode: number = 500,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'AppError';
    Object.setPrototypeOf(this, AppError.prototype);
  }

  static badRequest(msg: string, code?: string) {
    return new AppError(msg, 400, code);
  }

  static unauthorized(msg = 'Unauthorized') {
    return new AppError(msg, 401, 'UNAUTHORIZED');
  }

  static forbidden(msg = 'Forbidden') {
    return new AppError(msg, 403, 'FORBIDDEN');
  }

  static notFound(msg = 'Not found') {
    return new AppError(msg, 404, 'NOT_FOUND');
  }

  static conflict(msg: string) {
    return new AppError(msg, 409, 'CONFLICT');
  }
}
