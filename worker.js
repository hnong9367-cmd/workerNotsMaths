export default {
  async fetch(request, env, ctx) {
    // 1. Cấu hình CORS Headers tiêu chuẩn cho WebDAV
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*", // Cân nhắc thay bằng domain cụ thể của App nếu cần bảo mật hơn
      "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, DELETE, CONNECT, OPTIONS, TRACE, PATCH, PROPFIND, PROPPATCH, MKCOL, COPY, MOVE, LOCK, UNLOCK",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, Depth, Destination, Overwrite, If-Match, If-None-Match, Accept",
      "Access-Control-Expose-Headers": "Location, Content-Length, ETag, X-Debug-Log, X-Proxy-Error, Retry-After",
      "Access-Control-Max-Age": "86400",
    };

    // 2. Xử lý Preflight Request (OPTIONS)
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    // 3. Chuẩn bị Request gửi tới Nextcloud
    const targetUrl = new URL(request.url);
    targetUrl.hostname = "kai.nl.tab.digital";

    const newRequestInit = {
      method: request.method,
      headers: new Headers(request.headers),
      redirect: "follow",
    };

    // Bắt buộc: Chuyển tiếp IP thật của người dùng để Nextcloud xử lý Brute-force/Rate limit
    const clientIP = request.headers.get("cf-connecting-ip");
    if (clientIP) {
      newRequestInit.headers.set("X-Forwarded-For", clientIP);
    }

    // Giữ nguyên Body cho các phương thức có mang dữ liệu
    const methodsWithBody = ["POST", "PUT", "PATCH", "PROPFIND", "PROPPATCH", "LOCK"];
    if (methodsWithBody.includes(request.method) && request.body) {
      newRequestInit.body = request.body;
    }

    // 4. Bắt đầu đo hiệu năng và Gửi Request
    const start = performance.now();

    try {
      const response = await fetch(targetUrl.toString(), newRequestInit);
      const end = performance.now();
      const duration = (end - start).toFixed(2);

      // Tạo Response trả về cho App
      const newResponse = new Response(response.body, response);
      
      // Gắn Telemetry Header
      newResponse.headers.set("X-Debug-Log", `Proxied in ${duration}ms | Target: ${targetUrl.hostname}`);
      
      // Đánh dấu lỗi rõ ràng nếu Nextcloud trả về mã lỗi (4xx, 5xx)
      if (!response.ok) {
        newResponse.headers.set("X-Proxy-Error", `Nextcloud-Error-${response.status}`);
      }

      // Đính kèm CORS headers
      for (const [key, value] of Object.entries(corsHeaders)) {
        newResponse.headers.set(key, value);
      }
      
      return newResponse;

    } catch (e) {
      // 5. Xử lý lỗi sập mạng, timeout hoặc lỗi cấu hình Worker
      const end = performance.now();
      const duration = (end - start).toFixed(2);

      return new Response(JSON.stringify({ 
        error: "Proxy_Connection_Failed",
        message: e.message || "Unknown Proxy Error"
      }), {
        status: 502,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          "X-Proxy-Error": "Proxy-Internal-Error",
          "X-Debug-Log": `Failed in ${duration}ms`
        }
      });
    }
  }
};
