import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import supabase from '../config/db';

export const uploadAvatar = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user.id;
    const file = req.file; // File do Multer xử lý

    if (!file) {
      res.status(400).json({ message: 'No file uploaded' });
      return;
    }

    // 1. Upload lên Supabase Storage
    const fileExt = file.originalname.split('.').pop();
    const filePath = `${userId}/${Date.now()}.${fileExt}`;

    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
        upsert: true // Ghi đè nếu cần
      });

    if (uploadError) throw uploadError;

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
    res.status(500).json({ message: 'Upload failed', error: error.message });
  }
};