import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import supabase from '../config/db';
import bcrypt from 'bcryptjs';

// Hàm hỗ trợ tính thời gian hết hạn
const calculateExpiration = (option: string): string | null => {
  const now = new Date();
  switch (option) {
    case '1 hour': return new Date(now.getTime() + 60 * 60 * 1000).toISOString();
    case '6 hours': return new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString();
    case '1 day': return new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    case '3 days': return new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString();
    case '7 days': return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    default: return null; // Không bao giờ hết hạn hoặc xử lý mặc định
  }
};

// --- 1. HÀM CHIA SẺ TÀI LIỆU (CÓ VỊ TRÍ) ---
export const shareDocument = async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.user!.id;
  const { 
    category, 
    linkContent, 
    textContent, 
    expiration, 
    password, 
    isAnonymous,
    latitude,
    longitude 
  } = req.body;

  const file = req.file;

  // ✅ Validate vị trí bắt buộc
  if (!latitude || !longitude) {
    res.status(400).json({ message: 'Location is required to share files.' });
    return;
  }

  try {
    let fileUrl = '';
    let fileName = '';
    let fileType = category;
    let fileSize = 0;

    // --- XỬ LÝ NỘI DUNG THEO LOẠI ---
    if (category === 'Photos' || category === 'Videos' || category === 'Files') {
      if (!file) {
        res.status(400).json({ message: 'No file uploaded' });
        return;
      }

      fileName = file.originalname;
      fileSize = file.size;
      const fileExt = fileName.split('.').pop()?.toLowerCase() || 'bin';
      const filePath = `${userId}/${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('documents')
        .upload(filePath, file.buffer, {
          contentType: file.mimetype,
          upsert: false
        });

      if (uploadError) throw uploadError;
      fileUrl = filePath;
    } 
    else if (category === 'Links') {
      if (!linkContent?.trim()) {
        res.status(400).json({ message: 'Link content is required' });
        return;
      }
      fileUrl = linkContent.trim();
      fileName = linkContent.trim();
    } 
    else if (category === 'Text') {
      if (!textContent?.trim()) {
        res.status(400).json({ message: 'Text content is required' });
        return;
      }
      fileName = `note-${Date.now()}.txt`;
      const buffer = Buffer.from(textContent.trim(), 'utf-8');
      const filePath = `${userId}/${fileName}`;
      
      const { error } = await supabase.storage.from('documents').upload(filePath, buffer, { contentType: 'text/plain' });
      if (error) throw error;
      fileUrl = filePath;
    }
    else {
      res.status(400).json({ message: 'Invalid category' });
      return;
    }

    // --- XỬ LÝ MẬT KHẨU ---
    let passwordHash = null;
    let isProtected = false;
    if (password && password.trim() !== '') {
      const salt = await bcrypt.genSalt(10);
      passwordHash = await bcrypt.hash(password.trim(), salt);
      isProtected = true;
    }

    // --- TÍNH THỜI GIAN HẾT HẠN ---
    const expiresAt = calculateExpiration(expiration);

    // --- CHUẨN HÓA GIÁ TRỊ BOOLEAN ---
    const isAnonymousBool = isAnonymous === 'true' || isAnonymous === true;

    // --- CHUYỂN ĐỔI TỌA ĐỘ THÀNH POSTGIS POINT ---
    const latNum = parseFloat(latitude as string);
    const longNum = parseFloat(longitude as string);
    
    if (isNaN(latNum) || isNaN(longNum)) {
      res.status(400).json({ message: 'Invalid latitude or longitude' });
      return;
    }

    const locationPoint = `POINT(${longNum} ${latNum})`; // PostGIS: POINT(long lat)

    // --- LƯU VÀO DATABASE ---
    const { data: newDoc, error: dbError } = await supabase
      .from('documents')
      .insert([{
        owner_id: userId,
        name: fileName,
        file_url: fileUrl,
        file_type: category,
        file_size: fileSize,
        is_protected: isProtected,
        password_hash: passwordHash,
        is_anonymous: isAnonymousBool,
        expires_at: expiresAt,
        status: 'active',
        location: locationPoint
      }])
      .select()
      .single();

    if (dbError) throw dbError;

    res.status(201).json({ 
      message: 'Shared successfully', 
      document: newDoc 
    });

  } catch (error: any) {
    console.error('Share Error:', error.message);
    res.status(500).json({ message: 'Upload failed' });
  }
};

// --- 1.1. HÀM CHIA SẺ TÀI LIỆU CÔNG KHAI (KHÔNG CẦN ĐĂNG NHẬP) ---
export const shareDocumentPublic = async (req: any, res: Response): Promise<void> => {
  const { 
    category, 
    linkContent, 
    textContent, 
    expiration, 
    password, 
    isAnonymous,
    latitude,
    longitude 
  } = req.body;

  const file = req.file;

  // ✅ Validate vị trí bắt buộc
  if (!latitude || !longitude) {
    res.status(400).json({ message: 'Location is required to share files.' });
    return;
  }

  try {
    let fileUrl = '';
    let fileName = '';
    let fileType = category;
    let fileSize = 0;

    // --- XỬ LÝ NỘI DUNG THEO LOẠI ---
    if (category === 'Photos' || category === 'Videos' || category === 'Files') {
      if (!file) {
        res.status(400).json({ message: 'No file uploaded' });
        return;
      }

      fileName = file.originalname;
      fileSize = file.size;
      const fileExt = fileName.split('.').pop()?.toLowerCase() || 'bin';
      const filePath = `public/${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('documents')
        .upload(filePath, file.buffer, {
          contentType: file.mimetype,
          upsert: false
        });

      if (uploadError) throw uploadError;
      fileUrl = filePath;
    } 
    else if (category === 'Links') {
      if (!linkContent?.trim()) {
        res.status(400).json({ message: 'Link content is required' });
        return;
      }
      fileUrl = linkContent.trim();
      fileName = linkContent.trim();
    } 
    else if (category === 'Text') {
      if (!textContent?.trim()) {
        res.status(400).json({ message: 'Text content is required' });
        return;
      }
      fileName = `note-${Date.now()}.txt`;
      const buffer = Buffer.from(textContent.trim(), 'utf-8');
      const filePath = `public/${fileName}`;
      
      const { error } = await supabase.storage.from('documents').upload(filePath, buffer, { contentType: 'text/plain' });
      if (error) throw error;
      fileUrl = filePath;
    }
    else {
      res.status(400).json({ message: 'Invalid category' });
      return;
    }

    // --- XỬ LÝ MẬT KHẨU ---
    let passwordHash = null;
    let isProtected = false;
    if (password && password.trim() !== '') {
      const salt = await bcrypt.genSalt(10);
      passwordHash = await bcrypt.hash(password.trim(), salt);
      isProtected = true;
    }

    // --- TÍNH THỜI GIAN HẾT HẠN ---
    const expiresAt = calculateExpiration(expiration);

    // --- CHUẨN HÓA GIÁ TRỊ BOOLEAN ---
    const isAnonymousBool = isAnonymous === 'true' || isAnonymous === true;

    // --- CHUYỂN ĐỔI TỌA ĐỘ THÀNH POSTGIS POINT ---
    const latNum = parseFloat(latitude as string);
    const longNum = parseFloat(longitude as string);
    
    if (isNaN(latNum) || isNaN(longNum)) {
      res.status(400).json({ message: 'Invalid latitude or longitude' });
      return;
    }

    const locationPoint = `POINT(${longNum} ${latNum})`; // PostGIS: POINT(long lat)

    // --- LƯU VÀO DATABASE ---
    const { data: newDoc, error: dbError } = await supabase
      .from('documents')
      .insert([{
        owner_id: null, // Public sharing - no owner
        name: fileName,
        file_url: fileUrl,
        file_type: category,
        file_size: fileSize,
        is_protected: isProtected,
        password_hash: passwordHash,
        is_anonymous: true, // Always anonymous for public sharing
        expires_at: expiresAt,
        status: 'active',
        location: locationPoint
      }])
      .select()
      .single();

    if (dbError) throw dbError;

    res.status(201).json({ 
      message: 'Shared successfully', 
      document: newDoc 
    });

  } catch (error: any) {
    console.error('Public Share Error:', error.message);
    res.status(500).json({ message: 'Upload failed' });
  }
};

