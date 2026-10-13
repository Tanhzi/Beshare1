import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import supabase from '../config/db';
import bcrypt from 'bcryptjs';

// Hàm hỗ trợ tính thời gian hết hạn
const isSupabaseStorageSizeLimitError = (error: any): boolean => {
  const message = String(error?.message || error?.error || '').toLowerCase();
  return message.includes('maximum allowed size') || message.includes('object exceeded');
};

const sendUploadError = (res: Response, error: any, logPrefix: string): void => {
  const message = error?.message || 'Unknown upload error';
  console.error(`${logPrefix}:`, message);

  if (isSupabaseStorageSizeLimitError(error)) {
    res.status(413).json({
      message:
        'File exceeds the Supabase Storage size limit. Increase the Supabase global and bucket file size limits, or upload a smaller file.',
    });
    return;
  }

  res.status(500).json({ message: 'Upload failed' });
};
const parseDbTimestamp = (value: string): number => {
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value);
  return new Date(hasTimezone ? value : `${value}Z`).getTime();
};
// Extension an toàn: lấy theo tên file, fallback theo mimetype, cuối cùng là 'bin'
const resolveFileExt = (fileName: string, mimeType?: string): string => {
  const extFromName = fileName.includes('.')
    ? (fileName.split('.').pop() || '').toLowerCase().trim()
    : '';
  const extFromMime = (mimeType || '').split('/')[1]?.replace(/\+.*$/, '').toLowerCase() || '';
  return extFromName || extFromMime || 'bin';
};

