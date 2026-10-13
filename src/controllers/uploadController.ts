import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import supabase from '../config/db';
import { AVATAR_MIME_TO_EXT } from '../middleware/uploadValidation';

export const uploadAvatar = async (req: AuthRequest, res: Response): Promise<void> => {
  let uploadedFilePath: string | null = null;
  try {
    const userId = req.user.id;
    const file = req.file; // File do Multer xử lý

    if (!file) {
      res.status(400).json({ message: 'No file uploaded' });
      return;
    }

    // 1. Upload lên Supabase Storage (đổi extension theo mimetype, không tin originalname)
    const fileExt = AVATAR_MIME_TO_EXT[file.mimetype?.toLowerCase()] || 'jpg';
    const filePath = `${userId}/${Date.now()}.${fileExt}`;

    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
        upsert: true // Ghi đè nếu cần
      });

    if (uploadError) throw uploadError;
    uploadedFilePath = filePath;

    // 2. Lấy Public URL
    const { data: { publicUrl } } = supabase.storage
      .from('avatars')
      .getPublicUrl(filePath);

    // 3. Cập nhật vào bảng Users
    const { error: dbError } = await supabase
      .from('users')
      .update({ avatar_url: publicUrl })
      .eq('id', userId);

    if (dbError) throw dbError;

    // 4. Trả về kết quả
    res.json({ 
      message: 'Avatar uploaded successfully', 
      avatar_url: publicUrl 
    });

  } catch (error: any) {
    console.error('Upload Error:', error.message);

    // Dọn file mồ côi nếu lỗi sau khi đã upload
    if (uploadedFilePath) {
      const { error: cleanupError } = await supabase.storage
        .from('avatars')
        .remove([uploadedFilePath]);
      if (cleanupError) console.error('Avatar cleanup failed:', cleanupError.message);
    }

    res.status(500).json({ message: 'Upload failed' });
  }
};