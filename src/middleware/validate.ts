// src/middleware/validate.ts
import { Request, Response, NextFunction } from 'express';
import { ZodType } from 'zod';

const sendValidationError = (res: Response, issues: any[]): void => {
  const first = issues[0];
  const field = first && Array.isArray(first.path) && first.path.length > 0 ? first.path.join('.') : 'request';
  res.status(400).json({
    message: first ? `${field}: ${first.message}` : 'Invalid input',
    code: 'VALIDATION_ERROR',
  });
};

/** Validate & chuẩn hoá req.body bằng zod schema */
export const validateBody =
  (schema: ZodType) =>
  (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      sendValidationError(res, result.error.issues as any);
      return;
    }
    req.body = result.data;
    next();
  };

/** Validate req.query bằng zod schema (không ghi lại — Express 5 query là getter) */
export const validateQuery =
  (schema: ZodType) =>
  (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      sendValidationError(res, result.error.issues as any);
      return;
    }
    next();
  };
