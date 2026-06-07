export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, DELETE, CONNECT, OPTIONS, TRACE, PATCH, PROPFIND, PROPPATCH, MKCOL, COPY, MOVE, LOCK, UNLOCK",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, Depth, Destination, Overwrite, If-Match, Accept",
      "Access-Control-Expose-Headers": "Location, Content-Length, ETag, X-Debug-Log",
      "Access-Control-Max-Age": "86400",
    };

    // 1. Nếu là gói tin OPTIONS (Pre-flight của trình duyệt để xin phép CORS), mình trả về luôn
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    // 2. Chuyển đổi URL từ Worker URL sang URL của Nextcloud
    const targetUrl = new URL(request.url);
    
    // ĐỔI DÒNG NÀY SANG DOMAIN NEXTCLOUD CỦA BẠN (Không chứa http hay dấu / ở cuối)
    targetUrl.hostname = "kai.nl.tab.digital";

    const newRequestInit = {
      method: request.method,
      headers: new Headers(request.headers),
      redirect: "follow",
    };

    // Forward cả Body với những request cụ thể của WebDAV
    if (["POST", "PUT", "PATCH", "PROPFIND", "PROPPATCH", "LOCK", "MKCOL"].includes(request.method) && request.body) {
      newRequestInit.body = request.body;
    } else if (["MKCOL"].includes(request.method)) {
      newRequestInit.body = null;
    }

    try {
      // 3. Tiến hành gọi tới server Nextcloud thật
      const response = await fetch(targetUrl.toString(), newRequestInit);

      // 4. Lấy trả lời từ Nextcloud, gắn thêm gói header CORS vào và trả lại cho ứng dụng
      const newResponse = new Response(response.body, response);
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
