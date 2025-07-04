import GambleAnalyzer from './analyzer.js';
import GambleParser from './parser.js';

class Status {
    constructor() {
        this.mcid = null;
        this.server = null;
        this.location = "login";
    }

    update(time, line) {
        // --- 状態を更新 ---
        const userMatch = line.match(/^Setting user: (.+)/); // mcid
        if (userMatch)
            this.mcid = userMatch[1];

        const serverMatch = line.match(/^Connecting to (.+)/); // server
        if (serverMatch)
            this.server = serverMatch[1];

        const tpMatch = line.match(
            /^\[System\] \[CHAT\] \[Warps\] (?:You were teleported to|テレポートされました) '([^']+)'/); // man10location
        if (tpMatch)
            this.location = tpMatch[1];

        if (this.mcid) {
            // man10location
            // (ログインサーバーもしくはサーバー移動~ワープログ表示)
            const joined = new RegExp(
                `^\\[System\\] \\[CHAT\\] ${this.mcid}(（旧名.*?）)?がゲームに参加しました`);
            if (joined.test(line))
                this.location = "login";
        }
    }
}

function extractDateFromFileName(fileName) {
    const match = fileName.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match)
        return match[1];
    if (fileName === "latest.log") {
        return new Date().toISOString().slice(0, 10);
    }
    return null;
}

async function processFiles(files, startDateStr, endDateStr, barInfo, slotInfo) {
    const start = new Date(startDateStr);
    const end = new Date(endDateStr);
    const decoder = new TextDecoder("shift-jis");
    const status = new Status();
    const parser = new GambleParser(barInfo, slotInfo);

    for (const file of files) {
        try {
            // --- テキスト読み込み ---
            const name = file.name;
            const dateStr = extractDateFromFileName(name);
            if (!dateStr)
                continue;

            // --- 日付フィルター ---
            const fileDate = new Date(dateStr);
            if (fileDate < start || fileDate > end)
                continue;

            console.log(name);

            // --- ログ読み込み ---
            let text = "";
            if (name.endsWith(".log")) {
                const buffer = await file.arrayBuffer();
                text = decoder.decode(buffer);
            } else if (name.endsWith(".gz")) {
                const buffer = await file.arrayBuffer();
                const decompressed = pako.inflate(new Uint8Array(buffer));
                text = decoder.decode(decompressed);
            }

            const lines = text.split(/\r?\n/);

            for (const line of lines) {
                const match = line.match(/^\[(.*?)\] \[(.*?)\]: (.*)/);
                if (!match)
                    continue;

                const [_, time, logType, content] = match;
                status.update(time, content);

                if (status.mcid && status.server === "dan5.red, 25565") {
                    if (status.location.includes('casino') || status.location.includes('devil')) {
                        const chatMatch = content.match(/\[System\] \[CHAT\] (.+)/);
                        if (!chatMatch)
                            continue;

                        const datetime = `${dateStr}T${time}`;
                        const chat = chatMatch[1];
                        parser.parse(datetime, chat);
                    }
                }
            }
        } catch (e) {
            console.warn(`ファイル読み込み失敗: ${file.name}`, e);
            continue;
        }
    }

    const idByType = parser.setSlotNameAndClassifyLogId();

    const analyzer = new GambleAnalyzer(barInfo, slotInfo, parser.logs);
    const stats = analyzer.analyze(idByType);
    return [
        parser.logs,
        stats,
        idByType,
        analyzer.idByBarName,
        analyzer.idBySlotName
    ];
}

async function loadBarInfo(path) {
    const response = await fetch(path);
    const text = await response.text();

    const lines = text.split(/\r?\n/);
    const barInfoMap = {};
    let currentGenre = null;

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith(";"))
            continue;

        const sectionMatch = line.match(/^\[([^\]]+)\]$/);
        if (sectionMatch) {
            currentGenre = sectionMatch[1];
            continue;
        }

        const kvMatch = line.match(/^(.+?)\s*=\s*(\d+)$/);
        if (kvMatch && currentGenre !== null) {
            const name = kvMatch[1].trim();
            const gainPrice = parseInt(kvMatch[2], 10);
            barInfoMap[name] = {genre : currentGenre, gainPrice};
        }
    }

    return barInfoMap;
}

