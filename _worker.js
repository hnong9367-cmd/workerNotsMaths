export default {
  async fetch(request, env) {
    // 1. Cấu hình CORS để ứng dụng MathEdit trên web có quyền gọi API
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, DELETE, OPTIONS, PROPFIND, MKCOL",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, Depth, overwrite, destination",
      "Access-Control-Expose-Headers": "DAV, content-length, Allow",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          ...corsHeaders,
          "DAV": "1, 2",
          "Allow": "OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, MKCOL"
        }
      });
    }

    // 2. Xác thực Basic Auth (Chặn nếu sai tài khoản/chưa đăng nhập)
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Basic ")) {
      return new Response("Unauthorized", { 
        status: 401, 
        headers: { 
          ...corsHeaders, 
          "WWW-Authenticate": 'Basic realm="MathEdit Storage"' 
        } 
      });
    }

    const base64Str = authHeader.split(" ")[1];
    const credentials = atob(base64Str);
    const [username, password] = credentials.split(":");

    // Đọc thông tin Tài khoản & Mật khẩu từ biến môi trường của Cloudflare
    const expectedUsername = env.USERNAME || "admin";
    const expectedPassword = env.PASSWORD || "password";

    if (username !== expectedUsername || password !== expectedPassword) {
      return new Response("Forbidden: Sai tài khoản hoặc mật khẩu", { status: 403, headers: corsHeaders });
    }

    const url = new URL(request.url);
    let path = decodeURIComponent(url.pathname);
    if (path.startsWith('/')) path = path.substring(1);

    // KẾT NỐI VỚI BUCKET R2 (Lưu trữ file)
    const bucket = env.R2_BUCKET; 
    
    if (!bucket) {
       return new Response("Lỗi: Chưa kết nối R2 Bucket trong cấu hình Worker", { status: 500, headers: corsHeaders });
    }

    try {
      // API: TẢI FILE VỀ (GET)
      if (request.method === "GET") {
        const object = await bucket.get(path);
        if (object === null) {
          return new Response("Not Found", { status: 404, headers: corsHeaders });
        }
        const headers = new Headers(corsHeaders);
        object.writeHttpMetadata(headers);
        headers.set("etag", object.httpEtag);
        return new Response(object.body, { headers });
      }

      // API: UPLOAD FILE (PUT)
      if (request.method === "PUT") {
        await bucket.put(path, request.body, {
          httpMetadata: { contentType: request.headers.get("content-type") || "application/octet-stream" },
        });
        return new Response("Created", { status: 201, headers: corsHeaders });
      }

      // API: XOÁ FILE HOẶC THƯ MỤC (DELETE)
      if (request.method === "DELETE") {
        await bucket.delete(path);
        return new Response("No Content", { status: 204, headers: corsHeaders });
      }

      // API: TẠO THƯ MỤC (MKCOL)
      if (request.method === "MKCOL") {
        let dirPath = path;
        // Storage đám mây không có thư mục thật, thư mục là 1 file tĩnh kết thúc bằng "/"
        if (!dirPath.endsWith('/')) dirPath += '/';
        await bucket.put(dirPath, "");
        return new Response("Created", { status: 201, headers: corsHeaders });
      }

      // API: XEM DANH SÁCH FILE VÀ THƯ MỤC (PROPFIND)
      if (request.method === "PROPFIND") {
        const depth = request.headers.get("Depth") || "1";
        
        let prefix = path === "" ? "" : path;
        if (prefix !== "" && !prefix.endsWith('/')) prefix += '/';

        let r2Objects = [];
        let r2Prefixes = [];
        
        if (depth === "1") {
            const listObj = await bucket.list({ prefix, delimiter: '/' });
            r2Objects = listObj.objects;
            r2Prefixes = listObj.delimitedPrefixes;
        } else if (depth === "0") {
            if (path === "") {
                r2Objects = [{ key: "", size: 0, uploaded: new Date(), httpMetadata: {} }];
            } else {
                let dirPath = path.endsWith('/') ? path : path + '/';
                const fileObj = await bucket.get(path);
                const dirObj = await bucket.get(dirPath);
                
                if (fileObj) {
                    r2Objects = [fileObj];
                } else if (dirObj) {
                    r2Objects = [dirObj];
                } else {
                    const childObj = await bucket.list({ prefix: dirPath, limit: 1 });
                    if (childObj.objects.length > 0 || childObj.delimitedPrefixes.length > 0) {
                        r2Objects = [{ key: dirPath, size: 0, uploaded: new Date(), httpMetadata: {} }];
                    } else {
                        return new Response("Not Found", { status: 404, headers: corsHeaders });
                    }
                }
            }
        } else {
            return new Response("Forbidden: Không hỗ trợ quét thư mục dạng sâu", { status: 403, headers: corsHeaders });
        }

        // Tạo định dạng XML chuẩn WebDAV
        let xml = `<?xml version="1.0" encoding="utf-8" ?>\n`;
        xml += `<D:multistatus xmlns:D="DAV:">\n`;

        if (depth === "1") {
            xml += `  <D:response>\n`;
            xml += `    <D:href>${url.pathname.endsWith('/') ? url.pathname : url.pathname + '/'}</D:href>\n`;
            xml += `    <D:propstat>\n`;
            xml += `      <D:prop>\n`;
            xml += `        <D:resourcetype><D:collection/></D:resourcetype>\n`;
            xml += `      </D:prop>\n`;
            xml += `      <D:status>HTTP/1.1 200 OK</D:status>\n`;
            xml += `    </D:propstat>\n`;
            xml += `  </D:response>\n`;
        }

        for (const pre of r2Prefixes) {
            xml += `  <D:response>\n`;
            xml += `    <D:href>/${pre}</D:href>\n`;
            xml += `    <D:propstat>\n`;
            xml += `      <D:prop>\n`;
            xml += `        <D:resourcetype><D:collection/></D:resourcetype>\n`;
            xml += `      </D:prop>\n`;
            xml += `      <D:status>HTTP/1.1 200 OK</D:status>\n`;
            xml += `    </D:propstat>\n`;
            xml += `  </D:response>\n`;
        }

        for (const obj of r2Objects) {
            if (obj.key === prefix && obj.key !== "") continue;
            let isDir = obj.key.endsWith('/');
            let href = `/${obj.key}`;
            
            xml += `  <D:response>\n`;
            xml += `    <D:href>${href}</D:href>\n`;
            xml += `    <D:propstat>\n`;
            xml += `      <D:prop>\n`;
            xml += `        <D:resourcetype>${isDir ? '<D:collection/>' : ''}</D:resourcetype>\n`;
            xml += `        <D:getcontentlength>${obj.size}</D:getcontentlength>\n`;
            xml += `        <D:getlastmodified>${new Date(obj.uploaded).toUTCString()}</D:getlastmodified>\n`;
            xml += `        <D:creationdate>${new Date(obj.uploaded).toISOString()}</D:creationdate>\n`;
            xml += `      </D:prop>\n`;
            xml += `      <D:status>HTTP/1.1 200 OK</D:status>\n`;
            xml += `    </D:propstat>\n`;
            xml += `  </D:response>\n`;
        }

        xml += `</D:multistatus>`;

        return new Response(xml, {
            status: 207,
            headers: {
                ...corsHeaders,
                "Content-Type": "application/xml; charset=utf-8"
            }
        });
      }

      return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
    } catch (e) {
      return new Response(e.message, { status: 500, headers: corsHeaders });
    }
  }
};
