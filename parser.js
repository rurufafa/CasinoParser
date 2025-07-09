export default class LogParser {
    constructor(barInfo, slotInfo, logs) {
        this.barInfo = barInfo;
        this.slotInfo = slotInfo;
        this.logs = logs;

        this.mcid = null;
        this.server = null;
        this.location = null;
        this.isInCasino = null;

        this.dangoPrices = [100000, 200000, 400000, 800000];
        this.rolesByFreeSlot = this._getRolesByFreeSlot(slotInfo);
    }

    _getRolesByFreeSlot(slotInfo) {
        const rolesByFreeSlot = {};
        for (const [slotName, { price, roles }] of Object.entries(slotInfo)) {
            if (price === 0 && Array.isArray(roles) && roles.length > 0) {
                rolesByFreeSlot[slotName] = [...roles]; 
            }
        }
        return rolesByFreeSlot;
    }

    parseLog() {
        // 状態判定 & データタイプごとにIDを分類
        const idMap = {
            status : [],
            bar : [],
            slot : [],
            changer : [],
            ptop : []
        }
        const exitsId = [];
        for (const [id, log] of Object.entries(this.logs)) {
            if (log.type === "status") {
                if(this._updateStatus(log))
                    exitsId.push(id);
                idMap.status.push(id);
            } else if (this.isInCasino) {
                idMap[log.type].push(id);
            }
        }

        // セクションに分割
        const sectionMap = {
            status : {},
            bar : {},
            slot : {},
            changer : {},
            ptop : {}
        };

        for (const [type, ids] of Object.entries(idMap)) {
            ids.sort((a, b) => new Date(this.logs[a].datetime) - new Date(this.logs[b].datetime));

            const splitSections = (type === "slot")
                ? this._splitSlotSections(ids)
                : this._splitDefaultSections(ids, exitsId);

            splitSections.forEach((section, index) => {
                sectionMap[type][index] = section;

                // ログ側にセクションIDを記録
                section.forEach(id => {
                    this.logs[id].sectionId = index;
                });
            });
        }

        // 個別名の特定
        this._resolveBarName(sectionMap.bar);
        this._resolveSlotName(sectionMap.slot);

        return [this.logs, sectionMap];
    }

    _updateStatus(log) {
        const man10Address = "dan5.red, 25565";
        const casinoWorlds = ["casino", "bookmaker->casino", "casino->bookmaker", "exit_devil", "enter_devil"];

        const { direction, name } = log;
        if (direction === "mcid") {
            this.mcid = name;
        } else if (direction === "server") { 
            this.server = name;
        } else if (direction === "location") {
            this.location = name;
        }

        const wasInCasino = this.isInCasino;
        this.isInCasino = this.mcid && this.server === man10Address && casinoWorlds.includes(this.location);
        if (wasInCasino && !this.isInCasino) {
            return true;
        }
        return false;
    }

    _splitDefaultSections(ids, exitsId, timeThresholdMs = 20 * 60 * 1000) {
        const sections = [];
        let section = [];
        let prevTime = null;
        let exitIndex = 0;

        for (const id of ids) {
            const log = this.logs[id];
            const time = new Date(log.datetime).getTime();

            const timeDiff = prevTime !== null ? time - prevTime : 0;
            const timeExceeded = prevTime !== null && timeDiff > timeThresholdMs;
            let exitCasino = false;
            while (
                exitIndex < exitsId.length &&
                id > exitsId[exitIndex]
            ) {
                exitCasino = true;
                exitIndex++;
            }
            
            const shouldSplit = section.length > 0 && (timeExceeded || exitCasino);

            if (shouldSplit) {
                sections.push(section);
                section = [];
            }

            section.push(id);
            prevTime = time;
        }

        if (section.length > 0) sections.push(section);
        return sections;
    }

    _splitSlotSections(ids, timeThresholdMs = 2 * 60 * 1000) {
        const sections = [];
        let section = [];

        let prevTime = null;
        let prevPrice = null;
        let prevDirection = "lose";

        let inFreeSection = false;
        let currentFreeSourceSlot = null;

        for (const id of ids) {
            const log = this.logs[id];
            const time = new Date(log.datetime).getTime();
            const price = log.direction === "pay" ? log.amount : prevPrice;
            const role = log.role;
            const direction = log.direction;

            const timeDiff = prevTime !== null ? time - prevTime : 0;
            const timeExceeded = prevTime !== null && timeDiff > timeThresholdMs;
            const priceChanged = prevPrice !== null &&  price !== prevPrice;

            let matchedFreeSlot = null;
            if (role) {
                for (const [slotName, roles] of Object.entries(this.rolesByFreeSlot)) {
                    if (roles.includes(role)) {
                        matchedFreeSlot = slotName;
                        break;
                    }
                }
            }

            const isPay = direction === "pay";

            // セクション分割条件
            // 一定時間経過した、スロット価格が変化した、0円スロットが始まった、変わった、終わった
            const shouldSplit =
                section.length === 0 ? false :
                timeExceeded || priceChanged ||
                (prevDirection !== "pay" && matchedFreeSlot && !inFreeSection) ||
                (inFreeSection && matchedFreeSlot && matchedFreeSlot !== currentFreeSourceSlot) ||
                (inFreeSection && isPay); 

            if (shouldSplit) {
                sections.push(section);
                section = [];
                inFreeSection = false;
                currentFreeSourceSlot = null;
            }

            section.push(id);

            if (matchedFreeSlot) {
                inFreeSection = true;
                currentFreeSourceSlot = matchedFreeSlot;
            }

            prevTime = time;
            prevPrice = price;
            prevDirection = direction;
        }

        if (section.length > 0) 
            sections.push(section);
        return sections;
    }

    _resolveBarName(sections) {
        const barSlotStart = new Date("2025-04-05T00:00:00");
        const barSlotUpdate = new Date("2025-04-22T09:36:00");

        for (const section of Object.values(sections)) {
            const prevTimeMap = {
                pay : {},
                gain : {},
                charge : {},
                lose : null
            };

            const dan5Steps = {
                50000 : false,
                100000 : false,
                200000 : false,
                400000 : false,
                800000 : false
            }

            const lastGainMap = {};
            lastGainMap[200000] = "Triumph";
            lastGainMap[250000] = "ヒミツのお酒";
            lastGainMap[4000] = "店長特製コンクラーヴェ";
            lastGainMap[20000] = "店長特製ブルームーン"; 

            for (const id of section) {
                const log = this.logs[id];
                const { datetime, direction, amount, name } = log;
                const now = new Date(datetime);

                if (direction === "pay") {
                    if (!(name in this.barInfo)) 
                        continue;
                
                    prevTimeMap.pay[name] = now; 
                    if (name === "花よりdan5")
                        dan5Steps[50000] = true;

                    const gainPrice = this.barInfo[name]?.gainPrice ?? null;
                    if (gainPrice) 
                        lastGainMap[this.barInfo[name].gainPrice] = name;
                } else if (direction === "gain") {
                    // 区間内で当選金額に対応する最後に購入した酒を取得
                    let candidateName = lastGainMap[amount];
                    // 特別ルール
                    if (!candidateName && amount === 20000 && now >= barSlotStart) 
                        candidateName = "店長特製ブルームーン";

                    if (candidateName === "花よりdan5") {
                        // 前段階が存在しないならスキップ
                        const requiredSteps = Object.keys(dan5Steps).filter(a => a < amount);
                        const allPassed = requiredSteps.every(a => dan5Steps[a]);
                        if (!allPassed)
                            candidateName = null;
                    }

                    if (!candidateName)
                        continue;

                    log.name = candidateName;
                    prevTimeMap.gain[candidateName] = now;
                } else if (direction === "charge") {
                    const tDan5 = prevTimeMap.pay["花よりdan5"];
                    const tConclave = prevTimeMap.gain["店長特製コンクラーヴェ"];
                    const tBluemoon = prevTimeMap.gain["店長特製ブルームーン"];

                    const getLatest = (times) => {
                        const validEntries = Object.entries(times).filter(([_, time]) => time !== undefined && time !== null);
                        if (validEntries.length === 0) return null;
                        validEntries.sort((a, b) => b[1] - a[1]);
                        return validEntries[0][0];
                    };  

                    let candidateName = null;
                    if (amount === 50000 && now >= barSlotStart && now < barSlotUpdate) {
                        // barSlot酒のうち最近のもの
                        const times = { 
                            "店長特製コンクラーヴェ": tConclave,
                            "店長特製ブルームーン": tBluemoon 
                        };

                        candidateName = getLatest(times);
                    } else if (amount === 100000 && now >= barSlotUpdate) {
                        // dan5, barSlot酒のうち最近のもの
                        const times = { 
                            "花よりdan5": tDan5, 
                            "店長特製コンクラーヴェ": tConclave, 
                            "店長特製ブルームーン": tBluemoon 
                        };

                        candidateName = getLatest(times);
                    } else {
                        // それ以外はdan5かnull

                        // 前段階が存在しないならスキップ
                        const requiredSteps = Object.keys(dan5Steps).filter(a => a <= amount);
                        const allPassed = requiredSteps.every(a => dan5Steps[a]);

                        candidateName = this.dangoPrices.includes(amount) && tDan5 && allPassed? "花よりdan5" : null;
                    }   

                    if (!candidateName) 
                        continue;

                    log.name = candidateName;
                    
                    if (!prevTimeMap.charge[candidateName])
                        prevTimeMap.charge[candidateName] = {};
                    prevTimeMap.charge[candidateName][amount] = now;
                } else if (direction === "mes") {   
                    // 前段階が存在しないならスキップ
                    const requiredSteps = Object.keys(dan5Steps).filter(a => a < amount);
                    const allPassed = requiredSteps.every(a => dan5Steps[a]);
                    if (!allPassed) continue;

                    log.name = "花よりdan5";
                    dan5Steps[log.amount] = true;
                } else if (direction === "lose") {
                    prevTimeMap.lose = now;
                }
            }

            const usedNames = new Set();
            const noUsedBar = ["乾杯酒", "メチル", "黄金狂"];

            // 末尾から先頭へ逆走
            for (let i = section.length - 1; i >= 0; i--) {
                const id = section[i];
                const log = this.logs[id];
                const { direction, name } = log;

                // ハズレログが出たら購入ログの精査が不可能になるので終了
                if (direction === "lose") 
                    break;

                if (!name || !(name in this.barInfo)) 
                    continue;

                if (direction === "gain" || direction === "charge") {
                    usedNames.add(name); // その酒が使われたとみなす
                } else if (direction === "pay") {
                    if (!usedNames.has(name) && !noUsedBar.includes(name)) 
                        log.name = null; // 使用されなかった購入ログは除外
                }
            }
        }
    }

    _resolveSlotName(sections) {
        for (const section of Object.values(sections)) {
            const payPrices = new Set();
            const rolesInSection = [];
            
            // セクション内の支払額と役名を収集
            for (const id of section) {
                const log = this.logs[id];
                if (log.direction === "pay") {
                    payPrices.add(log.amount);
                } else if (log.direction === "role" && log.role) {
                    rolesInSection.push(log.role);
                }
            }

            if (payPrices.size === 0) {
                let isFreeSection = false;
                for (const freeRole of ["虹コイン揃い", "kミリオンチャレンジ成功k", "ハズレ"]) {
                    if (rolesInSection.includes(freeRole)) {
                        payPrices.add(0);
                        isFreeSection = true;
                        break;
                    }
                }
                if (!isFreeSection)
                    continue;
            }

            // 支払額が1種類以上ならば場合はエラー
            if (payPrices.size > 1) 
                continue;

            const [price] = payPrices;

            // 金額に対応するスロット候補を取得
            const candidates = Object.entries(this.slotInfo).filter(
                ([_, info]) => info.price === price
            );

            let bestName = null;

            if (candidates.length === 1) {
                // 金額に対応するスロットが1つだけ → それを使用
                bestName = candidates[0][0];
            } else {
                // 複数候補 → 役一致スコアで最良候補を選ぶ
                let bestScore = 0;
                for (const [name, info] of candidates) {
                    const validRoles = new Set(info.roles);
                    let matchCount = 0;
                    for (const role of rolesInSection) {
                        if (validRoles.has(role)) matchCount++;
                    }
                    if (matchCount > bestScore) {
                        bestScore = matchCount;
                        bestName = name;
                    }
                }
            }

            if (bestName === null) 
                bestName = "不明";

            // price, name を代入
            for (const id of section) {
                this.logs[id].price = price;
                this.logs[id].name = bestName;
            }
        }
    }
}