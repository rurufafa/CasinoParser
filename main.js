import GambleAnalyzer from './analyzer.js';
import GambleParser from './parser.js';

class Status {
    constructor() {
        this.mcids = new Set();
        this.server = null;
        this.location = "login";
    }

    update(line) {
        // --- 状態を更新 ---
        const userMatch = line.match(/^Setting user: (.+)/); // mcids
        if (userMatch) 
            this.mcids.add(userMatch[1]);

        const serverMatch = line.match(/^Connecting to (.+)/); // server
        if (serverMatch) 
            this.server = serverMatch[1];

        const tpMatch = line.match(
            /^\[System\] \[CHAT\] \[Warps\] (?:You were teleported to|テレポートされました) '([^']+)'/); // man10location
        if (tpMatch) 
            this.location = tpMatch[1];

        if (this.mcids.size > 0) {
            // man10location
            // (ログインサーバーもしくはサーバー移動~ワープログ表示)
            for (const mcid of this.mcids) {
                const joined = new RegExp(
                    `^\\[System\\] \\[CHAT\\] ${mcid}(（旧名.*?）)?がゲームに参加しました`);
                if (joined.test(line)) {
                    this.location = "login";
                    break;
                }
            }
        }
        return false;
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

    const currentFileElem = document.getElementById("current-file");
    const currentMcidElem = document.getElementById("current-mcid");
    const lineCountElem = document.getElementById("line-count");
    const casinoCountElem = document.getElementById("casino-count");

    let totalLines = 0;

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

            currentFileElem.textContent = name;

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
                totalLines++;
                const match = line.match(/^\[(.*?)\] \[(.*?)\]: (.*)/);
                if (!match)
                    continue;

                const [_, time, logType, content] = match;

                // MCIDが変更されたら更新
                status.update(content);

                if (status.mcids.size > 0 && status.server === "dan5.red, 25565") {
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

            currentMcidElem.textContent = Array.from(status.mcids).join(", ");
            lineCountElem.textContent = totalLines;
            casinoCountElem.textContent = parser.it + 1;
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
    const response = await fetch(path, { cache: "no-cache" });
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
    const response = await fetch(path, { cache: "no-cache" });
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

    // 日付順にソート
    const logFiles = files
    .filter(f => f.name.endsWith(".log") || f.name.endsWith(".gz"))
    .sort((a, b) => {
        const parseLogName = (name) => {
            if (name === "latest.log") return { date: "9999-12-31", index: 9999 }; 
            const match = name.match(/^(\d{4}-\d{2}-\d{2})-(\d+)\.log(?:\.gz)?$/);
            if (!match) return { date: "0000-00-00", index: 0 }; 
            return { date: match[1], index: parseInt(match[2], 10) };
        };

        const aInfo = parseLogName(a.name);
        const bInfo = parseLogName(b.name);

        if (aInfo.date !== bInfo.date) {
            return aInfo.date < bInfo.date ? -1 : 1;
        } else {
            return aInfo.index - bInfo.index;
        }
    });

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
});

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
    start.value = "2020-01-01";
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
    updateBarStats("Bar", stats.barStats);
    updateSlotStats("Slot", stats.slotStats);
    updateChangerStats("Changer", stats.changerStats);
    updatePtoPStats("PtoP", stats.ptopStats);
}

function formatYen(value) {
    return value.toLocaleString('ja-JP');
}

function formatDuration(ms) {
    const oneHourMs = 60 * 60 * 1000;
    if (ms < oneHourMs) {
        const minutes = Math.round(ms / (60 * 1000));
        return `${minutes}分`;
    } else {
        const hours = ms / oneHourMs;
        return `${hours.toFixed(1)}時間`;
    }
}

function updateBarStats(type, stats) {
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
    addRow(type, tbody, { name : '全体', balance : stats.total }, 0);

    for (const genre of genreOrder) {
        const g = stats.genres[genre];
        if(!g) continue;

        addRow(type, tbody, { name : genre, balance : g }, 1);
        // 酒の収支順にソート
        const sortedBars = Object.entries(g.bars)
            .sort(([, a], [, b]) => b.total - a.total);

        for (const [barName, bar] of sortedBars) {
            const colData = {
                genre,
                name : barName,
                balance : bar,
                stats 
            };
            addRow(type, tbody, colData, 2);
        }
    }
}