// --- 2. HÀM QUÉT TÀI LIỆU GẦN ĐÂY ---
export const scanNearbyDocuments = async (req: AuthRequest, res: Response): Promise<void> => {
  const { latitude, longitude, radius } = req.query;
  const myId = req.user?.id; // Optional chaining for anonymous users

  if (!latitude || !longitude) {
    res.status(400).json({ message: 'Location required to scan.' });
    return;
  }

  const lat = parseFloat(latitude as string);
  const long = parseFloat(longitude as string);
  const dist = radius ? parseFloat(radius as string) : 30; // mặc định 30 mét

  if (isNaN(lat) || isNaN(long) || isNaN(dist)) {
    res.status(400).json({ message: 'Invalid coordinates or radius' });
    return;
  }

  try {
    // Gọi hàm RPC đã tạo trong Supabase SQL
    const { data: documents, error } = await supabase
      .rpc('get_nearby_documents', {
        lat: lat,
        long: long,
        radius_meters: dist
      });

    if (error) throw error;

    // Loại bỏ tài liệu do chính người dùng tạo (chỉ khi có user ID)
    const filteredDocs = myId ? documents.filter((doc: any) => doc.owner_id !== myId) : documents;

    res.json({ documents: filteredDocs });

  } catch (error: any) {
    console.error('Scan Error:', error.message);
    res.status(500).json({ message: 'Scan failed' });
  }
};

