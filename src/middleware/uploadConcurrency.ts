import { Request, Response, NextFunction } from 'express';

// Giới hạn số request upload (multer memoryStorage) chạy đồng thời (B8)
// để tránh nhiều file 100MB cùng nằm trong RAM → OOM.
const MAX_CONCURRENT_UPLOADS = 5;
let activeUploads = 0;

export const uploadConcurrencyLimiter = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (activeUploads >= MAX_CONCURRENT_UPLOADS) {
    res.status(503).json({
      message: 'Too many concurrent uploads. Please try again shortly.',
    });
    return;
  }

  activeUploads += 1;
  let released = false;
  const release = () => {
    if (!released) {
      released = true;
      activeUploads -= 1;
    }
  };
  res.on('finish', release);
  res.on('close', release);

  next();
};