function updateSlotStats(type, stats) {
    const tbody = document.getElementById("stats-slot-body");

    tbody.innerHTML = '';
    addRow(type, tbody, { name : '全体', balance : stats.total }, 0);

    for (const price of Object.keys(stats.prices)) {
        const p = stats.prices[price];
        if(!p) continue;

        addRow(type, tbody, { name : price + "円スロット", balance : p }, 1);

        // スロットの収支順にソート
        const sortedSlots = Object.entries(p.slots)
            .filter(([name]) => name !== "不明")
            .sort(([, a], [, b]) => (b.total ?? -Infinity) - (a.total ?? -Infinity));

        for (const [slotName, slot] of sortedSlots) {
            const colData = {
                genre : price,
                name : slotName,
                balance : slot,
                stats 
            };
            addRow(type, tbody, colData, 2);
        }
        // 不明なスロット
        if (p.slots["不明"]) {
            const colData = {
                genre : price,
                name : "不明",
                balance : p.slots["不明"],
                stats 
            };
            addRow(type, tbody, colData, 2); 
        }
    }
}

function updateChangerStats(type, stats) {
    const tbody = document.getElementById("stats-changer-body");

    tbody.innerHTML = '';
    addRow(type, tbody, { name : '全体', balance : stats.total }, 0);

    for (const price of Object.keys(stats.prices)) {
        const p = stats.prices[price];
        if(!p) continue;

        const colData = {
            name : p.rawText,
            balance : p 
        };

        addRow(type, tbody, colData, 1);
    }
}

function updatePtoPStats(type, stats) { 
    const tbody = document.getElementById("stats-ptop-body");

    tbody.innerHTML = '';
    addRow(type, tbody, { name : '全体', balance : stats.total }, 0);
}

function addRow(type, tbody, colData, level) {
    const { genre, name, balance, stats } = colData;
    const { pay, payAmount, gain, gainAmount, total, probability, duration } = balance;

    const buyCount = (payAmount !== undefined && pay) ? Math.round(payAmount / pay) : null;
    const winCount = (gainAmount !== undefined && gain) ? Math.round(gainAmount / gain) : null;

    const tr = document.createElement('tr');
    tr.classList.add(`indent-${level}`);

    const tdName = document.createElement('td');
    tdName.textContent = name;
    tdName.title = name; 

    const tdPay = document.createElement('td');
    tdPay.className = 'negative';
    tdPay.textContent = (payAmount !== undefined) ? formatYen(payAmount) : "-";

    const tdBuyCount = document.createElement('td');
    tdBuyCount.className = 'muted';  
    tdBuyCount.textContent = buyCount !== null ? `(${buyCount}本)` : "";
    

    const tdGain = document.createElement('td');
    tdGain.className = 'positive';
    tdGain.textContent = (gainAmount !== undefined) ? formatYen(gainAmount) : "-";

    const tdWinCount = document.createElement('td');
    tdWinCount.className = 'muted'; 
    tdWinCount.textContent = winCount !== null ? `(${winCount}回)` : "";

    const tdTotal = document.createElement('td');
    if (total !== undefined) {
        tdTotal.textContent = formatYen(Math.abs(total));
        tdTotal.className = total >= 0 ? 'positive' : 'negative';
    } else {
        tdTotal.textContent = "-";
    }

    
    const tdProbability = document.createElement('td');
    if (probability !== undefined) {
        
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
                // 小数1桁で表示
                oneIn = ` (1/${inverse.toFixed(1)})`;
            } else {
                // 極端な値
                oneIn = ` (1/${inverse.toExponential(1)})`;
            }
            tdProbability.textContent = percentage + oneIn;
        } else {
            tdProbability.textContent = percentage;
        }
    }

    const tdDuration = document.createElement('td');
    if (duration !== undefined) {
        tdDuration.textContent = formatDuration(duration);
    }

    tr.append(
        tdName,
        tdPay, tdBuyCount,
        tdGain, tdWinCount,
        tdTotal,
        tdProbability,
        tdDuration
    );

    const tdDetail = document.createElement('td');
    const button = document.createElement('button');
    button.textContent = '詳細';
    button.className = 'detail-button';
    if (type === "Bar" && level === 2) {
        button.addEventListener('click', () => {
            showBarStatsDetail(genre, name, stats);
        });
    } else if (type === "Slot" && level === 2) {
        button.addEventListener('click', () => {
            showSlotStatsDetail(genre, name, stats);
        });
    } else {
        button.textContent = '';
    }
    
    tdDetail.appendChild(button);
    tr.appendChild(tdDetail);
    tbody.appendChild(tr);
}