// Chèn documents — hỗ trợ cột text_content (nếu migration chưa chạy thì retry không cột)
const insertDocumentRow = async (
  payload: Record<string, unknown>,
  opts?: { textContent?: string }
): Promise<{ doc: any; error: any }> => {
  let { data, error } = await supabase
    .from('documents')
    .insert([payload])
    .select()
    .single();

  if (error && opts?.textContent !== undefined && String(error.message || '').includes('text_content')) {
    // Cột text_content chưa có (migration chưa chạy) -> lưu payload cũ (file .txt đã nằm trong Storage)
    const legacyPayload = { ...payload };
    delete legacyPayload.text_content;
    ({ data, error } = await supabase
      .from('documents')
      .insert([legacyPayload])
      .select()
      .single());
  }

  return { doc: data, error };
};

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
  const userId = req.user.id;
  const { 
    category, 
    linkContent, 
    textContent, 
    expiration, 
    password, 
    isAnonymous,
    isPublicSharing
  } = req.body;

  const file = req.file;

  // Tọa độ đã được validate (range + kiểu số) ở middleware validateBody
  const latNum = Number(req.body.latitude);
  const longNum = Number(req.body.longitude);
  const locationPoint = `POINT(${longNum} ${latNum})`; // PostGIS: POINT(long lat)

  // --- LINKED-ONLY: kiểm tra ĐÃ có partner TRƯỚC khi upload (B4) ---
  // Biển request 'isPublicSharing' thực chất nghĩa là "chỉ chia sẻ cho partner"
  const linkedOnly = isPublicSharing === 'true' || isPublicSharing === true;
  let partnerId: string | null = null;

  if (linkedOnly) {
    const { data: connection, error: connError } = await supabase
      .from('connections')
      .select('requester_id, receiver_id')
      .or(`requester_id.eq.${userId},receiver_id.eq.${userId}`)
      .eq('status', 'connected')
      .maybeSingle();

    if (connError) {
      console.error('Link Check Error:', connError.message);
      res.status(500).json({ message: 'Server error' });
      return;
    }

    if (!connection) {
      // Không âm thầm biến tài liệu thành công khai
      res.status(400).json({
        message: 'No connected partner to share with. Link a partner first or turn off linked-only sharing.',
      });
      return;
    }

    partnerId = connection.requester_id === userId
      ? connection.receiver_id
      : connection.requester_id;
  }

  // Đường dẫn file đã upload (dể dọn dẹp nếu lỗi ở bước sau)
  let uploadedFilePath: string | null = null;

  try {
    let fileUrl = '';
    let fileName = '';
    let fileSize = 0;

    // --- XỬ LÝ NỘI DUNG THEO LOẠI ---
    if (category === 'Photos' || category === 'Videos' || category === 'Files') {
      if (!file) {
        res.status(400).json({ message: 'No file uploaded' });
        return;
      }

      fileName = file.originalname;
      fileSize = file.size;
      const fileExt = resolveFileExt(fileName, file.mimetype);
      const filePath = `${userId}/${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('documents')
        .upload(filePath, file.buffer, {
          contentType: file.mimetype,
          upsert: false
        });

      if (uploadError) throw uploadError;
      fileUrl = filePath;
      uploadedFilePath = filePath;
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
      fileSize = Buffer.byteLength(textContent.trim(), 'utf-8');
      const buffer = Buffer.from(textContent.trim(), 'utf-8');
      const filePath = `${userId}/${fileName}`;
      
      const { error } = await supabase.storage.from('documents').upload(filePath, buffer, { contentType: 'text/plain' });
      if (error) throw error;
      fileUrl = filePath;
      uploadedFilePath = filePath;
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

    // --- LƯU VÀO DATABASE ---
    const insertPayload: Record<string, unknown> = {
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
      location: locationPoint,
    };
    if (category === 'Text') insertPayload.text_content = textContent.trim();

    const { doc: newDoc, error: dbError } = await insertDocumentRow(
      insertPayload,
      category === 'Text' ? { textContent: textContent.trim() } : undefined
    );

    if (dbError) throw dbError;

    // --- GHI NHẬN LINKED-ONLY (private_share) ---
    if (linkedOnly && newDoc && partnerId) {
      const { error: privateShareError } = await supabase.from('transfer_history').insert({
        document_id: newDoc.id,
        sender_id: userId,
        receiver_id: partnerId,
        action_type: 'private_share',
      });

      if (privateShareError) {
        // Không để tài liệu "lọt" ra công khai khi không ghi được nhãn private_share
        await supabase.from('documents').delete().eq('id', newDoc.id);
        throw privateShareError;
      }
    }

    res.status(201).json({ 
      message: 'Shared successfully', 
      document: newDoc 
    });

  } catch (error: any) {
    // Dọn file mồ côi trong Storage nếu lỗi sau khi đã upload (B2)
    if (uploadedFilePath) {
      const { error: cleanupError } = await supabase.storage
        .from('documents')
        .remove([uploadedFilePath]);
      if (cleanupError) console.error('Storage cleanup failed:', cleanupError.message);
    }
    sendUploadError(res, error, 'Share Error');
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
    isAnonymous
  } = req.body;

  const file = req.file;

  // Tọa độ đã được validate (range + kiểu số) ở middleware validateBody
  const latNum = Number(req.body.latitude);
  const longNum = Number(req.body.longitude);
  const locationPoint = `POINT(${longNum} ${latNum})`; // PostGIS: POINT(long lat)

  // Đường dẫn file đã upload (để dọn dẹp nếu lỗi ở bước sau)
  let uploadedFilePath: string | null = null;

  try {
    let fileUrl = '';
    let fileName = '';
    let fileSize = 0;

    // --- XỬ LÝ NỘI DUNG THEO LOẠI ---
    if (category === 'Photos' || category === 'Videos' || category === 'Files') {
      if (!file) {
        res.status(400).json({ message: 'No file uploaded' });
        return;
      }

      fileName = file.originalname;
      fileSize = file.size;
      const fileExt = resolveFileExt(fileName, file.mimetype);
      const filePath = `public/${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('documents')
        .upload(filePath, file.buffer, {
          contentType: file.mimetype,
          upsert: false
        });

      if (uploadError) throw uploadError;
      fileUrl = filePath;
      uploadedFilePath = filePath;
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
      fileSize = Buffer.byteLength(textContent.trim(), 'utf-8');
      const buffer = Buffer.from(textContent.trim(), 'utf-8');
      const filePath = `public/${fileName}`;
      
      const { error } = await supabase.storage.from('documents').upload(filePath, buffer, { contentType: 'text/plain' });
      if (error) throw error;
      fileUrl = filePath;
      uploadedFilePath = filePath;
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

    // --- LƯU VÀO DATABASE ---
    const insertPayload: Record<string, unknown> = {
      owner_id: null, // Public sharing - no owner
      name: fileName,
      file_url: fileUrl,
      file_type: category,
      file_size: fileSize,
      is_protected: isProtected,
      password_hash: passwordHash,
      is_anonymous: isAnonymousBool, // Always anonymous for public sharing
      expires_at: expiresAt,
      status: 'active',
      location: locationPoint,
    };
    if (category === 'Text') insertPayload.text_content = textContent.trim();

    const { doc: newDoc, error: dbError } = await insertDocumentRow(
      insertPayload,
      category === 'Text' ? { textContent: textContent.trim() } : undefined
    );

    if (dbError) throw dbError;

    res.status(201).json({ 
      message: 'Shared successfully', 
      document: newDoc 
    });

  } catch (error: any) {
    // Dọn file mồ côi trong Storage nếu lỗi sau khi đã upload (B2)
    if (uploadedFilePath) {
      const { error: cleanupError } = await supabase.storage
        .from('documents')
        .remove([uploadedFilePath]);
      if (cleanupError) console.error('Storage cleanup failed:', cleanupError.message);
    }
    sendUploadError(res, error, 'Public Share Error');
  }
};

// --- 2. HÀM QUÉT TÀI LIỆU GẦN ĐÂY ---
export const scanNearbyDocuments = async (req: AuthRequest, res: Response): Promise<void> => {
  // Query đã được validate (range, kiểu số) ở middleware validateQuery
  const { latitude, longitude, radius } = req.query;
  const myId = req.user?.id;

  const lat = parseFloat(latitude as string);
  const long = parseFloat(longitude as string);
  const dist = radius !== undefined ? parseFloat(radius as string) : 30;

  if (isNaN(lat) || isNaN(long) || isNaN(dist)) {
    res.status(400).json({ message: 'Invalid coordinates or radius' });
    return;
  }

  try {
    // Gọi RPC function đã tạo trong Supabase SQL
    const { data: documents, error } = await supabase
      .rpc('get_nearby_documents', {
        lat: lat,
        long: long,
        radius_meters: dist
      });

    if (error) throw error;

    // Lọc lại status/hết hạn trong code (không phụ thuộc RPC) — B6
    let filteredDocs = (documents || []).filter((doc: any) => {
      if (doc.status && doc.status !== 'active') return false;
      if (doc.expires_at && parseDbTimestamp(doc.expires_at) <= Date.now()) return false;
      return true;
    });

    // Loại bỏ tài liệu do chính người dùng tạo
    if (myId) {
      filteredDocs = filteredDocs.filter((doc: any) => doc.owner_id !== myId);
    }

    // Loại bỏ tài liệu private_share (chỉ share cho partner linked)
    if (filteredDocs.length > 0) {
      const docIds = filteredDocs.map((d: any) => d.id);
      const { data: privateShares } = await supabase
        .from('transfer_history')
        .select('document_id')
        .in('document_id', docIds)
        .eq('action_type', 'private_share');

      if (privateShares && privateShares.length > 0) {
        const privateIds = new Set(privateShares.map((p: any) => p.document_id));
        filteredDocs = filteredDocs.filter((d: any) => !privateIds.has(d.id));
      }

      // Ghi lịch sử 'share' (README: share / download / private_share) — B6
      // Chỉ ghi 1 lần cho mỗi (document, người quét); doc public (owner null) thì bỏ qua
      if (myId) {
        const { data: existingShares } = await supabase
          .from('transfer_history')
          .select('document_id')
          .eq('receiver_id', myId)
          .eq('action_type', 'share')
          .in('document_id', docIds);

        const sharedIds = new Set((existingShares || []).map((s: any) => s.document_id));
        const shareRows = filteredDocs
          .filter((d: any) => d.owner_id && !sharedIds.has(d.id))
          .map((d: any) => ({
            document_id: d.id,
            sender_id: d.owner_id,
            receiver_id: myId,
            action_type: 'share',
          }));

        if (shareRows.length > 0) {
          const { error: shareError } = await supabase
            .from('transfer_history')
            .insert(shareRows);
          if (shareError) console.error('Share log Error:', shareError.message);
        }
      }
    }

    // Che thông tin chủ sở hữu khi is_anonymous — B6
    filteredDocs = filteredDocs.map((doc: any) =>
      doc.is_anonymous ? { ...doc, owner_id: null, owner_name: null } : doc
    );

    res.json({ documents: filteredDocs });

  } catch (error: any) {
    console.error('Scan Error:', error.message);
    res.status(500).json({ message: 'Scan failed' });
  }
};

// --- 3. XÁC THỰC MẬT KHẨU & LẤY LINK TẢI ---
export const verifyDocumentPassword = async (req: AuthRequest, res: Response): Promise<void> => {
  const { documentId, password } = req.body;

  try {
    // 1. Lấy thông tin file từ Database (select '*' để không vỡ khi cột text_content chưa có)
    const { data: doc, error } = await supabase
      .from('documents')
      .select('*')
      .eq('id', documentId)
      .single();

    if (error || !doc) {
      res.status(404).json({ message: 'Document not found' });
      return;
    }

    // 1.1. Kiểm tra tài liệu hết hạn
    const isExpired =
      doc.status === 'expired' ||
      (doc.expires_at && parseDbTimestamp(doc.expires_at) <= Date.now());
    if (isExpired) {
      res.status(410).json({ message: 'Document has expired' });
      return;
    }

    // 2. Kiểm tra mật khẩu (Giữ nguyên logic cũ)
    if (doc.is_protected) {
      if (!password) {
        res.status(400).json({ message: 'Password is required' });
        return;
      }
      const isMatch = await bcrypt.compare(password, doc.password_hash);
      if (!isMatch) {
        res.status(401).json({ message: 'Incorrect password' });
        return;
      }
    }

    // 3. Ghi lịch sử tải xuống — B6: check lỗi thay vì nuốt
    const logDownload = async (): Promise<void> => {
      if (!req.user?.id) return;
      const { error: logError } = await supabase.from('transfer_history').insert({
        document_id: doc.id,
        sender_id: doc.owner_id,
        receiver_id: req.user.id,
        action_type: 'download',
      });
      if (logError) console.error('Transfer log Error:', logError.message);
    };

    if (doc.file_type === 'Links') {
      res.json({ type: 'link', url: doc.file_url, downloadUrl: doc.file_url });
      return;
    }

    // 4. TRƯỜNG HỢP TEXT — trả cùng cấu trúc với /download (nội dung + downloadUrl) — B6
    if (doc.file_type === 'Text' || doc.file_type === 'txt') {
      let textContent =
        typeof doc.text_content === 'string' && doc.text_content ? doc.text_content : null;
      if (!textContent && doc.file_url) {
        const { data: fileData, error: downError } = await supabase.storage
          .from('documents')
          .download(doc.file_url);
        if (!downError && fileData) textContent = await fileData.text();
      }

      const { data: signedData, error: signError } = await supabase.storage
        .from('documents')
        .createSignedUrl(doc.file_url, 300);
      if (signError || !signedData) {
        throw new Error('Could not generate download link');
      }

      res.json({
        type: 'text',
        content: textContent ?? '',
        fileName: doc.name,
        downloadUrl: signedData.signedUrl,
      });
      await logDownload();
      return;
    }

    // 5. Xử lý file, ảnh, video: tạo signed URL (hạn 300 giây / 5 phút)
    const { data: signedData, error: signError } = await supabase
      .storage
      .from('documents')
      .createSignedUrl(doc.file_url, 300);

    if (signError || !signedData) {
      throw new Error('Could not generate download link');
    }

    res.json({ type: 'file', fileName: doc.name, downloadUrl: signedData.signedUrl });
    await logDownload();

  } catch (error: any) {
    console.error("Verify Error:", error);
    res.status(500).json({ message: 'Server error' });
  }
};


// --- API MỚI: LẤY LINK TẢI HOẶC NỘI DUNG AN TOÀN ---
export const getDocumentDownload = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const userId = req.user?.id; // Có thể undefined với route public

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

    // 1.1. Kiểm tra tài liệu hết hạn
    const isExpired =
      doc.status === 'expired' ||
      (doc.expires_at && parseDbTimestamp(doc.expires_at) <= Date.now());
    if (isExpired) {
      res.status(410).json({ message: 'Document has expired' });
      return;
    }

    // 1.2. Kiểm tra mật khẩu bảo vệ (bắt buộc, không để client tự quyết)
    if (doc.is_protected) {
      const password =
        typeof req.query.password === 'string' ? req.query.password : '';
      if (!password) {
        res.status(401).json({ message: 'Password required' });
        return;
      }
      const isMatch = doc.password_hash
        ? await bcrypt.compare(password, doc.password_hash)
        : false;
      if (!isMatch) {
        res.status(401).json({ message: 'Incorrect password' });
        return;
      }
    }

    // 2. Helper: ghi transfer_history — B6: check lỗi thay vì nuốt
    const logTransfer = (): void => {
      if (!userId) return;
      supabase
        .from('transfer_history')
        .insert({
          document_id: doc.id,
          sender_id: doc.owner_id,
          receiver_id: userId,
          action_type: 'download',
        })
        .then(({ error: logError }) => {
          if (logError) console.error('Transfer log Error:', logError.message);
        });
    };

    // 3. Xử lý theo loại file

    // TRƯỜNG HỢP A: Text -> Ưu tiên đọc cột text_content, fallback file trong Storage
    if (doc.file_type === 'Text' || doc.file_type === 'txt') {
      let textContent =
        typeof doc.text_content === 'string' && doc.text_content ? doc.text_content : null;

      if (!textContent && doc.file_url) {
        const { data: fileData, error: downError } = await supabase.storage
          .from('documents')
          .download(doc.file_url);
        if (downError) throw downError;
        textContent = await fileData.text();
      }

      // downloadUrl cho khớp cấu trúc với verify-password (FE dùng để tải .txt)
      const { data: signedData, error: signError } = await supabase.storage
        .from('documents')
        .createSignedUrl(doc.file_url, 300);
      if (signError || !signedData) {
        throw new Error('Could not generate download link');
      }

      res.json({
        type: 'text',
        content: textContent ?? '',
        fileName: doc.name,
        downloadUrl: signedData.signedUrl,
      });
      logTransfer();
      return;
    }

    // TRƯỜNG HỢP B: Là Link -> Trả về link gốc (đã lưu trong DB)
    if (doc.file_type === 'Links') {
      res.json({
        type: 'link',
        url: doc.file_url, // Link gốc
        downloadUrl: doc.file_url,
      });
      logTransfer();
      return;
    }

    // TRƯỜNG HỢP C: File/Ảnh/Video -> tạo signed URL (hạn 300 giây / 5 phút)
    const { data: signedData, error: signError } = await supabase
      .storage
      .from('documents')
      .createSignedUrl(doc.file_url, 300);

    if (signError) throw signError;

    res.json({
      type: 'file',
      downloadUrl: signedData.signedUrl, // Link này an toàn, hết hạn sẽ không dùng được
      fileName: doc.name
    });
    logTransfer();

  } catch (error: any) {
    console.error("Get Download Error:", error);
    res.status(500).json({ message: 'Server error retrieving document' });
  }
};
