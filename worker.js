export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, DELETE, CONNECT, OPTIONS, TRACE, PATCH, PROPFIND, PROPPATCH, MKCOL, COPY, MOVE, LOCK, UNLOCK",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, Depth, Destination, Overwrite, If-Match, Accept",
      "Access-Control-Expose-Headers": "Location, Content-Length, ETag, X-Debug-Log",
      "Access-Control-Max-Age": "86400",
    };

    // 1. Xử lý preflight request từ trình duyệt
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    const targetUrl = new URL(request.url);
    
    // 2. Chuyển hướng tới cấu hình Nextcloud thực tế của bạn
    targetUrl.hostname = "kai.nl.tab.digital";

    const newRequestInit = {
      method: request.method,
      headers: new Headers(request.headers),
      redirect: "follow",
    };

    // 3. Giữ nguyên payload body của các phương thức WebDAV
    if (["POST", "PUT", "PATCH", "PROPFIND", "PROPPATCH", "LOCK", "MKCOL"].includes(request.method) && request.body) {
      newRequestInit.body = request.body;
    } else if (["MKCOL"].includes(request.method)) {
      newRequestInit.body = null;
    }

    try {
      // 4. Gửi request đến Nextcloud
      const response = await fetch(targetUrl.toString(), newRequestInit);
      const newResponse = new Response(response.body, response);
      
      // 5. Thêm lại các thông tin tiêu đề CORS trả về thiết bị của bản
      for (const [key, value] of Object.entries(corsHeaders)) {
        newResponse.headers.set(key, value);
      }
      
      newResponse.headers.set("X-Debug-Log", `Proxied => ${targetUrl.toString()} | Status: ${response.status}`);
      return newResponse;
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message || "Proxy error" }), {
        status: 502,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          "X-Debug-Log": `Proxy Error: ${e.message}`
        }
      });
    }
  }
};
