export default class GambleAnalyzer {
    constructor(barInfo, slotInfo, logs) {
        this.barInfo = barInfo;
        this.slotInfo = slotInfo;
        this.logs = logs;
        this.idBySlotName = {}; // 各スロットの関連ログ
        this.idByBarName = {};  // 各酒の関連ログ
    }

    analyze(idByType) {
        const barStats = this._analyzeBarLog(idByType.Bar || []);
        const slotStats = this._analyzeSlotLog(idByType.Slot || []);
        const changerStats = this._analyzeChangerLog(idByType.Changer || []);
        const ptopStats = this._analyzePtoPLog(idByType.PtoP || []);
        return {
            barStats,
            slotStats,
            changerStats,
            ptopStats
        };
    }

    _analyzeBarLog(ids) {
        const stats = {
            total : {
                payAmount : 0,
                gainAmount : 0,
            },
            genres : {},
            // { genre: { payAmount, gainAmount, bars } } } }
            // genre.bars = { name: { pay, payAmount, gain, gainAmount, probability } }
            loseStreaks : {}, // { barName: [{count, startId, endId}, ...] }
            winStreaks : {},  // { barName: [{count, startId, endId}, ...] }
            dangoInfo : {
                gain : {10 : 0, 20 : 0, 40 : 0, 80 : 0, 160 : 0},
                message : {10 : 0, 20 : 0, 40 : 0, 80 : 0} 
            },
            barSlotInfo : {
                "店長特製コンクラーヴェ" : {5 : 0, 10 : 0},
                "店長特製ブルームーン" : {5 : 0, 10 : 0}
            }
        };

        const lastGainCount = {}; // 直近の当選からの購入回数 (for loseStreaks)
        const lastLoseCount = {}; // 直近のハズレからの当選回数 (for winStreaks)
        const loseStartId = {}; // { barName: startId }
        const winStartId = {};  // { barName: startId }
        const lastWasLose = {};   // idByBarName (ハズレが連続する場合はIDを記録しない)

        for (const id of ids) {
            const log = this.logs[id];
            const {name, amount, direction} = log;

            if (!this.idByBarName[name])
                this.idByBarName[name] = [];
            this.idByBarName[name].push(id);

            // ハズレの処理
            if (direction === "lose") {
                // 全酒について処理
                for (const barName of Object.keys(this.barInfo)) {
                    if (!lastWasLose[barName]) {
                        if (!this.idByBarName[barName])
                            this.idByBarName[barName] = [];
                        // IDを記録(前回がハズレでないとき)
                        this.idByBarName[barName].push(id);
                    }
                    lastWasLose[barName] = true;
                }

                // 連勝記録のリセット
                for (const bar in lastLoseCount) {
                    if (!stats.winStreaks[bar])
                        stats.winStreaks[bar] = [];

                    stats.winStreaks[bar].push({
                        count: lastLoseCount[bar],
                        startId: winStartId[bar],
                        endId: id
                    });
                    lastLoseCount[bar] = 0;
                    winStartId[name] = null;
                }

                continue;
            }

            // ハズレ以外の処理
            if (!name || !(name in this.barInfo))
                continue;

            // ハズレ連続のリセット
            lastWasLose[name] = false;

            // IDを記録
            if (!this.idByBarName[name])
                this.idByBarName[name] = [];
            this.idByBarName[name].push(id);

            const genre = this.barInfo[name].genre;

            // 初期化
            if (!stats.genres[genre]) {
                stats.genres[genre] = {payAmount : 0, gainAmount : 0, bars : {}};
            }
            if (!stats.genres[genre].bars[name]) {
                stats.genres[genre].bars[name] = {
                    pay : 0,
                    payAmount : 0,
                    gain : this.barInfo[name].gainPrice,
                    gainAmount : 0,
                    probability : 0
                };
            }

            const g = stats.genres[genre];
            const b = g.bars[name];

            if (direction === "pay") {
                stats.total.payAmount += amount;
                g.payAmount += amount;
                b.payAmount += amount;
                if (b.pay === 0)
                    b.pay = amount;

                // 連敗記録のインクリメント
                if (!lastGainCount[name]) {
                    lastGainCount[name] = 0;
                    loseStartId[name] = id;
                }
                lastGainCount[name]++;
            }

            if (direction === "gain") {
                stats.total.gainAmount += amount;
                g.gainAmount += amount;
                b.gainAmount += amount;

                
                // 連敗記録のリセット
                if (lastGainCount[name]) {
                    if (!stats.loseStreaks[name])
                        stats.loseStreaks[name] = [];
                    stats.loseStreaks[name].push({
                        count: lastGainCount[name],
                        startId: loseStartId[name],
                        endId: id
                    });
                    lastGainCount[name] = 0;
                    loseStartId[name] = null;
                }

                // 連勝記録のインクリメント
                if (!lastLoseCount[name]) {
                    lastLoseCount[name] = 0;
                    winStartId[name] = id;
                }
                lastLoseCount[name]++;
            }

            // 団子酒のとき金額ごとにも保持する
            if (genre === "Dan5") {
                const key = amount / 10000;
                if (direction === "gain" && key in stats.dangoInfo.gain) {
                    stats.dangoInfo.gain[key]++;
                } else if (direction === "mes" && key in stats.dangoInfo.message) {
                    stats.dangoInfo.message[key]++;
                }
            }

            if (genre === "BarSlot") {
                const key = amount / 10000;
                console.log("name:",name);
                console.log(key);
                if (direction === "gain" && key in stats.barSlotInfo[name]) 
                    stats.barSlotInfo[name][key]++;
            }
        }
        
        // 最後に連勝記録、連敗記録を保存
        for (const bar in lastGainCount) {
            if (lastGainCount[bar]) {
                if (!stats.loseStreaks[bar])
                    stats.loseStreaks[bar] = [];
                stats.loseStreaks[bar].push({
                    count: lastGainCount[bar],
                    startId: loseStartId[bar],
                    endId: ids[ids.length - 1]
                });
            }
        }
        for (const bar in lastLoseCount) {
            if (lastLoseCount[bar]) {
                if (!stats.winStreaks[bar])
                    stats.winStreaks[bar] = [];

                stats.winStreaks[bar].push({
                    count: lastLoseCount[bar],
                    startId: winStartId[bar],
                    endId: ids[ids.length - 1]
                });
            }
        }

        // 当選確率計算
        const streakBars = [ "無限水源ソーダ", "一万搾り", "川崎 50年(ショット)", "喝采 磨き 二割三分"];
        for (const genre of Object.keys(stats.genres)) {
            const bars = stats.genres[genre].bars;
            for (const name of Object.keys(bars)) {
                const b = bars[name];
                const p = b.payAmount ? ((b.gainAmount / b.gain) / (b.payAmount / b.pay)) : 0;
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

    _analyzeSlotLog(slotGroups) {
        const stats = {
            total : {
                payAmount : 0,
                gainAmount : 0,
                duration: 0
            },
            prices : {}, // { price: { payAmount, gainAmount, slots: { name: { payAmount,gainAmount,roleCounts,duration } } } }
        };

        // 各スロット区間
        for (const group of slotGroups) {
            const name = group.name;
            const ids = group.ids;
            if (!name || ids.length === 0 || !(name === "不明" || name in this.slotInfo)) continue;

            // 時間差を計算（最初と最後のログのdatetimeの差）
            const startTime = new Date(this.logs[ids[0]].datetime);
            const endTime = new Date(this.logs[ids.at(-1)].datetime);
            const duration = endTime - startTime;

            for (const id of ids) {
                const log = this.logs[id];
                const { price, amount, direction, role } = log;

                // IDを記録
                if (!this.idBySlotName[name])
                    this.idBySlotName[name] = [];
                this.idBySlotName[name].push(id);

                // 初期化
                if (!stats.prices[price]) {
                    stats.prices[price] = {payAmount : 0, gainAmount : 0, slots : {}};
                }
                if (!stats.prices[price].slots[name]) {
                    stats.prices[price].slots[name] = {
                        payAmount : 0,
                        gainAmount : 0,
                        roleCounts: {},
                        duration : 0
                    };
                }

                const p = stats.prices[price];
                const s = p.slots[name];

                if (direction === "pay") {
                    stats.total.payAmount += amount;
                    p.payAmount += amount;
                    s.payAmount += amount;
                } else if (direction === "gain") {
                    stats.total.gainAmount += amount;
                    p.gainAmount += amount;
                    s.gainAmount += amount;
                } else if (direction === "hint" && role) {
                    // 役名のカウント処理
                    s.roleCounts[role] = (s.roleCounts[role] || 0) + 1;
                }

            }

            // duration を追加
            const price = this.logs[ids[0]].price; // グループ内は同一価格帯のはず
            if (stats.prices[price] && stats.prices[price].slots[name]) {
                if (price === 10000) {
                    console.log(duration,name);
                    console.log(this.logs[ids[0]].datetime, this.logs[ids[0]].chat );
                    console.log(this.logs[ids.at(-1)].datetime, this.logs[ids.at(-1)].chat );
                }
                stats.prices[price].slots[name].duration += duration;
                stats.total.duration += duration;
            }
        }

        // 合計 (全体、同価格帯スロット、スロットごと)
        stats.total.total = stats.total.gainAmount - stats.total.payAmount;
        for (const price of Object.keys(stats.prices)) {
            const p = stats.prices[price];
            p.total = p.gainAmount - p.payAmount;

            const slots = p.slots;
            for (const name of Object.keys(slots)) {
                const s = slots[name];
                s.total = s.gainAmount - s.payAmount;
            }
        }

        return stats;
    }

    _analyzeChangerLog(ids) {
        const stats = {
            total : {
                gainAmount : 0
            },
            prices : {}, // { price: { gainAmount, rawText } }

        };

        for (const id of ids) {
            const log = this.logs[id];
            const {amount, price, rawText} = log;
            if (!price || !amount)
                continue;

            if (!stats.prices[price]) {
                stats.prices[price] = {gainAmount : 0};
            }
            const p = stats.prices[price];
            stats.total.gainAmount += amount;
            p.gainAmount += amount;
            p.rawText = rawText;
        }
        return stats;
    }

    _analyzePtoPLog(ids) {
        const stats = {
            total : {
                payAmount : 0,
                gainAmount : 0
            }
        };

        for (const id of ids) {
            const log = this.logs[id];
            const {amount, direction} = log;
            if (!amount)
                continue;

            if (direction === "pay") {
                stats.total.payAmount += amount;
            } else if (direction === "gain") {
                stats.total.gainAmount += amount;
            }
        }

        // 合計 (全体)
        stats.total.total = stats.total.gainAmount - stats.total.payAmount;

        return stats;
    }
}