async function loadSlotInfo(path) {
    const response = await fetch(path);
    const text = await response.text();

    const lines = text.split(/\r?\n/);
    const slotInfoMap = {};
    let currentPrice = null;

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith(";"))
            continue;

        const sectionMatch = line.match(/^\[(\d+)\]$/);
        if (sectionMatch) {
            currentPrice = parseInt(sectionMatch[1], 10);
            continue;
        }

        const kvMatch = line.match(/^(.+?)\s*=\s*(.*)$/);
        if (kvMatch && currentPrice !== null) {
            const name = kvMatch[1].trim();
            const roles = kvMatch[2]
                              ? kvMatch[2].split(";").map(r => r.trim()).filter(Boolean)
                              : [];

            slotInfoMap[name] = {price : currentPrice, roles};
        }
    }

    return slotInfoMap;
}

// --- ファイル選択イベント ---
document.getElementById("folderInput").addEventListener("change", async (e) => {
    const files = Array.from(e.target.files);
    const logFiles =
        files.filter(f => f.name.endsWith(".log") || f.name.endsWith(".gz"));

    const startDate = document.getElementById("startDate").value;
    const endDate = document.getElementById("endDate").value;

    if (!startDate || !endDate) {
        alert("開始日と終了日を指定してください。");
        return;
    }

    const [barInfo, slotInfo] = await Promise.all([
        loadBarInfo("./barInfo.ini"),
        loadSlotInfo("./slotInfo.ini")
    ]);

    const [resultLogs, stats, idByType, idByBarName, idBySlotName] = await processFiles(logFiles, startDate, endDate, barInfo, slotInfo);
    renderStatsTable(stats);
}); // ←エラー行はここ？await processFilesは実行されている

// --- 日付選択 ---
window.addEventListener("DOMContentLoaded", () => {
    const start = document.getElementById("startDate");
    const end = document.getElementById("endDate");

    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    const todayStr = `${yyyy}-${mm}-${dd}`;

    // 初期値
    start.value = "2020-01-01"
    end.value = todayStr;
});

// タブ切り替え処理
document.querySelectorAll(".tab-button").forEach(button => {
    button.addEventListener("click", () => {
        const tabId = button.getAttribute("data-tab");

        // ボタンの active 切替
        document.querySelectorAll(".tab-button").forEach(btn =>
            btn.classList.toggle("active", btn === button)
        );

        // コンテンツ表示切替
        document.querySelectorAll(".tab-content").forEach(tab =>
            tab.classList.toggle("hidden", tab.id !== tabId)
        );
    });
});

function renderStatsTable(stats) {
    updateBarStats(stats.barStats);
    updateSlotStats(stats.slotStats);
    updateChangerStats(stats.changerStats);
    updatePtoPStats(stats.ptopStats)
}

function formatYen(value) {
    return '￥' + value.toLocaleString('ja-JP');
}

function updateBarStats(stats) {
    const genreOrder = [
        "Beginner", 
        "Gambler", 
        "VIP", 
        "Dan5", 
        "Secret",
        "BarSlot"
    ];
    
    const tbody = document.getElementById("stats-bar-body");
    tbody.innerHTML = '';
    addRow(tbody, '全体', stats.total, 0);

    for (const genre of genreOrder) {
        const g = stats.genres[genre];
        if(!g) continue;

        addRow(tbody, genre, g, 1);
        // 酒の収支順にソート
        const sortedBars = Object.entries(g.bars)
            .sort(([, a], [, b]) => b.total - a.total);

        for (const [barName, bar] of sortedBars) {
            addRow(tbody, barName, bar, 2, bar.probability);
        }
    }
}

