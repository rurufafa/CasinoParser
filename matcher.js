export default class LogMatcher {
    _filterLine(line) {
        // 高速化されたフィルタ
        const msg = line.slice(33);
        if (!/[円飲酔引後!！外参$]/.test(msg))
            return msg.includes("Setting") || msg.includes("Connect") || msg.includes("Warps") || msg.includes("Gacha2");

        return true;
    }

    matchLog(dateStr, line) {
        // 無関係なログは除く
        if (!this._filterLine(line))
            return null;

        const match = line.match(/^\[(.*?)\] \[(.*?)\]: (.*)/);
        if (!match)
            return null;

        const [_, time, logLevel, content] = match;
        // 不正な形式
        if (time.length !== 8 || logLevel !== "Render thread/INFO")
            return null;

        const datetime = `${dateStr}T${time}`;

        let log = this._matchStatusLog(content);
        if (log)
            return { datetime, chat : content, ...log };

        const chatMatch = content.match(/\[System\] \[CHAT\] (.+)/);
        if (!chatMatch)
            return null;
        const chatLine = chatMatch[1];

        log =
            this._matchBarLog(chatLine) ||
            this._matchSlotLog(chatLine) ||
            this._matchChangerLog(chatLine) ||
            this._matchPtoPLog(chatLine);
        
        if (log) {
            this.casinoCount = (this.casinoCount || 0) + 1;
            return { datetime, chat : chatLine, ...log };
        }

        return null;
    }

    _matchStatusLog(line) {
        const userMatch = line.match(/^Setting user: (.+)/); // mcid
        if (userMatch) {
            // MCIDの条件
            if (/^[a-zA-Z0-9_]{3,16}$/.test(userMatch[1].trim())) {
                this.mcid = userMatch[1].trim();
                return {type : "status", direction : "mcid", name : this.mcid};
            }
        }

        const serverMatch = line.match(/^Connecting to (.+)/); // server
        if (serverMatch) 
            return {type : "status", direction : "server", name : serverMatch[1].trim()};

        const tpMatch = line.match(/^\[System\] \[CHAT\] \[Warps\] (?:You were teleported to|テレポートされました) '([^']+)'/); // man10location 
        if (tpMatch) 
            return {type : "status", direction : "location", name : tpMatch[1]};

        if (this.mcid) {
            const joined = new RegExp(`^\\[System\\] \\[CHAT\\] ${this.mcid}(（旧名.*?）)?がゲームに参加しました`);
            if (joined.test(line)) 
                return {type : "status", direction : "location", name : "login"};
        }

        return null;
    }

    _matchBarLog(line) {
        // 購入ログ
        const pay = line.match(/^あなたは ◆ (.+) を (\d{1,3}(?:,\d{3})*)円 で購入しました$/);
        if (pay) {
            const name = pay[1];
            const amount = parseInt(pay[2].replace(/,/g, ""));
            if (!(Number.isInteger(amount) && amount >= 1 && amount <= 200000))
                return null;

            return {type : "bar", direction : "pay", name, amount};
        }

        // 当選ログ
        const gain = line.match(/^あなたは (\d{1,3}(?:,\d{3})*)円 獲得しました$/);
        if (gain) {
            const amount = parseInt(gain[1].replace(/,/g, ""));
            if (!(Number.isInteger(amount) && amount >= 1 && amount <= 10000000))
                return null;

            return {type : "bar", direction : "gain", amount};
        }

        // チャージログ
        const charge = line.match(/^\[Man10Bank\](\d{1,3}(?:,\d{3})*)円チャージしました！$/);
        if (charge) {
            const amount = parseInt(charge[1].replace(/,/g, ""));
            if (!(Number.isInteger(amount) && (amount === 50000 || amount % 100000 === 0)))
                return null;

            return {type : "bar", direction : "charge", amount};
        }

        // ハズレログ
        if (line === "ハズレ!") 
            return {type : "bar", direction : "lose"};

        // dan5の当選メッセージログ
        switch (line) {
            case "§d§lまだまだ飲めそうな気がする":
                return { type : "bar", direction : "mes", amount : 100000 };
            case "§c§l酔いを感じる...":
                return { type : "bar", direction : "mes", amount : 200000 };
            case "§4§lまだ引き返せる...":
                return { type : "bar", direction : "mes", amount : 400000 };
            case "§5§l後戻りはできない...":
                return { type : "bar", direction : "mes", amount : 800000 };
        }
        return null;
    }

    _matchSlotLog(line) {
        // 支払いログ
        const pay = line.match(/^(\d{1,3}(?:,\d{3})*)円支払いました$/);
        if (pay) {
            const amount = parseInt(pay[1].replace(/,/g, ""));
            if (!(Number.isInteger(amount) && amount >= 1 && amount <= 1000000))
                return null;

            return { type : "slot", direction : "pay", amount };
        }

        // 受け取りログ
        const gain = line.match(/^(\d{1,3}(?:,\d{3})*)円受け取りました$/);
        if (gain) {
            const amount = parseInt(gain[1].replace(/,/g, ""));
            if (!(Number.isInteger(amount) && amount >= 1 && amount <= 50000000))
                return null;

            return { type : "slot", direction : "gain", amount };
        }

        // 役ログ
        const roleMatch = line.match(/^\[Man10Slot\]おめでとうございます！(.+?)です！$/);
        if (roleMatch && roleMatch[1]) 
            return { type : "slot", direction : "role", role : roleMatch[1] };

        // ハズレログ
        if (line === "[Man10Slot]外れました") 
            return { type : "slot", direction : "lose" };

        return null;
    }

    _matchChangerLog(line) {
        // 当選ログ
        const match = line.match(/^\[Gacha2\]X+([A-Za-z0-9]+\(\$\d{1,3}(?:,\d{3})*\))X+が当たりました。$/);
        if (match) {
            const rawText = match[1]; 
            const amountMatch = rawText.match(/\$(\d{1,3}(?:,\d{3})*)/);
            const amount = amountMatch ? parseInt(amountMatch[1].replace(/,/g, "")) : null;
            if (!(Number.isInteger(amount) && amount >= 10 && amount <= 1000000))
                return null;

            return { type: "changer", direction: "gain", name : rawText, amount };
        }
        return null;
    }

    _matchPtoPLog(line) {
        // 支払いログ
        const pay = line.match(/^(\d+)\.0円支払いました$/);
        if (pay) {
            const amount = parseInt(pay[1]);
            if (!(Number.isInteger(amount) && amount >= 1 && amount <= 100000000))
                return null;

            return {type : "ptop", direction : "pay", amount};
        }

        // 受け取りログ
        const gain = line.match(/^(\d+)\.0円受取りました$/);
        if (gain) {
            const amount = parseInt(gain[1]);
            if (!(Number.isInteger(amount) && amount >= 1 && amount <= 100000000))
                return null;

            return {type : "ptop", direction : "gain", amount};
        }

        return null;
    }
}