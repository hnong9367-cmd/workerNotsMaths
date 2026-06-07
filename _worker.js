export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, PUT, POST, DELETE, PROPFIND, MKCOL, MOVE, COPY, PROPPATCH, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, Depth, Destination, Overwrite, X-Target-Url, X-Requested-With",
      "Access-Control-Max-Age": "86400",
    };

    // Xử lý CORS Preflight (OPTIONS)
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    // Lấy URL Nextcloud đích thực tế mà client muốn gọi.
    // Client sẽ truyền URL này thông qua Header "X-Target-Url"
    let targetUrlString = request.headers.get("X-Target-Url");

    // Nếu không truyền qua Header, kiểm tra trong Query Parameter hoặc dùng mặc định từ env
    if (!targetUrlString) {
      const url = new URL(request.url);
      targetUrlString = url.searchParams.get("target");
    }

    if (!targetUrlString) {
      // Nếu không có mốc URL nào, sử dụng mặc định
      const defaultHost = env.DEFAULT_NEXTCLOUD_URL || "https://kai.nl.tab.digital";
      const pathname = new URL(request.url).pathname;
      targetUrlString = `${defaultHost.replace(/\/$/, "")}${pathname}`;
    }

    try {
      const targetUrl = new URL(targetUrlString);
      
      // Tạo một tập hợp các Header mới sạch để truyền đi
      const newHeaders = new Headers();
      
      // Sao chép các header hợp lệ từ client gửi lên ngoại trừ Host và CORS headers
      for (const [key, value] of request.headers.entries()) {
        const lowerKey = key.toLowerCase();
        if (
          lowerKey !== "host" && 
          lowerKey !== "cf-connecting-ip" && 
          lowerKey !== "x-target-url" &&
          !lowerKey.startsWith("cf-")
        ) {
          // Xử lý đặc biệt cho header Destination (trong yêu cầu MOVE/COPY)
          // Đường dẫn đích cũng cần được ánh xạ lại từ URL Proxy về Nextcloud thực tế
          if (lowerKey === "destination") {
            try {
              const destUrl = new URL(value);
              // Nếu Destination chỉ đến Proxy, hãy đổi host thành Nextcloud đích
              if (destUrl.host === new URL(request.url).host) {
                // Ta phân tích đường dẫn đích thực tế từ URL Destination
                // Ví dụ: Destination gửi qua proxy https://proxy.com/remote.php/dav... -> https://kai.nl.tab.digital/remote.php/dav...
                const actualDest = `${targetUrl.protocol}//${targetUrl.host}${destUrl.pathname}`;
                newHeaders.set("Destination", actualDest);
              } else {
                newHeaders.set("Destination", value);
              }
            } catch (e) {
              newHeaders.set("Destination", value);
            }
          } else {
            newHeaders.set(key, value);
          }
        }
      }

      // Xây dựng request để gửi tới Nextcloud
      const fetchOptions = {
        method: request.method,
        headers: newHeaders,
        redirect: "follow",
      };

      // Đọc body nếu phương thức không phải GET/HEAD/OPTIONS/DELETE rỗng
      if (request.method !== "GET" && request.method !== "HEAD" && request.method !== "OPTIONS") {
        const contentType = request.headers.get("content-type") || "";
        if (contentType.includes("application/json") || contentType.includes("xml") || contentType.includes("text")) {
          fetchOptions.body = await request.text();
        } else {
          fetchOptions.body = await request.arrayBuffer();
        }
      }

      // Gửi request thực tế tới Nextcloud
      const response = await fetch(targetUrl.href, fetchOptions);

      // Thu thập thông tin logs gỡ lỗi khi Nextcloud phản hồi mã lỗi >= 400
      if (!response.ok) {
        const errorText = await response.clone().text().catch(() => "");
        
        // Trả lỗi chi tiết để Client dễ dàng gỡ lỗi
        const errorHeaders = { ...corsHeaders, "Content-Type": "application/json" };
        return new Response(JSON.stringify({
          error: true,
          status: response.status,
          statusText: response.statusText,
          method: request.method,
          targetUrl: targetUrl.href,
          errorMessage: errorText || "Lỗi phản hồi từ Nextcloud không có nội dung.",
        }), {
          status: response.status === 401 ? 401 : 400, // Nhằm kích hoạt sự kiện sai thông tin đăng nhập trên client dễ nhận biết
          headers: errorHeaders,
        });
      }

      // Trả lại kết quả thành công cho Client cùng CORS Headers đầy đủ
      const responseHeaders = new Headers(response.headers);
      for (const [key, value] of Object.entries(corsHeaders)) {
        responseHeaders.set(key, value);
      }
      
      // Tránh lỗi bảo mật Cookie hoặc phân giải Host từ server Nextcloud
      responseHeaders.delete("Set-Cookie");

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });

    } catch (err) {
      // Ghi log lỗi kết nối hoặc lỗi dịch vụ mạng của Cloudflare
      const errorHeaders = { ...corsHeaders, "Content-Type": "application/json" };
      return new Response(JSON.stringify({
        error: true,
        status: 502,
        statusText: "Bad Gateway",
        method: request.method,
        targetUrl: targetUrlString,
        errorMessage: `Lỗi kết nối từ Cloudflare Worker: ${err.message}`,
      }), {
        status: 502,
        headers: errorHeaders,
      });
    }
  }
};
