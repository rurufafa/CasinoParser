export default class LogAnalyzer {
    constructor(barInfo, slotInfo, logs, sectionMap) {
        this.barInfo = barInfo;
        this.slotInfo = slotInfo;
        this.logs = logs;
        this.sectionMap = sectionMap;

        this.idByBarName = {};  // 各酒の関連ログ
        this.idBySlotName = {}; // 各スロットの関連ログ
    }

    analyze() {
        const stats = {
            bar : {},
            slot : {},
            changer : {},
            ptop : {}
        }
        stats.bar = this._analyzeBarLog();
        stats.slot = this._analyzeSlotLog();
        stats.changer = this._analyzeChangerLog();
        stats.ptop = this._analyzePtoPLog();

        const idMap = {
            bar : this.idByBarName,
            slot : this.idBySlotName, 
            changer : this.sectionMap.changer,
            ptop : this.sectionMap.ptop
        }

        return { logs : this.logs, idMap, stats };
    }

    _getOrInit(obj, keys, defaultValue) {
        let target = obj;
        for (let i = 0; i < keys.length - 1; i++) {
            if (!target[keys[i]]) target[keys[i]] = {};
            target = target[keys[i]];
        }
        const lastKey = keys.at(-1);
        if (!target[lastKey]) 
            target[lastKey] = typeof defaultValue === "function" ? defaultValue() : defaultValue;
        return target[lastKey];
    }

    _analyzeBarLog() {
        const stats = {
            total : {
                payAmount : 0,
                gainAmount : 0,
            },
            genres : {},
            loseStreaks : {},
            winStreaks : {},
            dangoInfo : {
                sold : {10 : 0, 20 : 0, 40 : 0, 80 : 0},
                message : {10 : 0, 20 : 0, 40 : 0, 80 : 0} 
            },
            barSlotInfo : {
                "店長特製コンクラーヴェ" : {5 : 0, 10 : 0},
                "店長特製ブルームーン" : {5 : 0, 10 : 0}
            }
        };

        const lastGainCount = {}; // 直近の当選からの購入回数 (for loseStreaks)
        const loseStartId = {}; // { barName: startId }

        const lastLoseCount = {}; // 直近のハズレからの当選回数 (for winStreaks)
        const winStartId = {};  // { barName: startId }
        
        const lastWasLose = {};   // ハズレが連続する場合はIDを記録しない (for idByBarName)
        for (const [sectionId, section] of Object.entries(this.sectionMap.bar)) {
            // この区間内で購入された酒
            const purchasedBefore = {};

            for (const id of section) {
                const log = this.logs[id];
                const {name, amount, direction} = log;

                // ハズレの処理
                if (direction === "lose") {
                    // 区間内で購入した酒について処理
                    for (const barName of Object.keys(this.barInfo)) {
                        if (!purchasedBefore[barName]) 
                            continue; 

                        const genre = this.barInfo[barName].genre;

                        if (lastWasLose[barName] === false) {
                            const idArr = this._getOrInit(this.idByBarName, [genre, barName, sectionId], () => []);
                            idArr.push(id);
                        }
                        lastWasLose[barName] = true;
                    }

                    // 連勝記録のリセット
                    for (const barName in lastLoseCount) {
                        if (!purchasedBefore[barName]) 
                            continue; 
                        const winArr = this._getOrInit(stats, ['winStreaks', barName], () => []);
                        winArr.push({
                            count: lastLoseCount[barName],
                            startId: winStartId[barName],
                            endId: id
                        });
                        lastLoseCount[barName] = 0;
                        winStartId[barName] = null;
                    }
                    continue;
                }

                // ハズレ以外の処理
                if (!name || !(name in this.barInfo)) 
                    continue;
                lastWasLose[name] = false;

                const genre = this.barInfo[log.name].genre;
                const idArr = this._getOrInit(this.idByBarName, [genre, name, sectionId], () => []);
                idArr.push(id);

                // 初期化
                const g = this._getOrInit(stats, ['genres', genre], () => ({payAmount : 0, gainAmount : 0, bars : {}}));
                const b  = this._getOrInit(g.bars, [name], () => ({
                    pay : 0,
                    payAmount : 0,
                    payCount : 0,
                    gain : this.barInfo[name].gainPrice,
                    gainAmount : 0,
                    gainCount : 0,
                    probability : 0
                }));

                if (direction === "pay") {
                    purchasedBefore[name] = true;

                    stats.total.payAmount += amount;
                    g.payAmount += amount;
                    b.payAmount += amount;
                    b.payCount++;

                    if (b.pay === 0) 
                        b.pay = amount;

                    // 連敗記録のインクリメント
                    lastGainCount[name] = (lastGainCount[name] ?? 0) + 1;
                    if (loseStartId[name] === null || loseStartId[name] === undefined) {
                        loseStartId[name] = id;
                    }
                } else if (direction === "gain") {
                    stats.total.gainAmount += amount;
                    g.gainAmount += amount;
                    b.gainAmount += amount;
                    b.gainCount++;

                    // 連敗記録のリセット
                    if (lastGainCount[name]) {
                        const loseArr = this._getOrInit(stats, ['loseStreaks', name], () => []);
                        loseArr.push({
                            count: lastGainCount[name],
                            startId: loseStartId[name],
                            endId: id
                        });
                        lastGainCount[name] = 0;
                        loseStartId[name] = null;
                    }

                    // 連勝記録のインクリメント
                    lastLoseCount[name] = (lastLoseCount[name] ?? 0) + 1;
                    if (winStartId[name] === null || winStartId[name] === undefined) {
                        winStartId[name] = id;
                    }

                } else {
                    // チャージ・dan5当選記録の集計
                    const key = amount / 10000;
                    if (direction === "charge") {
                        if (genre === "Dan5" && key in stats.dangoInfo.sold) {
                            stats.dangoInfo.sold[key]++;
                        } else if (genre === "BarSlot" && name in stats.barSlotInfo && key in stats.barSlotInfo[name]) {
                            stats.barSlotInfo[name][key]++;
                        }
                        stats.total.gainAmount += amount;
                        g.gainAmount += amount;
                        b.gainAmount += amount;
                    } else if (direction === "mes") {
                        if (genre === "Dan5" && key in stats.dangoInfo.message)
                            stats.dangoInfo.message[key]++;
                    }
                }   
            }
        }

        const lastId = Object.values(this.sectionMap.bar).at(-1)?.at(-1) ?? null;

        // 最後に連勝記録、連敗記録を保存
        for (const barName in lastGainCount) {
            if (lastGainCount[barName]) {
                const loseArr = this._getOrInit(stats, ['loseStreaks', barName], () => []);
                loseArr.push({
                    count: lastGainCount[barName],
                    startId: loseStartId[barName],
                    endId: lastId ?? 9999999
                });
            }
        }
        for (const barName in lastLoseCount) {
            if (lastLoseCount[bar]) {
                const winArr = this._getOrInit(stats, ['winStreaks', barName], () => []);
                winArr.push({
                    count: lastLoseCount[barName],
                    startId: winStartId[barName],
                    endId: lastId ?? 9999999
                });
            }
        }

        // 当選確率計算
        const streakBars = [ "無限水源ソーダ", "一万搾り", "川崎 50年(ショット)", "喝采 磨き 二割三分"];
        for (const genre of Object.keys(stats.genres)) {
            const bars = stats.genres[genre].bars;
            for (const name of Object.keys(bars)) {
                const b = bars[name];
                const p = b.payAmount ? ((b.gainCount) / (b.payCount)) : 0;
                // 連荘酒の継続率は、当選回数の割合をpとするとp/p+1
                if (streakBars.includes(name)) {
                    b.probability = p / (p + 1);
                } else {
                    b.probability = p;
                }
            }
        }

        // 合計 (全体、ジャンル、酒ごと)
        stats.total.total = stats.total.gainAmount - stats.total.payAmount;
        for (const genre of Object.keys(stats.genres)) {
            const g = stats.genres[genre];
            g.total = g.gainAmount - g.payAmount;

            const bars = stats.genres[genre].bars;
            for (const name of Object.keys(bars)) {
                const b = bars[name];
                b.total = b.gainAmount - b.payAmount;
            }
        }
        return stats; 
    }

    _analyzeSlotLog() {
        const stats = {
            total : {
                payAmount : 0,
                gainAmount : 0,
                duration: 0
            },
            prices : {}
        };

        for (const [sectionId, section] of Object.entries(this.sectionMap.slot)) {
            const firstLog = this.logs[section[0]];
            const lastLog = this.logs[section.at(-1)];
            const startTime = new Date(firstLog.datetime);
            const endTime = new Date(lastLog.datetime);
            const duration = endTime - startTime;

            const name = firstLog.name;
            const price = firstLog.price;
            if (!name || !(name === "不明" || name in this.slotInfo) || price === undefined || price === null) 
                continue;

            const p = this._getOrInit(stats, ['prices', price], () => ({payAmount : 0, gainAmount : 0, slots : {}}));
            const s = this._getOrInit(p.slots, [name], () => ({
                payAmount : 0,
                gainAmount : 0,
                roleCounts: {},
                duration : 0
            }));
            
            s.duration += duration;
            stats.total.duration += duration;

            for (const id of section) {
                const log = this.logs[id];
                const { amount, direction, role } = log;
                if (log.price === undefined || log.price === null || !log.name) 
                    continue;

                const idArr = this._getOrInit(this.idBySlotName, [price, name, sectionId], () => []);
                idArr.push(id);

                if (direction === "pay") {
                    stats.total.payAmount += amount;
                    p.payAmount += amount;
                    s.payAmount += amount;
                } else if (direction === "gain") {
                    stats.total.gainAmount += amount;
                    p.gainAmount += amount;
                    s.gainAmount += amount;
                } else if (direction === "role" && role) {
                    s.roleCounts[role] = (s.roleCounts[role] || 0) + 1;
                }
            }
        }

        stats.total.total = stats.total.gainAmount - stats.total.payAmount;
        for (const price of Object.keys(stats.prices)) {
            const p = stats.prices[price];
            p.total = p.gainAmount - p.payAmount;

            for (const name of Object.keys(p.slots)) {
                const s = p.slots[name];
                s.total = s.gainAmount - s.payAmount;
            }
        }
        return stats;
    }

    _analyzeChangerLog() {
        const stats = {
            total: {
                gainAmount: 0
            },
            prices: {}
        };

        for (const [sectionId, section] of Object.entries(this.sectionMap.changer)) {
            for (const id of section) {
                const log = this.logs[id];
                const { amount, name } = log;
                if (!name || !amount) continue;

                const p = this._getOrInit(stats, ['prices', name], () => ({ gainAmount: 0 }));
                stats.total.gainAmount += amount;
                p.gainAmount += amount;
            }
        }
        return stats;
    }

    _analyzePtoPLog() {
        const stats = {
            total: {
                payAmount: 0,
                gainAmount: 0
            }
        };

        for (const [sectionId, ids] of Object.entries(this.sectionMap.ptop)) {
            for (const id of ids) {
                const log = this.logs[id];
                const { amount, direction } = log;
                if (!amount) continue;

                if (direction === "pay") {
                    stats.total.payAmount += amount;
                } else if (direction === "gain") {
                    stats.total.gainAmount += amount;
                }
            }
        }
        stats.total.total = stats.total.gainAmount - stats.total.payAmount;

        return stats;
    }
}