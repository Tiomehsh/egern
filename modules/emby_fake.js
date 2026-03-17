let h = $request.headers;

// 统一 UA
h["User-Agent"] = "SenPlayer/6.0.0";

// 处理大小写两种 EmbyAuth
const keys = ["X-Emby-Authorization", "x-emby-authorization"];

for (let k of keys) {
  if (h[k]) {
    h[k] = h[k]
      .replace(/Client="Forward"/, 'Client="SenPlayer"')
      .replace(/Version="[^"]+"/, 'Version="6.0.0"');
  }
}

$done({ headers: h });
