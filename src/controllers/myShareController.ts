import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import supabase from '../config/db';
import bcrypt from 'bcryptjs';

// --- 1. LẤY DANH SÁCH TÀI LIỆU CỦA TÔI ---
export const getMyDocuments = async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.user!.id;
  try {
    const { data: docs, error } = await supabase
      .from('documents')
      .select('*')
      .eq('owner_id', userId)
      .or('expires_at.is.null,expires_at.gt.now()') // Lấy cả file không có hạn và file chưa hết hạn
      .eq('status', 'active')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ documents: docs || [] });
  } catch (error: any) {
    console.error("Get My Docs Error:", error.message);
    res.status(500).json({ message: 'Failed to fetch your documents' });
  }
};

// --- 2. XÓA TÀI LIỆU ---
export const deleteDocument = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const userId = req.user!.id;

  try {
    // Kiểm tra quyền sở hữu trước khi xóa
    const { data: doc } = await supabase
      .from('documents')
      .select('file_url, owner_id')
      .eq('id', id)
      .single();

    if (!doc) {
      res.status(404).json({ message: 'Document not found' });
      return;
    }

    if (doc.owner_id !== userId) {
      res.status(403).json({ message: 'Not authorized to delete this file' });
      return;
    }

    // Xóa file trong Storage (Nếu không phải Link)
    if (!doc.file_url.startsWith('http')) {
       await supabase.storage.from('documents').remove([doc.file_url]);
    }

    // Xóa record trong Database
    const { error } = await supabase
      .from('documents')
      .delete()
      .eq('id', id);

    if (error) throw error;

    res.json({ message: 'Deleted successfully' });

  } catch (error: any) {
    console.error("Delete Error:", error.message);
    res.status(500).json({ message: 'Failed to delete document' });
  }
};

// --- 3. CẬP NHẬT MẬT KHẨU BẢO VỆ ---
export const updatePasswordProtection = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const { password, isProtected } = req.body;
  const userId = req.user!.id;

  console.log("Update Password Request:", { id, password: password ? "***" : undefined, isProtected, userId });

  try {
    // Kiểm tra quyền sở hữu
    const { data: doc, error: fetchError } = await supabase
      .from('documents')
      .select('owner_id, id')
      .eq('id', id)
      .single();

    console.log("Document lookup result:", { doc, fetchError });

    if (fetchError) {
      console.error("Database fetch error:", fetchError);
      res.status(500).json({ message: 'Database error', error: fetchError.message });
      return;
    }

    if (!doc) {
      console.log("Document not found for ID:", id);
      res.status(404).json({ message: 'Document not found' });
      return;
    }

    console.log("Document found:", { docId: doc.id, ownerId: doc.owner_id, userId });

    if (doc.owner_id !== userId) {
      console.log("Ownership check failed:", { docOwnerId: doc.owner_id, userId });
      res.status(403).json({ message: 'Not authorized to modify this file' });
      return;
    }

    let passwordHash = null;
    let isProtectedBool = isProtected;

    // Xử lý mật khẩu
    if (isProtectedBool) {
      if (password && password.trim() !== '') {
        const salt = await bcrypt.genSalt(10);
        passwordHash = await bcrypt.hash(password.trim(), salt);
      } else {
        res.status(400).json({ message: 'Password is required when enabling protection' });
        return;
      }
    }

    // Cập nhật database
    const { data: updatedDoc, error } = await supabase
      .from('documents')
      .update({
        is_protected: isProtectedBool,
        password_hash: passwordHash
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error("Supabase Update Error:", error);
      res.status(500).json({ message: 'Database update failed' });
      return;
    }

    console.log("Update successful:", updatedDoc);
    res.json({ 
      message: 'Password protection updated successfully', 
      document: updatedDoc 
    });

  } catch (error: any) {
    console.error("Update Password Error:", error.message);
    res.status(500).json({ message: 'Failed to update password protection' });
  }
};