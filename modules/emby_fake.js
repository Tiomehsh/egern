let h = $request.headers;

// 遍历所有 Header 键名，彻底解决大小写不统一的问题
for (let key in h) {
  let lowerKey = key.toLowerCase();

  // 1. 处理 UA 伪装
  if (lowerKey === "user-agent") {
    h[key] = "SenPlayer/6.0.0";
  }

  // 2. 处理 Emby 认证信息伪装
  if (lowerKey === "x-emby-authorization") {
    // 使用正则模糊匹配当前的 Client 和 Version，无论原来是什么，都改成 SenPlayer 和 6.0.0
    h[key] = h[key]
      .replace(/Client="[^"]+"/, 'Client="SenPlayer"')
      .replace(/Version="[^"]+"/, 'Version="6.0.0"');
  }
}

$done({ headers: h });
