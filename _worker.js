export default {
  async fetch(request, env) {
    // 1. XỬ LÝ PRE-FLIGHT CORS CHO TRÌNH DUYỆT
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

    // 2. YÊU CẦU PHẢI CÓ THÔNG TIN ĐĂNG NHẬP TỪ APP GỬI LÊN
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Basic ")) {
      return new Response(JSON.stringify({ error: "Yêu cầu đăng nhập (Missing Basic Auth)" }), {
        status: 401,
        headers: { 
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*" 
        }
      });
    }

    // 3. GIẢI MÃ HEADER ĐỂ LẤY USERNAME (Mục đích để xác định thư mục của ai)
    let username = "";
    try {
      const base64Credentials = authHeader.split(' ')[1];
      const credentials = atob(base64Credentials); // Giải mã base64
      username = credentials.split(':')[0]; // Lấy phần trước dấu hai chấm là Username
    } catch (e) {
      return new Response(JSON.stringify({ error: "Thông tin đăng nhập không hợp lệ" }), { status: 400 });
    }

    // 4. THIẾT LẬP ĐƯỜNG DẪN SANDBOX (Nhốt vào dataNotMaths)
    const targetHost = "https://kai.nl.tab.digital";
    const sandboxFolder = "dataNotMaths";
    
    const url = new URL(request.url);
    let safePath = url.pathname;
    if (safePath === "/") safePath = ""; 

    // Đường dẫn WebDAV chuẩn của Nextcloud/Tab.Digital
    const nextcloudDavPath = `/remote.php/dav/files/${username}/${sandboxFolder}${safePath}`;
    const targetUrl = new URL(nextcloudDavPath + url.search, targetHost);

    // 5. CHUYỂN TIẾP HEADERS VÀ XỬ LÝ LỆNH MOVE/COPY WEBDAV
    const headers = new Headers(request.headers);
    headers.set("Host", targetUrl.hostname); // Bắt buộc đổi Host

    // Xử lý bảo mật cho lệnh di chuyển/copy file
    const destinationHeader = headers.get("Destination");
    if (destinationHeader) {
       const destUrl = new URL(destinationHeader);
       const destRewrite = new URL(`/remote.php/dav/files/${username}/${sandboxFolder}${destUrl.pathname}`, targetHost);
       headers.set("Destination", destRewrite.toString());
    }

    // 6. GỬI REQUEST CHO SERVER GỐC
    const modifiedRequest = new Request(targetUrl, {
      method: request.method,
      headers: headers,
      body: request.body,
      redirect: "follow"
    });

    try {
      const response = await fetch(modifiedRequest);

      // 7. NHẬN KẾT QUẢ, XÓA BẢO MẬT GỐC VÀ TRẢ VỀ APP
      const newResponse = new Response(response.body, response);
      
      // Chống CORS
      newResponse.headers.set("Access-Control-Allow-Origin", "*");
      newResponse.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, PROPFIND, MKCOL, COPY, MOVE");
      newResponse.headers.set("Access-Control-Allow-Headers", "*");
      
      // Gỡ bỏ các rào cản chặn hiển thị app
      newResponse.headers.delete("Content-Security-Policy");
      newResponse.headers.delete("X-Frame-Options");
      newResponse.headers.delete("X-XSS-Protection");

      return newResponse;
    } catch (error) {
      return new Response(JSON.stringify({ error: "Lỗi kết nối tới Server gốc" }), {
        status: 502,
        headers: { "Access-Control-Allow-Origin": "*" }
      });
    }
  }
};
