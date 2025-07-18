import LogMatcher from './matcher.js';
import LogParser from './parser.js';
import LogAnalyzer from './analyzer.js';

function extractDateFromFileName(fileName) {
    const match = fileName.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match)
        return match[1];
    if (fileName === "latest.log") {
        return new Date().toISOString().slice(0, 10);
    }
    return null;
}

async function processFiles(files, startDateStr, endDateStr) {
    const start = new Date(startDateStr);
    const end = new Date(endDateStr);
    const decoder = new TextDecoder("shift-jis");
    const matcher = new LogMatcher();

    let it = 0;
    const logs = {};

    const currentFileElem = document.getElementById("current-file");
    const lineCountElem = document.getElementById("line-count");
    const casinoCountElem = document.getElementById("casino-count");

    let totalLines = 0;
    for (const file of files) {
        try {
            const name = file.name;
            const dateStr = extractDateFromFileName(name);
            if (!dateStr)
                continue;
            
            // 日付フィルター
            const fileDate = new Date(dateStr);
            if (fileDate < start || fileDate > end)
                continue;
            
            currentFileElem.textContent = name;
            
            // ログ読み込み
            let text = "";
            const buffer = await file.arrayBuffer();

            if (name.endsWith(".log")) {
                text = decoder.decode(new Uint8Array(buffer));
            } else if (name.endsWith(".gz")) {
                const decompressed = pako.inflate(new Uint8Array(buffer));
                text = decoder.decode(decompressed);
            } else {
                continue;
            }

            const lines = text.split(/\r?\n/);

            for (const line of lines) {
                totalLines++;
                const result = matcher.matchLog(dateStr, line);
                if (result) 
                    logs[it++] = result;
            }

            lineCountElem.textContent = totalLines;
            casinoCountElem.textContent = matcher.casinoCount;
        } catch (e) {
            console.warn(`ファイル読み込み失敗: ${file.name}`, e);
            continue;
        }
    }

    return logs;
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

// フォルダ選択イベント
document.getElementById("folderInput").addEventListener("change", async (e) => {
    const files = Array.from(e.target.files);

    // ファイルを日付順にソート
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

    // 酒、スロット情報ファイルを取得
    const [barInfo, slotInfo] = await Promise.all([
        loadBarInfo("./barInfo.ini"),
        loadSlotInfo("./slotInfo.ini")
    ]);

    const logs = await processFiles(logFiles, startDate, endDate);
    const parser = new LogParser(barInfo, slotInfo, logs);
    const [parsedLogs, sectionMap] = parser.parseLog();

    const analyzer = new LogAnalyzer(barInfo, slotInfo, parsedLogs, sectionMap);
    const result = analyzer.analyze();

    renderStatsTable(result);
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
    // start.value = "2025-05-01";
    start.value = "2020-01-01";
    end.value = todayStr;
    // const common = "2025-05-06";
    // start.value = common;
    // end.value = common;
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

function renderStatsTable(result) {
    window.analysisResult = result; 
    const { bar, slot, changer, ptop } = result.stats;

    // テーブル描画
    document.getElementById("bar-table-container").innerHTML = createBarTable(bar);
    document.getElementById("slot-table-container").innerHTML = createSlotTable(slot);
    document.getElementById("changer-table-container").innerHTML = createChangerTable(changer);
    document.getElementById("ptop-table-container").innerHTML = createPtoPTable(ptop);

    // --- コピーボタンを追加 ---
    const barContainer = document.getElementById("bar-table-container");

    const copyBtn = document.createElement("button");
    copyBtn.textContent = "酒の購入本数・当選回数をコピー";
    copyBtn.style.margin = "10px 0";
    copyBtn.onclick = () => {
        const text = createBarSummaryText(bar);
        navigator.clipboard.writeText(text)
            .then(() => alert("コピーしました！"))
            .catch(err => alert("コピーに失敗しました: " + err));
    };

    barContainer.prepend(copyBtn);
}

function formatDuration(ms) {
    if (typeof ms !== "number" || isNaN(ms)) return "";

    const minutes = ms / 60000;
    if (minutes < 60) return minutes.toFixed(1) + "分";
    return (minutes / 60).toFixed(1) + "時間";
}

function formatNumber(n) {
    if (typeof n !== "number") return n;
    return n.toLocaleString() + '円'; 
}

function createBarTable(stats) {
    const genreOrder = ["Beginner", "Gambler", "VIP", "Dan5", "Secret", "BarSlot"];
    const tbody = [];

    const { payAmount, gainAmount, total } = stats.total;
    tbody.push(`
        <tr class="depth-1">
            <td>全体</td>
            <td class="negative">${formatNumber(payAmount)}</td>
            <td></td>
            <td class="positive">${formatNumber(gainAmount)}</td>
            <td></td>
            <td class="${total > 0 ? 'positive' : total < 0 ? 'negative' : ''}">${formatNumber(total)}</td>
            <td></td>
            <td></td>
            <td></td>
        </tr>`);

    for (const genre of genreOrder) {
        const g = stats.genres[genre];
        if (!g) continue;

        tbody.push(`
            <tr class="depth-2">
                <td>${genre}</td>
                <td class="negative">${formatNumber(g.payAmount)}</td>
                <td></td>
                <td class="positive">${formatNumber(g.gainAmount)}</td>
                <td></td>
                <td class="${g.total > 0 ? 'positive' : g.total < 0 ? 'negative' : ''}">${formatNumber(g.total)}</td>
                <td></td>
                <td></td>
                <td></td>
            </tr>`);

        const sortedBars = Object.entries(g.bars).sort(([, a], [, b]) => b.total - a.total);
        for (const [name, bar] of sortedBars) {
            const expected = bar.payCount && bar.probability ? (1 / bar.probability).toFixed(2) : "-";
            const probDisp = bar.probability ? `${(bar.probability * 100).toFixed(2)}% (${expected})` : "-";
            tbody.push(`
                <tr class="depth-3">
                    <td>${name}</td>
                    <td class="negative">${formatNumber(bar.payAmount)}</td>
                    <td>${bar.payCount}</td>
                    <td class="positive">${formatNumber(bar.gainAmount)}</td>
                    <td>${bar.gainCount}</td>
                    <td class="${bar.total > 0 ? 'positive' : bar.total < 0 ? 'negative' : ''}">${formatNumber(bar.total)}</td>
                    <td>${probDisp}</td>
                    <td><button onclick="showDetail('bar','${genre}','${name}')">詳細</button></td>
                    <td><button onclick="openRelatedLogs('bar','${genre}','${name}')">関連ログ</button></td>
                </tr>`);
        }
    }

    return `
        <table class="bar-table">
            <thead>
                <tr class="header-row">
                    <th>酒名</th>
                    <th>支出</th>
                    <th>購入本数</th>
                    <th>収入</th>
                    <th>当選回数</th>
                    <th>収支</th>
                    <th>確率(期待回数)</th>
                    <th>詳細</th>
                    <th>関連ログ</th>
                </tr>
            </thead>
            <tbody>${tbody.join('\n')}</tbody>
        </table>
    `;
}

function createSlotTable(stats) {
    const tbody = [];

    const { payAmount, gainAmount, total, duration } = stats.total;
    tbody.push(`
        <tr class="depth-1">
            <td>全体</td>
            <td class="negative">${formatNumber(payAmount)}</td>
            <td class="positive">${formatNumber(gainAmount)}</td>
            <td class="${total > 0 ? 'positive' : total < 0 ? 'negative' : ''}">${formatNumber(total)}</td>
            <td>${formatDuration(duration)}</td>
            <td></td>
            <td></td>
        </tr>`);

    const sortedPrices = Object.keys(stats.prices).sort((a, b) => a - b);
    for (const price of sortedPrices) {
        const p = stats.prices[price];
        tbody.push(`
            <tr class="depth-2">
                <td>${price}円スロット</td>
                <td class="negative">${formatNumber(p.payAmount)}</td>
                <td class="positive">${formatNumber(p.gainAmount)}</td>
                <td class="${p.total > 0 ? 'positive' : p.total < 0 ? 'negative' : ''}">${formatNumber(p.total)}</td>
                <td>${formatDuration(p.duration)}</td>
                <td></td>
                <td></td>
            </tr>`);

        const sortedSlots = Object.entries(p.slots).sort(([, a], [, b]) => b.total - a.total);
        for (const [name, slot] of sortedSlots) {
            tbody.push(`
                <tr class="depth-3">
                    <td>${name}</td>
                    <td class="negative">${formatNumber(slot.payAmount)}</td>
                    <td class="positive">${formatNumber(slot.gainAmount)}</td>
                    <td class="${slot.total > 0 ? 'positive' : slot.total < 0 ? 'negative' : ''}">${formatNumber(slot.total)}</td>
                    <td>${formatDuration(slot.duration)}</td>
                    <td><button onclick="showDetail('slot','${price}','${name}')">詳細</button></td>
                    <td><button onclick="openRelatedLogs('slot','${price}','${name}')">関連ログ</button></td>
                </tr>`);
        }
    }

    return `
        <table class="slot-table">
            <thead>
                <tr class="header-row">
                    <th>スロット名</th>
                    <th>支出</th>
                    <th>収入</th>
                    <th>収支</th>
                    <th>回転時間</th>
                    <th>詳細</th>
                    <th>関連ログ</th>
                </tr>
            </thead>
            <tbody>${tbody.join('\n')}</tbody>
        </table>
    `;
}

function createChangerTable(stats) {
    const tbody = [];

    tbody.push(`
        <tr class="depth-1">
            <td>全体</td>
            <td class="positive">${formatNumber(stats.total.gainAmount)}</td>
            <td><button onclick="openRelatedLogs('changer', 'all')">関連ログ</button></td>
        </tr>`);

    for (const name in stats.prices) {
        tbody.push(`
            <tr class="depth-2">
                <td>${name}</td>
                <td class="positive">${formatNumber(stats.prices[name].gainAmount)}</td>
                <td></td>
            </tr>`);
    }

    return `
        <table class="changer-table">
            <thead>
                <tr class="header-row">
                    <th>受取額名</th>
                    <th>受取金額</th>
                    <th>関連ログ</th>
                </tr>
            </thead>
            <tbody>${tbody.join('\n')}</tbody>
        </table>
    `;
}

function createPtoPTable(stats) {
    const { payAmount, gainAmount, total } = stats.total;
    return `
        <table class="ptop-table">
            <thead>
                <tr class="header-row">
                    <th>対人ギャンブル</th>
                    <th>支出</th>
                    <th>収入</th>
                    <th>収支</th>
                    <th>関連ログ</th>
                </tr>
            </thead>
            <tbody>
                <tr class="depth-1">
                    <td>合計</td>
                    <td class="negative">${formatNumber(payAmount)}</td>
                    <td class="positive">${formatNumber(gainAmount)}</td>
                    <td class="${total > 0 ? 'positive' : total < 0 ? 'negative' : ''}">${formatNumber(total)}</td>
                    <td><button onclick="openRelatedLogs('ptop', 'all')">関連ログ</button></td>
                </tr>
            </tbody>
        </table>
    `;
}

window.showDetail = function(type, genre, name) {
    const result = window.analysisResult;  

    if (type === "bar") {
        showBarStatsDetail(genre, name, result);
    } else if (type === "slot") {
        showSlotStatsDetail(genre, name, result);
    } else {
        alert("未対応のタイプです: " + type);
    }
}

function showBarStatsDetail(genre, name, result) {
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

    const stats = result.stats.bar;
    const noStreaksGenre = ["Dan5", "Secret", "BarSlot"];

    if (!noStreaksGenre.includes(genre)) {
        // --- 連勝記録ランキング ---
        const winStreaksData = stats.winStreaks?.[name];
        const winList = Array.isArray(winStreaksData) ? [...winStreaksData] : [];
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

        // --- 連敗記録 ---
        const loseStreaksData = stats.loseStreaks?.[name];
        const loseList = Array.isArray(loseStreaksData) ? [...loseStreaksData] : [];
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

    // --- Dan5 情報 ---
    if (genre === "Dan5" && stats.dangoInfo) {
        const section = document.createElement("section");
        const h = document.createElement("h4");
        h.textContent = `【${name}】の詳細情報`;
        section.appendChild(h);

        const { sold, message } = stats.dangoInfo;

        const sellInfo = document.createElement("p");
        sellInfo.innerHTML = `
            <strong>・売却数</strong><br>
            青 (10万) : ${sold?.[10] || 0}<br>
            緑 (20万) : ${sold?.[20] || 0}<br>
            赤 (40万) : ${sold?.[40] || 0}<br>
            金 (80万) : ${sold?.[80] || 0}
        `;
        section.appendChild(sellInfo);

        const winInfo = document.createElement("p");
        winInfo.innerHTML = `
            <strong>・当選数</strong><br>
            白⇒青 : ${message?.[10] || 0}<br>
            青⇒緑 : ${message?.[20] || 0}<br>
            緑⇒赤 : ${message?.[40] || 0}<br>
            赤⇒金 : ${message?.[80] || 0}<br>
            金当選 : ${stats.genres[genre].bars[name].gainCount || 0}
        `;
        section.appendChild(winInfo);

        container.appendChild(section);
    }

    // --- BarSlot 情報 ---
    if (genre === "BarSlot") {
        const section = document.createElement("section");
        const h = document.createElement("h4");
        h.textContent = `【${name}】の詳細情報`;
        section.appendChild(h);

        const info = stats.barSlotInfo?.[name] || {};
        const sellInfo = document.createElement("p");
        sellInfo.innerHTML = `
            <strong>・売却数</strong><br>
            5万 : ${info[5] || 0}<br>
            10万 : ${info[10] || 0}
        `;
        section.appendChild(sellInfo);

        container.appendChild(section);
    }

    content.appendChild(container);
    modal.showModal();
}

function showSlotStatsDetail(genre, name, result) {
    const modal = document.getElementById("detail-modal");
    const title = document.getElementById("detail-modal-title");
    const content = document.getElementById("detail-modal-content");

    title.textContent = `【${name}】の役出現回数`;
    content.innerHTML = '';

    const container = document.createElement("div");
    container.style.maxHeight = "300px";
    container.style.overflowY = "auto";

    // genre は価格
    const stats = result.stats.slot;
    const priceGroup = stats.prices[genre];
    if (!priceGroup) {
        content.textContent = "該当するスロット価格グループが見つかりません。";
        modal.showModal();
        return;
    }
    const slot = priceGroup.slots[name];
    if (!slot) {
        content.textContent = "該当するスロットが見つかりません。";
        modal.showModal();
        return;
    }

    if (slot.roleCounts && Object.keys(slot.roleCounts).length > 0) {
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

        Object.entries(slot.roleCounts)
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

window.openRelatedLogs = function(type, genre, name) {
    const logs = window.analysisResult.logs;
    const idMap = window.analysisResult.idMap;

    if (type === "bar") {
        const sectionsMap = (idMap.bar?.[genre]?.[name]) || {};
        openSectionsWithSplitLine(sectionsMap, logs, `${name}`);

    } else if (type === "slot") {
        const sectionsMap = (idMap.slot?.[genre]?.[name]) || {};
        // 区間IDは任意の数字（連続していない場合もある）なので、1から連番で並べ直して表示する
        const sections = Object.entries(sectionsMap).map(([secId, logIds]) => ({secId, logIds}));
        sections.sort((a,b) => a.secId - b.secId);
        // 連番IDを付けて並べ替え
        const renumberedSections = sections.map(({secId, logIds}, i) => ({
            id: i+1,
            origId: secId,
            logIds
        }));
        openSlotSectionsInNewTab(renumberedSections, logs, `【${genre}】${name}`);

    } else if (type === "changer") {
        const sectionsMap = idMap.changer || {};
        openSectionsWithSplitLine(sectionsMap, logs, "両替機");

    } else if (type === "ptop") {
        const sectionsMap = idMap.ptop || {};
        // ptopは区間なしなので、すべてのログIDをまとめて表示
        const allLogIds = Object.values(sectionsMap).flat();
        openTextInNewTab("対人ギャンブル", formatLogContent(allLogIds, logs));
    } else {
        alert("未対応のタイプです: " + type);
    }
}

// 区間ごとにログを分割線で区切りつつまとめて開く関数
function openSectionsWithSplitLine(sectionsMap, logs, title) {
    const sections = Object.entries(sectionsMap)
        .map(([secId, logIds]) => {
            if (logIds.length === 0) return null;
            const first = logs[logIds[0]];
            const last = logs[logIds[logIds.length - 1]];
            return {
                id: secId,
                start: first?.datetime || "?",
                end: last?.datetime || "?",
                logIds
            };
        })
        .filter(Boolean)
        .sort((a,b) => a.id - b.id);

    const content = sections.map(sec => {
        const header = `=== 区間 ${sec.id} : ${sec.start.replace("T", " ")} ～ ${sec.end.replace("T", " ")} ===\n`;
        const lines = sec.logIds.map(id => {
            const log = logs[id];
            return log ? `[ID:${id}] [${log.datetime.replace("T", " ")}] ${log.chat}` : `[${id}] (ログなし)`;
        });
        return header + lines.join("\n");
    }).join("\n\n");

    openTextInNewTab(title + " の関連ログ", content);
}

// スロットの区間一覧表示＋各区間ログを別タブで開くUIを作る関数
function openSlotSectionsInNewTab(sections, logs, title) {
    const newWindow = window.open("", "_blank");
    if (!newWindow) {
        alert("ポップアップブロックにより新しいタブを開けませんでした");
        return;
    }

    newWindow.slotSectionLogs = sections;
    newWindow.logs = logs;

    const html = `
    <!DOCTYPE html>
    <html lang="ja">
    <head>
        <meta charset="UTF-8">
        <title>${title} スロット区間一覧</title>
        <style>
            body { font-family: sans-serif; padding: 1em; }
            button { margin: 0.3em 0; padding: 0.4em 1em; }
            .section { margin-bottom: 1em; border-bottom: 1px solid #ccc; padding-bottom: 0.7em; }
            .info { margin-left: 1em; font-size: 100%; color: #333; }
        </style>
    </head>
    <body>
        <h1>${title} スロット区間一覧</h1>
        <button onclick="openAllSlotLogs()">全区間をまとめて表示</button>

        ${sections.map((s, i) => {
            const start = logs[s.logIds[0]]?.datetime || "??";
            const end = logs[s.logIds[s.logIds.length - 1]]?.datetime || "??";
            const duration = start !== "??" && end !== "??"
                ? ((new Date(end) - new Date(start)) / 60000).toFixed(1)
                : "-";

            return `
                <div class="section">
                    <div><strong>区間 ${s.id}</strong></div>
                    <div class="info">
                        ログ数: ${s.logIds.length} ／ 開始: ${start.replace("T", " ")} ／ 終了: ${end.replace("T", " ")} ／ 回転時間: ${duration}分
                    </div>
                    <button onclick="openSlotLog(${s.id - 1})">この区間のログを表示</button>
                </div>
            `;
        }).join('')}

        <script>
            function openSlotLog(index) {
                const section = window.slotSectionLogs[index];
                const logs = window.logs;
                const content = section.logIds.map(id => {
                    const log = logs[id];
                    return log ? \`[\${log.datetime.replace("T", " ")}] \${log.chat}\` : \`[\${id}] (ログなし)\`;
                }).join("\\n");

                openInNewTab("スロット区間ログ", content);
            }

            function openAllSlotLogs() {
                const logs = window.logs;
                const sections = window.slotSectionLogs;

                const content = sections.map((section, i) => {
                    const header = \`=== 区間 \${section.id} ===\\n\`;
                    const lines = section.logIds.map(id => {
                        const log = logs[id];
                        return log ? \`[\${log.datetime.replace("T", " ")}] \${log.chat}\` : \`[\${id}] (ログなし)\`;
                    });
                    return header + lines.join("\\n");
                }).join("\\n\\n");

                openInNewTab("全スロット区間ログ", content);
            }

            function openInNewTab(title, content) {
                const win = window.open("", "_blank");
                if (!win) {
                    alert("ポップアップブロックにより新しいタブを開けませんでした");
                    return;
                }
                win.document.write(\`
                    <!DOCTYPE html>
                    <html lang="ja">
                    <head>
                        <meta charset="UTF-8">
                        <title>\${title}</title>
                        <style>
                            body { font-family: monospace; white-space: pre-wrap; padding: 1em; font-size: 16px; }
                        </style>
                    </head>
                    <body><pre>\${content
                        .replace(/&/g, "&amp;")
                        .replace(/</g, "&lt;")
                        .replace(/>/g, "&gt;")}</pre></body>
                    </html>
                \`);
                win.document.close();
            }
        </script>
    </body>
    </html>
    `;

    newWindow.document.write(html);
    newWindow.document.close();
}

// ログ複数行をまとめて文字列化
function formatLogContent(logIds, logs) {
    return logIds.map(id => {
        const log = logs[id];
        return log ? `[${log.datetime.replace("T", " ")}] ${log.chat}` : `[${id}] (ログなし)`;
    }).join("\n");
}

// 単純テキスト表示用
function openTextInNewTab(title, content) {
    const newWindow = window.open("", "_blank");
    if (!newWindow) {
        alert("ポップアップブロックにより新しいタブを開けませんでした");
        return;
    }
    const escapedContent = content
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    newWindow.document.write(`
        <!DOCTYPE html>
        <html lang="ja">
        <head>
            <meta charset="UTF-8" />
            <title>${title}</title>
            <style>
                body {
                    font-family: monospace;
                    white-space: pre-wrap;
                    padding: 1em;
                    font-size: 20px;
                }
            </style>
        </head>
        <body><pre>${escapedContent}</pre></body>
        </html>
    `);
    newWindow.document.close();
}

function createBarSummaryText(stats) {
    const lines = [];
    const genreOrder = ["Beginner", "Gambler", "VIP", "Secret"];

    for (const genre of genreOrder) {
        const g = stats.genres[genre];
        if (!g) continue;

        for (const [name, bar] of Object.entries(g.bars)) {
            lines.push(`${name},${bar.payCount}本,${bar.gainCount}回`);
        }
    }
    return lines.join("\n");
}