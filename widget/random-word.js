// 红宝书随机单词 Egern 小组件
// 数据源: 2026考研英语词汇红宝书
// 使用有道词典 API 获取标准词典释义

const WORD_LIST_URL =
    "https://cdn.jsdelivr.net/gh/busiyiworld/maimemo-export@main/exported/list/2026%E8%80%83%E7%A0%94%E8%8B%B1%E8%AF%AD%E8%AF%8D%E6%B1%87%E7%BA%A2%E5%AE%9D%E4%B9%A6.txt";
const DICT_API = "https://dict.youdao.com/suggest?num=1&ver=3.0&doctype=json&cache=false&le=en&q=";
const STORAGE_KEY_WORDS = "redbook_words";
const STORAGE_KEY_INDEX = "redbook_index";
const STORAGE_KEY_TRANS = "redbook_trans"; // 翻译缓存
const REFRESH_MINUTES = 30;

export default async function (ctx) {
    // ── 1. 获取单词列表（优先读缓存） ──
    let words = ctx.storage.getJSON(STORAGE_KEY_WORDS);

    // 校验缓存有效性
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
            if (words.length < 100) {
                return errorWidget("获取词表异常(" + words.length + ")");
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

    // ── 3. 获取中文释义（优先读缓存） ──
    let transCache = ctx.storage.getJSON(STORAGE_KEY_TRANS) || {};
    let meaning = transCache[currentWord];

    if (!meaning) {
        try {
            const resp = await ctx.http.get(DICT_API + encodeURIComponent(currentWord), {
                credentials: "omit",
            });
            const data = await resp.json();
            if (data && data.data && data.data.entries && data.data.entries.length > 0) {
                meaning = data.data.entries[0].explain || "";
                // 缓存释义（限制大小，最多存 500 个）
                if (Object.keys(transCache).length > 500) {
                    const keys = Object.keys(transCache);
                    for (let i = 0; i < 100; i++) {
                        delete transCache[keys[i]];
                    }
                }
                transCache[currentWord] = meaning;
                ctx.storage.setJSON(STORAGE_KEY_TRANS, transCache);
            }
        } catch (e) {
            // 查词失败不影响展示
        }
    }

    if (!meaning) meaning = "";

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
                    text: currentWord,
                    font: { size: "headline", weight: "bold" },
                    maxLines: 1,
                    minScale: 0.6,
                },
                {
                    type: "text",
                    text: meaning,
                    font: { size: "caption2" },
                    maxLines: 1,
                    minScale: 0.5,
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
                    text: currentWord + (meaning ? " · " + meaning : ""),
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
            gap: 4,
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
                        { type: "spacer" },
                        {
                            type: "date",
                            date: new Date().toISOString(),
                            format: "time",
                            font: { size: "caption2" },
                            textColor: "#FFFFFF55",
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
                // 释义
                {
                    type: "text",
                    text: meaning,
                    font: { size: "footnote" },
                    textColor: "#FFFFFFBB",
                    maxLines: 3,
                    minScale: 0.5,
                },
                { type: "spacer" },
            ],
        };
    }

    // ── systemMedium / systemLarge / systemExtraLarge ──
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
                gap: 6,
                children: [
                    {
                        type: "image",
                        src: "sf-symbol:book.fill",
                        color: "#E8D44D",
                        width: 16,
                        height: 16,
                    },
                    {
                        type: "text",
                        text: "考研英语 · 红宝书",
                        font: { size: "caption1", weight: "semibold" },
                        textColor: "#E8D44D",
                    },
                    { type: "spacer" },
                    {
                        type: "date",
                        date: new Date().toISOString(),
                        format: "time",
                        font: { size: "caption2" },
                        textColor: "#FFFFFF55",
                    },
                ],
            },
            // 单词与释义（同行连续显示，清除自带换行符）
            {
                type: "text",
                text: currentWord + (meaning ? "  " + meaning.replace(/\n/g, " ") : ""),
                font: { size: "headline", weight: "bold" },
                textColor: "#FFFFFF",
                flex: 1,
                maxLines: 6,
                minScale: 0.5,
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