// --- 3. XÁC THỰC MẬT KHẨU & LẤY LINK TẢI ---
export const verifyDocumentPassword = async (req: AuthRequest, res: Response): Promise<void> => {
  const { documentId, password } = req.body;

  if (typeof documentId !== 'string' || documentId.length === 0) {
    res.status(400).json({ message: 'Invalid document id' });
    return;
  }

  try {
    // 1. Lấy thông tin file từ Database
    const { data: doc, error } = await supabase
      .from('documents')
      .select('id, password_hash, file_url, is_protected') // file_url ở đây chỉ là path (ví dụ: "abc/xyz.jpg")
      .eq('id', documentId)
      .single();

    if (error || !doc) {
      res.status(404).json({ message: 'Document not found' });
      return;
    }

    // 2. Kiểm tra mật khẩu: yêu cầu password cho MỌI file. Trước đây nếu
    // is_protected=false, endpoint bỏ qua check và cấp signed URL cho bất kỳ
    // ai gọi tới, biến verify-password-public thành download oracle cho mọi file.
    if (doc.is_protected) {
      if (typeof password !== 'string' || password.length === 0) {
        res.status(400).json({ message: 'Password is required' });
        return;
      }
      if (!doc.password_hash) {
        res.status(500).json({ message: 'Document is misconfigured' });
        return;
      }
      const isMatch = await bcrypt.compare(password, doc.password_hash);
      if (!isMatch) {
        res.status(401).json({ message: 'Incorrect password' });
        return;
      }
    }

    // --- SỬA ĐOẠN NÀY ---
    
    // doc.file_url hiện tại là: "881537fc.../1768...jpg" (Sai định dạng download)
    // Chúng ta cần chuyển nó thành: "https://your-project.supabase.co/..."

    // CÁCH 1: Dùng Signed URL (Khuyên dùng - Link chỉ sống trong 60 giây, bảo mật cao)
    const { data: signedData, error: signError } = await supabase
      .storage
      .from('documents') // Tên bucket của bạn
      .createSignedUrl(doc.file_url, 60); // 60 giây hết hạn

    if (signError || !signedData) {
      throw new Error('Could not generate download link');
    }

    const finalUrl = signedData.signedUrl;

    // CÁCH 2: Dùng Public URL (Nếu bucket của bạn là Public và muốn link vĩnh viễn)
    // const { data } = supabase.storage.from('documents').getPublicUrl(doc.file_url);
    // const finalUrl = data.publicUrl;

    // 3. Trả về Full URL cho Frontend
    res.json({ downloadUrl: finalUrl });

  } catch (error: any) {
    console.error("Verify Error:", error);
    res.status(500).json({ message: 'Server error' });
  }
};


// --- API MỚI: LẤY LINK TẢI HOẶC NỘI DUNG AN TOÀN ---
export const getDocumentDownload = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const userId = req.user?.id; // Có thể undefined cho endpoint public

  try {
    // 1. Lấy thông tin file từ DB
    const { data: doc, error } = await supabase
      .from('documents')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !doc) {
      res.status(404).json({ message: 'Document not found' });
      return;
    }

    // 2. Bảo mật: Tôn trọng password protection.
    // Trước đây endpoint này cấp link tải mà không check mật khẩu, cho phép
    // bất kỳ ai biết `id` (kể cả qua /download-public) bypass toàn bộ bảo vệ
    // bằng mật khẩu. Client cần gọi /verify-password(-public) trước để lấy
    // link tải cho file is_protected.
    if (doc.is_protected) {
      res.status(401).json({
        message: 'Password required. Use /verify-password to obtain a download link.',
      });
      return;
    }

    // 3. Xử lý theo loại file
    
    // TRƯỜNG HỢP A: Là Text -> Backend đọc file và trả về nội dung luôn
    if (doc.file_type === 'Text' || doc.file_type === 'txt') {
      const { data: fileData, error: downError } = await supabase.storage
        .from('documents')
        .download(doc.file_url); // Backend tự tải file về RAM

      if (downError) throw downError;

      // Chuyển Buffer thành String
      const textContent = await fileData.text();
      
      res.json({ 
        type: 'text',
        content: textContent,
        fileName: doc.name
      });
      return;
    }

    // TRƯỜNG HỢP B: Là Link -> Trả về link gốc (đã lưu trong DB)
    if (doc.file_type === 'Links') {
      res.json({
        type: 'link',
        url: doc.file_url // Link gốc
      });
      return;
    }

    // TRƯỜNG HỢP C: Là File/Ảnh/Video -> Tạo Signed URL (chỉ sống 60 giây)
    const { data: signedData, error: signError } = await supabase
      .storage
      .from('documents')
      .createSignedUrl(doc.file_url, 60);

    if (signError) throw signError;

    res.json({
      type: 'file',
      downloadUrl: signedData.signedUrl, // Link này an toàn, hết hạn sẽ không dùng được
      fileName: doc.name
    });

  } catch (error: any) {
    console.error("Get Download Error:", error);
    res.status(500).json({ message: 'Server error retrieving document' });
  }
};