// ============================================================
//  _worker.js – Cầu nối vạn năng Nextcloud / Tab.Digital
//  Bỏ qua CORS & Ép buộc Sandboxing vào thư mục dataNotMaths
// ============================================================

export default {
  async fetch(request, env) {
    // 1. XỬ LÝ CORS (OPTIONS) CHO APP CỦA BẠN
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, PROPFIND, PROPPATCH, MKCOL, COPY, MOVE",
          "Access-Control-Allow-Headers": "Authorization, Content-Type, Depth, Destination, Overwrite",
          "Access-Control-Max-Age": "86400",
        }
      });
    }

    // 2. BẮT BUỘC APP PHẢI GỬI THÔNG TIN ĐĂNG NHẬP
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Basic ")) {
      return new Response(JSON.stringify({ error: "Yêu cầu đăng nhập (Header Basic Auth bị thiếu)" }), {
        status: 401,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }

    // 3. GIẢI MÃ ĐỂ LẤY TÊN ĐĂNG NHẬP (USERNAME)
    let username = "";
    try {
      const base64Credentials = authHeader.split(' ')[1];
      const credentials = atob(base64Credentials);
      username = credentials.split(':')[0]; // Lấy phần trước dấu hai chấm
    } catch (e) {
      return new Response(JSON.stringify({ error: "Thông tin đăng nhập bị lỗi định dạng" }), { status: 400 });
    }

    // 4. CẤU HÌNH ĐƯỜNG DẪN ĐÍCH
    const targetHost = "https://kai.nl.tab.digital";
    const sandboxFolder = "dataNotMaths";
    
    const url = new URL(request.url);
    let safePath = url.pathname === "/" ? "" : url.pathname; 

    // Ép mọi truy cập vào đường dẫn WebDAV chuẩn của Nextcloud
    const nextcloudDavPath = `/remote.php/dav/files/${username}/${sandboxFolder}${safePath}`;
    const targetUrl = new URL(nextcloudDavPath + url.search, targetHost);

    // 5. CHỈNH SỬA HEADERS ĐỂ ĐÁNH LỪA SERVER GỐC
    const headers = new Headers(request.headers);
    headers.set("Host", targetUrl.hostname);

    // Xử lý riêng cho lệnh COPY/MOVE của WebDAV
    const destinationHeader = headers.get("Destination");
    if (destinationHeader) {
       const destUrl = new URL(destinationHeader);
       const destRewrite = new URL(`/remote.php/dav/files/${username}/${sandboxFolder}${destUrl.pathname}`, targetHost);
       headers.set("Destination", destRewrite.toString());
    }

    // 6. GỬI REQUEST ĐI
    const modifiedRequest = new Request(targetUrl, {
      method: request.method,
      headers: headers,
      body: request.body,
      redirect: "follow"
    });

    try {
      const response = await fetch(modifiedRequest);
      
      // 7. NHẬN KẾT QUẢ, XÓA CORS CỦA SERVER GỐC VÀ TRẢ VỀ APP
      const newResponse = new Response(response.body, response);
      
      newResponse.headers.set("Access-Control-Allow-Origin", "*");
      newResponse.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, PROPFIND, MKCOL, COPY, MOVE");
      newResponse.headers.set("Access-Control-Allow-Headers", "*");
      newResponse.headers.delete("Content-Security-Policy");
      newResponse.headers.delete("X-Frame-Options");
      newResponse.headers.delete("X-XSS-Protection");

      return newResponse;
    } catch (error) {
      return new Response(JSON.stringify({ error: "Lỗi kết nối tới Server gốc", detail: error.message }), { 
        status: 502, 
        headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" } 
      });
    }
  }
};
