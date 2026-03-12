// 红宝书随机单词 Egern 小组件
// 数据源: 2026考研英语词汇红宝书

const WORD_LIST_URL =
    "https://cdn.jsdelivr.net/gh/busiyiworld/maimemo-export@main/exported/list/2026%E8%80%83%E7%A0%94%E8%8B%B1%E8%AF%AD%E8%AF%8D%E6%B1%87%E7%BA%A2%E5%AE%9D%E4%B9%A6.txt";
const STORAGE_KEY_WORDS = "redbook_words";
const STORAGE_KEY_INDEX = "redbook_index";
const REFRESH_MINUTES = 30;

export default async function (ctx) {
    // ── 1. 获取单词列表（优先读缓存） ──
    let words = ctx.storage.getJSON(STORAGE_KEY_WORDS);

    // 校验缓存有效性（排除之前误缓存的非单词内容）
    if (words && (words.length < 100 || !/^[a-zA-Z]/.test(words[0]))) {
        ctx.storage.delete(STORAGE_KEY_WORDS);
        words = null;
    }

    if (!words || words.length === 0) {
        try {
            const resp = await ctx.http.get(WORD_LIST_URL, {
                credentials: "omit",
            });
            const text = await resp.text();
            words = text
                .split("\n")
                .map((line) => line.trim())
                .filter((line) => line.length > 0 && !line.startsWith("#") && /^[a-zA-Z]/.test(line));
            // 安全检查：单词数过少说明拉取的不是正常词表
            if (words.length < 100) {
                return errorWidget("获取词表异常(" + words.length + ")，请重试");
            }
            ctx.storage.setJSON(STORAGE_KEY_WORDS, words);
        } catch (e) {
            return errorWidget("加载词表失败");
        }
    }

    if (!words || words.length === 0) {
        return errorWidget("词表为空");
    }

    // ── 2. 读取 / 更新索引 ──
    let index = ctx.storage.getJSON(STORAGE_KEY_INDEX);
    if (index === null || index === undefined || index >= words.length) {
        index = Math.floor(Math.random() * words.length);
    }
    const currentWord = words[index];
    const nextIndex = (index + 1) % words.length;
    ctx.storage.setJSON(STORAGE_KEY_INDEX, nextIndex);


    // ── 4. 根据小组件尺寸构建 DSL ──
    const family = ctx.widgetFamily;

    // 锁屏 — accessoryRectangular
    if (family === "accessoryRectangular") {
        return {
            type: "widget",
            refreshAfter: REFRESH_MINUTES + "min",
            children: [
                {
                    type: "text",
                    text: "📖 红宝书",
                    font: { size: "caption2" },
                },
                {
                    type: "text",
                    text: currentWord,
                    font: { size: "headline", weight: "bold" },
                    maxLines: 1,
                    minScale: 0.6,
                },
            ],
        };
    }

    // 锁屏 — accessoryInline
    if (family === "accessoryInline") {
        return {
            type: "widget",
            refreshAfter: REFRESH_MINUTES + "min",
            children: [
                {
                    type: "text",
                    text: "📖 " + currentWord,
                    font: { size: "headline" },
                },
            ],
        };
    }

    // 锁屏 — accessoryCircular
    if (family === "accessoryCircular") {
        return {
            type: "widget",
            refreshAfter: REFRESH_MINUTES + "min",
            children: [
                {
                    type: "text",
                    text: currentWord,
                    font: { size: "caption2", weight: "bold" },
                    textAlign: "center",
                    maxLines: 2,
                    minScale: 0.5,
                },
            ],
        };
    }

    // ── systemSmall — 小尺寸 ──
    // systemSmall 仅支持单一点击区域，将整个内容包在一个带 url 的 stack 中
    if (family === "systemSmall") {
        return {
            type: "widget",
            refreshAfter: REFRESH_MINUTES + "min",
            backgroundGradient: {
                type: "linear",
                colors: ["#1B1B3A", "#162447", "#1F4068"],
                stops: [0, 0.5, 1.0],
                startPoint: { x: 0, y: 0 },
                endPoint: { x: 1, y: 1 },
            },
            padding: 16,
            gap: 6,
            children: [
                // 标题行
                {
                    type: "stack",
                    direction: "row",
                    alignItems: "center",
                    gap: 6,
                    children: [
                        {
                            type: "image",
                            src: "sf-symbol:book.fill",
                            color: "#E8D44D",
                            width: 14,
                            height: 14,
                        },
                        {
                            type: "text",
                            text: "红宝书",
                            font: { size: "caption1", weight: "semibold" },
                            textColor: "#E8D44D",
                        },
                    ],
                },
                { type: "spacer" },
                // 单词
                {
                    type: "text",
                    text: currentWord,
                    font: { size: "title", weight: "bold" },
                    textColor: "#FFFFFF",
                    maxLines: 1,
                    minScale: 0.5,
                },
                { type: "spacer" },
                // 底部进度
                {
                    type: "text",
                    text: (index + 1) + " / " + words.length,
                    font: { size: "caption2" },
                    textColor: "#FFFFFF55",
                },
            ],
        };
    }

    // ── systemMedium / systemLarge / systemExtraLarge — 中/大尺寸 ──
    return {
        type: "widget",
        refreshAfter: REFRESH_MINUTES + "min",
        backgroundGradient: {
            type: "linear",
            colors: ["#1B1B3A", "#162447", "#1F4068"],
            stops: [0, 0.5, 1.0],
            startPoint: { x: 0, y: 0 },
            endPoint: { x: 1, y: 1 },
        },
        padding: 16,
        gap: 8,
        children: [
            // 标题行
            {
                type: "stack",
                direction: "row",
                alignItems: "center",
                gap: 8,
                children: [
                    {
                        type: "image",
                        src: "sf-symbol:book.fill",
                        color: "#E8D44D",
                        width: 18,
                        height: 18,
                    },
                    {
                        type: "text",
                        text: "考研英语 · 红宝书",
                        font: { size: "subheadline", weight: "semibold" },
                        textColor: "#E8D44D",
                    },
                    { type: "spacer" },
                    {
                        type: "text",
                        text: (index + 1) + " / " + words.length,
                        font: { size: "caption1" },
                        textColor: "#FFFFFF88",
                    },
                ],
            },
            { type: "spacer" },
            // 单词
            {
                type: "text",
                text: currentWord,
                font: { size: "largeTitle", weight: "bold" },
                textColor: "#FFFFFF",
                textAlign: "center",
                maxLines: 1,
                minScale: 0.5,
            },
            { type: "spacer" },
            // 底部进度
            {
                type: "text",
                text: (index + 1) + " / " + words.length,
                font: { size: "caption2" },
                textColor: "#FFFFFF55",
                textAlign: "center",
            },
        ],
    };
}

// ── 错误状态 ──
function errorWidget(msg) {
    return {
        type: "widget",
        backgroundColor: "#1B1B3A",
        padding: 16,
        children: [
            {
                type: "text",
                text: "⚠️ " + msg,
                font: { size: "body", weight: "medium" },
                textColor: "#FF3B30",
            },
        ],
    };
}
