import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../AppError.js';
import { logger } from '../logger.js';

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      success: false,
      error: 'Validation error',
      details: err.flatten().fieldErrors,
    });
  }

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      error: err.message,
      code: err.code,
    });
  }

  logger.error('Unhandled error', err);
  return res.status(500).json({
    success: false,
    error: 'Internal server error',
  });
}