function updateSlotStats(stats) {
    const tbody = document.getElementById("stats-slot-body");

    tbody.innerHTML = '';
    addRow(tbody, '全体', stats.total, 0);

    for (const price of Object.keys(stats.prices)) {
        const p = stats.prices[price];
        if(!p) continue;

        addRow(tbody, price + "円スロット", p, 1);

        // スロットの収支順にソート
        const sortedSlots = Object.entries(p.slots)
            .filter(([name]) => name !== "不明")
            .sort(([, a], [, b]) => (b.total ?? -Infinity) - (a.total ?? -Infinity));

        for (const [slotName, slot] of sortedSlots) {
            addRow(tbody, slotName, slot, 2);
        }
        // 不明なスロット
        if (p.slots["不明"]) 
            addRow(tbody, "不明", p.slots["不明"], 2); 
    }
}

function updateChangerStats(stats) {
    const tbody = document.getElementById("stats-changer-body");

    tbody.innerHTML = '';
    addRow(tbody, '全体', stats.total, 0);

    for (const price of Object.keys(stats.prices)) {
        const p = stats.prices[price];
        if(!p) continue;

        addRow(tbody, p.rawText, p, 1);
    }
}

function updatePtoPStats(stats) { 
    const tbody = document.getElementById("stats-ptop-body");

    tbody.innerHTML = '';
    addRow(tbody, '全体', stats.total, 0);
}

function addRow(tbody, label, colData, level, probability = null) {
    const { payAmount, gainAmount, total, pay, gain } = colData;

    const buyCount = (payAmount !== undefined && pay) ? Math.round(payAmount / pay) : null;
    const winCount = (gainAmount !== undefined && gain) ? Math.round(gainAmount / gain) : null;

    const tr = document.createElement('tr');
    tr.classList.add(`indent-${level}`);

    const tdName = document.createElement('td');
    tdName.textContent = label;

    const tdPay = document.createElement('td');
    tdPay.className = 'negative';
    tdPay.textContent = (payAmount !== undefined) ? formatYen(payAmount) : "-";

    const tdBuyCount = document.createElement('td');
    tdBuyCount.className = 'muted';  
    tdBuyCount.textContent = (buyCount !== null) ? `(${buyCount}本)` : "";

    const tdGain = document.createElement('td');
    tdGain.className = 'positive';
    tdGain.textContent = (gainAmount !== undefined) ? formatYen(gainAmount) : "-";

    const tdWinCount = document.createElement('td');
    tdWinCount.className = 'muted';  // ← 目立たないスタイル
    tdWinCount.textContent = (winCount !== null) ? `(${winCount}回)` : "";

    const tdTotal = document.createElement('td');
    if (total !== undefined) {
        tdTotal.textContent = formatYen(Math.abs(total));
        tdTotal.className = total >= 0 ? 'positive' : 'negative';
    } else {
        tdTotal.textContent = "-";
    }

    tr.append(
        tdName,
        tdPay, tdBuyCount,
        tdGain, tdWinCount,
        tdTotal
    );

    if (probability !== null) {
        const tdProbability = document.createElement('td');

        const percentage = (probability * 100).toFixed(3) + "%";

        let oneIn = "";
        if (probability === 0) {
            tdProbability.textContent = "データなし";
            tdProbability.classList.add("muted");
        } else if (probability < 0.1) {
            const inverse = 1 / probability;

            // 値が割り切れるかチェックして整数か判断
            if (Number.isInteger(inverse)) {
                oneIn = ` (1/${inverse})`;
            } else if (inverse < 10000) {
                // 小数1桁で表示（例: 1/7.5）
                oneIn = ` (1/${inverse.toFixed(1)})`;
            } else {
                // 極端な値は科学的記法で
                oneIn = ` (1/${inverse.toExponential(1)})`;
            }
        }

        tdProbability.textContent = percentage + oneIn;
        tr.append(tdProbability);
    }

    tbody.appendChild(tr);
}
