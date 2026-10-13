import multer from 'multer';

// --- Allowlist loại file ---
// Ảnh (KHÔNG gồm svg - rủi ro stored XSS)
const IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/heic',
  'image/heif',
  'image/avif',
]);

// Video
const VIDEO_MIMES = new Set([
  'video/mp4',
  'video/quicktime',
  'video/x-msvideo',
  'video/x-matroska',
  'video/webm',
  'video/3gpp',
  'video/mpeg',
  'video/x-flv',
  'video/x-m4v',
]);

// Tài liệu
const DOCUMENT_MIMES = new Set([
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip',
  'application/x-7z-compressed',
  'application/x-rar-compressed',
  'application/gzip',
  'application/x-gzip',
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'audio/x-m4a',
]);

// Extension hợp lệ (dùng khi mimetype là octet-stream / trống)
const ALLOWED_EXTS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic', 'heif', 'avif',
  'mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'wmv', '3gp', 'm4v', 'mpg', 'mpeg',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv',
  'zip', 'rar', '7z', 'gz',
  'mp3', 'm4a', 'wav',
]);

const AVATAR_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic', 'heif']);

const getExt = (filename?: string): string => {
  if (!filename || !filename.includes('.')) return '';
  return filename.split('.').pop()!.toLowerCase();
};

const isAllowed = (
  mimetype: string,
  filename: string,
  allowedMimes: Set<string>,
  allowedExts: Set<string>
): boolean => {
  const mime = (mimetype || '').toLowerCase();
  const ext = getExt(filename);

  if (allowedMimes.has(mime)) return true;
  // Mimetype không xác định / octet-stream -> chấp nhận nếu extension hợp lệ
  if ((mime === '' || mime === 'application/octet-stream') && allowedExts.has(ext)) {
    return true;
  }
  return false;
};

const reject = (cb: multer.FileFilterCallback) => {
  cb(Object.assign(new Error('File type not allowed'), { code: 'INVALID_FILE_TYPE' }));
};

// Filter cho tài liệu chia sẻ (Photos / Videos / Files)
export const documentFileFilter: multer.Options['fileFilter'] = (req, file, cb) => {
  if (isAllowed(file.mimetype, file.originalname, DOCUMENT_MIMES, ALLOWED_EXTS)
    || isAllowed(file.mimetype, file.originalname, IMAGE_MIMES, ALLOWED_EXTS)
    || isAllowed(file.mimetype, file.originalname, VIDEO_MIMES, ALLOWED_EXTS)) {
    cb(null, true);
    return;
  }
  reject(cb);
};

// Filter cho avatar - CHỈ ảnh
export const avatarFileFilter: multer.Options['fileFilter'] = (req, file, cb) => {
  if (isAllowed(file.mimetype, file.originalname, IMAGE_MIMES, AVATAR_EXTS)) {
    cb(null, true);
    return;
  }
  reject(cb);
};

// Đổi extension theo mimetype (không tin vào originalname)
export const AVATAR_MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/avif': 'avif',
};
