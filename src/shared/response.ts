import { Response } from 'express';

export function success<T>(
  res: Response,
  data: T,
  statusCode = 200,
  meta?: Record<string, unknown>,
) {
  return res.status(statusCode).json({ success: true, data, ...meta });
}

export function paginated<T>(
  res: Response,
  data: T[],
  total: number,
  page: number,
  limit: number,
) {
  return res.json({
    success: true,
    data,
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    },
  });
}