function showBarStatsDetail(genre, name, stats) {
    const modal = document.getElementById("detail-modal");
    const title = document.getElementById("detail-modal-title");
    const content = document.getElementById("detail-modal-content");

    title.textContent = `【${name}】の詳細情報`;
    content.innerHTML = '';

    // コンテナ作成（スクロール可能）
    const container = document.createElement("div");
    container.style.maxHeight = "300px";
    container.style.overflowY = "auto";
    container.style.paddingRight = "10px";

    const noStreaksGenre = ["Dan5", "Secret", "BarSlot"];
    if (!noStreaksGenre.includes(genre)) {
        // --- 連勝記録ランキング ---
        const winStreaksData = stats.winStreaks[name];
        const winList = (winStreaksData && Array.isArray(winStreaksData)) ? [...winStreaksData] : [];
        if (winList.length > 0 && winList.some(e => e.count >= 2)) {
            const section = document.createElement("section");
            const h = document.createElement("h4");
            h.textContent = "連勝記録ランキング";
            section.appendChild(h);

            winList
                .filter(e => e.count >= 2)
                .sort((a, b) => b.count - a.count)
                .forEach(e => {
                    const p = document.createElement("p");
                    p.textContent = `連勝数 ${e.count} (ID: ${e.startId} ~ ${e.endId})`;
                    section.appendChild(p);
                });

            container.appendChild(section);
        }

        // --- 連敗記録（時系列順） ---
        const loseStreaksData = stats.loseStreaks[name];
        const loseList = (loseStreaksData && Array.isArray(loseStreaksData)) ? [...loseStreaksData] : [];
        if (loseList.length > 0) {
            const section = document.createElement("section");
            const h = document.createElement("h4");
            h.textContent = "当選するまでに購入した本数";
            section.appendChild(h);

            loseList
                .sort((a, b) => a.startId - b.startId)
                .forEach(e => {
                    const p = document.createElement("p");
                    p.textContent = `${e.count} (ID: ${e.startId} ~ ${e.endId})`;
                    section.appendChild(p);
                });

            container.appendChild(section);
        }
    }

    // --- 団子酒の履歴 ---
    if (genre === "Dan5" && stats.dangoInfo) {
        const section = document.createElement("section");
        const h = document.createElement("h4");
        h.textContent = `【${name}】の詳細情報`;
        section.appendChild(h);

        const { gain, message } = stats.dangoInfo;

        const sellInfo = document.createElement("p");
        sellInfo.innerHTML = `
            <strong>・売却数</strong><br>
            青 (10万) : ${gain[10] || 0}<br>
            緑 (20万) : ${gain[20] || 0}<br>
            赤 (40万) : ${gain[40] || 0}<br>
            金 (80万) : ${gain[80] || 0}
        `;
        section.appendChild(sellInfo);

        const winInfo = document.createElement("p");
        winInfo.innerHTML = `
            <strong>・当選数</strong><br>
            白=>青 : ${message[10] || 0}<br>
            青=>緑 : ${message[20] || 0}<br>
            緑=>赤 : ${message[40] || 0}<br>
            赤=>金 : ${message[80] || 0}<br>
            金当選 : ${gain[160] || 0}
        `;
        section.appendChild(winInfo);

        container.appendChild(section);
    }

    if (genre === "BarSlot") {
        const section = document.createElement("section");
        const h = document.createElement("h4");
        h.textContent = `【${name}】の詳細情報`;
        section.appendChild(h);

        const sellInfo = document.createElement("p");
        sellInfo.innerHTML = `
            <strong>・売却数</strong><br>
            5万 : ${stats.barSlotInfo[name][5] || 0}<br>
            10万 : ${stats.barSlotInfo[name][10] || 0}
        `;
        section.appendChild(sellInfo);

        container.appendChild(section);
    }

    content.appendChild(container);
    modal.showModal();
}

function showSlotStatsDetail(genre, name, stats) {
    const modal = document.getElementById("detail-modal");
    const title = document.getElementById("detail-modal-title");
    const content = document.getElementById("detail-modal-content");

    title.textContent = `【${name}】の役出現回数`;
    content.innerHTML = '';

    const container = document.createElement("div");
    container.style.maxHeight = "300px";
    container.style.overflowY = "auto";

    const p = stats.prices[genre];
    const s = p.slots[name];
    if (s.roleCounts && Object.keys(s.roleCounts).length > 0) {
        const table = document.createElement("table");
        table.style.width = "100%";
        table.style.borderCollapse = "collapse";

        const thead = document.createElement("thead");
        const headRow = document.createElement("tr");
        headRow.innerHTML = `
            <th style="text-align: left;">役名</th>
            <th style="text-align: right;">出現回数</th>
        `;
        thead.appendChild(headRow);
        table.appendChild(thead);

        const tbody = document.createElement("tbody");

        Object.entries(s.roleCounts)
            .sort(([, a], [, b]) => b - a)
            .forEach(([role, count]) => {
                const row = document.createElement("tr");
                row.innerHTML = `
                    <td>${role}</td>
                    <td style="text-align: right;">${count}</td>
                `;
                tbody.appendChild(row);
            });

        table.appendChild(tbody);
        container.appendChild(table);
    } else {
        const p = document.createElement("p");
        p.textContent = "役情報がありません。";
        container.appendChild(p);
    }

    content.appendChild(container);
    modal.showModal();
}
