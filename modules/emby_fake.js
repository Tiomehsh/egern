let h = $request.headers;

// 辅助函数：精准提取对应字段的值（自动兼容带引号和不带引号的情况）
function getValue(key, str) {
  let reg = new RegExp(key + '=(?:"([^"]+)"|([^,]+))', "i");
  let match = str.match(reg);
  return match ? (match[1] || match[2]) : "";
}

// 遍历所有 Header 键名，彻底解决大小写不统一的问题
for (let key in h) {
  let lowerKey = key.toLowerCase();

  // 1. 处理 UA 伪装
  if (lowerKey === "user-agent") {
    h[key] = "SenPlayer/6.0.0";
  }

  // 2. 彻底重构 Emby 认证信息
  if (lowerKey === "x-emby-authorization") {
    let authStr = h[key];

    // 提取真实动态数据
    let token = getValue("Token", authStr);
    let deviceId = getValue("DeviceId", authStr);
    // 兼容不同客户端对 UserId 的命名
    let userId = getValue("Emby UserId", authStr) || getValue("UserId", authStr);

    // 防御性补全：如果 auth 字符串里没带 Token，就从同级的 x-emby-token 抓取
    if (!token && h["x-emby-token"]) {
      token = h["x-emby-token"];
    }

    // 按照 SenPlayer 的标准格式重新拼接
    let newAuth = `MediaBrowser Token="${token}"`;
    if (userId) {
      newAuth += `, UserId="${userId}"`;
    }
    // 强制拼接 SenPlayer 特征
    newAuth += `, Client="SenPlayer", Device="iPhone", DeviceId="${deviceId}", Version="6.0.0"`;

    h[key] = newAuth;
  }
}

$done({ headers: h });
