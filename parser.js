export default class GambleParser {
    constructor(barInfo, slotInfo) {
        this.it = 0;                                           // ログID
        this.logs = {};

        this.barInfo = barInfo;                                // 酒の情報
        this.lastBarMap = this._initLastBarMap(barInfo);       // 当選金額に対応する直近に購入した酒
        this.lastBarBuyTime = new Map();                       // 各酒の直近の購入時刻
        this.lastBarGainTime = new Map();
        this.dangoPrices = [ 100000, 200000, 400000, 800000 ]; // 団子酒の売却額

        this.slotInfo = slotInfo;                              // スロットの情報
        this.slotGroup = {};
        this.slotPriceMap = this._initSlotPriceMap(slotInfo);  // 1回転の金額に対応するスロット一覧
        this.lastSlotPrice = 0;                                // 直近に回したスロットの1回転の金額
        this.lastSlotDirection = null;                         // 直近に回したスロットの状態
    }

    _initLastBarMap(barInfo) {
        const map = new Map();

        for (const [name, info] of Object.entries(barInfo)) {
            map.set(info.gainPrice, name);
        }

        return map;
    }

    _initSlotPriceMap(slotInfo) {
        const map = new Map();
        for (const [name, info] of Object.entries(slotInfo)) {
            if (!map.has(info.price))
                map.set(info.price, []);
            map.get(info.price).push({name, ...info});
        }
        return map;
    }

    _recentlyBought(barName, now, withinMs) {
        const lastBuyTime = this.lastBarBuyTime.get(barName);
        if (!lastBuyTime) return false;

        return (now - lastBuyTime <= withinMs);
    }

    _recentlyGain(barName, now, withinMs) {
        const lastGainTime = this.lastBarGainTime.get(barName);
        if (!lastGainTime) return false;

        return (now - lastGainTime <= withinMs);
    }

    parse(datetime, chatLine) {
        const log =
            this._parseBarLog(datetime, chatLine) ||
            this._parseSlotLog(chatLine) ||
            this._parseChangerLog(chatLine) ||
            this._parsePtoPLog(chatLine) ||
            this._parseSlotHintLog(chatLine);

        if (log) {
            this.logs[this.it] = {datetime, chat : chatLine, ...log};
            this.it++;
            return true;
        }
        return false;
    }

    _parseBarLog(datetime, line) {
        const now = new Date(datetime);
        const barSlotStart = new Date("2025-04-05T00:00:00");
        const barSlotUpdate = new Date("2025-04-22T09:36:00");

        const pay = line.match(/^あなたは ◆ (.+) を (\d{1,3}(?:,\d{3})*)円 で購入しました$/);
        if (pay) {
            const name = pay[1];
            const amount = parseInt(pay[2].replace(/,/g, ""));

            const info = this.barInfo[name];
            const gainPrice = info?.gainPrice ?? null;

            // 直近購入時刻を記録
            this.lastBarBuyTime.set(name, new Date(datetime));

            if (gainPrice)
                this.lastBarMap.set(gainPrice, name);

            return {type : "Bar", name, amount, direction : "pay"};
        }

        const gain = line.match(/^あなたは (\d{1,3}(?:,\d{3})*)円 獲得しました$/);
        if (gain) {
            const amount = parseInt(gain[1].replace(/,/g, ""));
            let name = this.lastBarMap.get(amount) || null;

            // スライムウィスキー5分以内の購入なし => 店長特製ブルームーン
            if (name === "スライムウィスキー") {
                if (now >= barSlotStart && !this._recentlyBought("スライムウィスキー", now, 5 * 60 * 1000)) {
                    name = "店長特製ブルームーン";
                }
            }

            
            // 直近獲得時刻を記録
            this.lastBarGainTime.set(name, new Date(datetime));

            return {type : "Bar", name, amount, direction : "gain"};
        }

        // dan5またはBarSlot酒の売却額の現金チャージ
        const charge = line.match(/^\[Man10Bank\](\d{1,3}(?:,\d{3})*)円チャージしました！$/);
        if (charge) {
            const amount = parseInt(charge[1].replace(/,/g, ""));

            const isWithinBarSlot = 
                (amount === 50000 && now >= barSlotStart && now < barSlotUpdate) ||
                (amount === 100000 && now >= barSlotUpdate);

            if (isWithinBarSlot) {
                console.log("OK1");
                const barNames = ["店長特製コンクラーヴェ", "店長特製ブルームーン"];
                const candidates = [];

                for (const name of barNames) {
                    if (this._recentlyGain(name, now, 5 * 60 * 1000)) {
                        console.log("candidates:", name);
                        candidates.push(name);
                    }
                }

                if (candidates.length > 0) {
                    // どちらもある場合は直近の獲得を優先
                    const recentName = candidates.reduce((a, b) => {
                        const aTime = this.lastBarGainTime.get(a);
                        const bTime = this.lastBarGainTime.get(b);
                        return Math.abs(now - aTime) < Math.abs(now - bTime) ? a : b;
                    });
                    console.log("recentName:", recentName);
                    return { type: "Bar", name: recentName, amount, direction : "gain" };
                }
            }

            if (!this.dangoPrices.includes(amount))
                return null;
            return {type : "Bar", name : "花よりdan5", amount, direction : "gain"};
        }

        // ハズレログ
        if (line === "ハズレ!") {
            return {type : "Bar", direction : "lose"};
        }

        // dan5の当たりメッセージ
        switch (line) {
            case "§d§lまだまだ飲めそうな気がする":
                return {type : "Bar", name : "花よりdan5", amount : 100000, direction : "mes"};
            case "§c§l酔いを感じる...":
                return {type : "Bar", name : "花よりdan5", amount : 200000, direction : "mes"};
            case "§4§lまだ引き返せる...":
                return {type : "Bar", name : "花よりdan5", amount : 400000, direction : "mes"};
            case "§5§l後戻りはできない...":
                return {type : "Bar", name : "花よりdan5", amount : 800000, direction : "mes"};
        }

        return null;
    }

    _parseSlotLog(line) {
        const pay = line.match(/^(\d{1,3}(?:,\d{3})*)円支払いました$/);
        if (pay) {
            const amount = parseInt(pay[1].replace(/,/g, ""));
            this.lastSlotPrice = amount;
            this.lastSlotDirection = "pay";
            return {type : "Slot", price : amount, amount, direction : "pay"};
        }

        const gain = line.match(/^(\d{1,3}(?:,\d{3})*)円受け取りました$/);
        if (gain) {
            const amount = parseInt(gain[1].replace(/,/g, ""));
            if (this.lastSlotDirection !== "pay") {
                // 支払いログがない場合
                if (amount >= 350 && amount <= 400) {
                    // プレイコインスロット
                    this.lastSlotPrice = 0;
                    return {type : "Slot", price : this.lastSlotPrice, amount, direction : "gain"};
                } else if (amount === 1000000) {
                    // ミリオンチャンススロット
                    this.lastSlotPrice = 0;
                    return {type : "Slot", price : this.lastSlotPrice, amount, direction : "gain"};
                } 
            }

            this.lastSlotDirection = "gain";
            return {type : "Slot", price : this.lastSlotPrice, amount, direction : "gain"};
        }

        const lose = line.match(/^\[Man10Slot\]外れました$/);
        if (lose) 
            this.lastSlotDirection = "gain";
        return null;
    }

    _parseChangerLog(line) {
        const match = line.match(/^\[Gacha2\]X+([A-Za-z0-9]+\(\$\d{1,3}(?:,\d{3})*\))X+が当たりました。$/);
        if (match) {
            const rawText = match[1]; 

            const amountMatch = rawText.match(/\$(\d{1,3}(?:,\d{3})*)/);
            const amount = amountMatch ? parseInt(amountMatch[1].replace(/,/g, "")) : null;

            return {type: "Changer", amount, price: amount, direction: "gain", rawText};
        }
        return null;
    }

    _parsePtoPLog(line) {
        const pay = line.match(/^(\d+)\.0円支払いました$/);
        if (pay)
            return {type : "PtoP", amount : parseInt(pay[1]), direction : "pay"};

        const gain = line.match(/^(\d+)\.0円受取りました$/);
        if (gain)
            return {type : "PtoP", amount : parseInt(gain[1]), direction : "gain"};

        return null;
    }

    _parseSlotHintLog(line) {
        if (!this.lastSlotPrice)
            return null;

        const match = line.match(/^\[Man10Slot\]おめでとうございます！(.+?)です！$/);
        const matchedRole = match ? match[1] : null;
        if (!matchedRole)
            return null;

        // 1回転の金額が一致するスロットを抽出
        const matchedSlots = this.slotPriceMap.get(this.lastSlotPrice) || [];

        // スロットごとに一致する役名を検索
        for (const slot of matchedSlots) {
            if (slot.roles && slot.roles.includes(matchedRole)) {
                return {
                    type : "Slot",
                    direction : "hint",
                    candidatedName : slot.name,
                    role : matchedRole,
                    price : this.lastSlotPrice
                };
            }
        }

        return {
            type : "Slot",
            direction : "hint",
            candidatedName : null,
            role : matchedRole,
            price : this.lastSlotPrice
        };
    }

    setSlotNameAndClassifyLogId() {
        // タイプごとにログIDを分類
        const idByType = {
            Bar : [],
            Slot : [],
            Changer : [],
            PtoP : [],
            Unknown : [],
        };

        const timeThresholdMs = 3 * 60 * 1000; // スロットを離れたと判断する時間(ms)

        let prevTime = null;   // 直近のスロットを回した時刻
        let prevPrice = null; // 直近のスロットの1回転の金額
        let slotBuffer = [];    // 現在の区間のSlotログID
        let slotCounts = {};   // 役名が出現したスロット

        const guessSlotName = () => {
            // 金額に対応するスロットが1種類なら確定
            const matches = this.slotPriceMap.get(prevPrice) || [];
            if (matches.length === 1)
                return matches[0].name;

            // 最も役名が出現したスロットと推定
            let bestSlot = Object.entries(slotCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "不明";

            // 不明の場合、rolesに"undefined"または"other" を含むスロットがちょうど1つならそれに決定する
            if (bestSlot === "不明") {
                const fallbackSlots = matches.filter(slot =>
                    slot.roles?.some(role => role === "undefined" || role === "other")
                );

                if (fallbackSlots.length === 1)
                    return fallbackSlots[0].name;
            }

            return bestSlot;
        }

        const flushSlotBuffer = () => {
            if (slotBuffer.length === 0)
                return;
            const bestSlot = guessSlotName();

            // 現在の区間を追加
            idByType.Slot.push({ name : bestSlot, ids : slotBuffer});

            slotBuffer = [];
            slotCounts = {};
        };

        const sortedEntries = Object.entries(this.logs).sort(
            (a, b) => new Date(a[1].datetime) - new Date(b[1].datetime));

        for (const [id, items] of sortedEntries) {
            const {type, datetime, amount, direction, price} = items;

            if (type === "Slot") {
                const logTime = new Date(datetime);
                const tooLongGap = prevTime && (logTime - prevTime > timeThresholdMs);
                const amountChanged = prevPrice !== null && price !== prevPrice;

                if (slotBuffer.length > 0 && (tooLongGap || amountChanged)) {
                    flushSlotBuffer();
                }

                if (direction === "pay" || direction === "gain") {
                    if (price === 0 && direction === "gain") {
                        // 0円スロットは独立したスロット
                        flushSlotBuffer();

                        let slotName = "不明";
                        if (amount >= 350 && amount <= 400) {
                            slotName = "プレイコインスロット";
                        } else if (amount === 1000000) {
                            slotName = "ミリオンチャンススロット";
                        }
                        idByType.Slot.push({ name : slotName, ids : [id]});

                        prevTime = logTime;
                        prevPrice = 0;

                        continue;
                    }

                    prevTime = logTime;
                    prevPrice = price;
                    slotBuffer.push(id);
                } else if (direction === "hint") {
                    const name = items.candidatedName;
                    if (name) {
                        slotCounts[name] = (slotCounts[name] || 0) + 1;
                    }
                    slotBuffer.push(id);
                }
            } else {
                if (idByType[type]) {
                    idByType[type].push(id);
                } else {
                    idByType.Unknown.push(id);
                }
            }
        }

        flushSlotBuffer();

        return idByType;
    }
}
