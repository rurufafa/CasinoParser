使用しているログ<br>
・基本情報<br>
Setting user: (MCID)<br>
Connecting to (サーバーアドレス)<br>
[Warps] You were teleported to '(サーバー名)'.<br>
[Warps] テレポートされました '(サーバー名)'.<br><br>
・酒<br>
あなたは ◆ (酒の名前) を (購入金額)円 で購入しました<br>
あなたは (当選金額)円 獲得しました<br>
\[Man10Bank](チャージ金額)円チャージしました！<br>
§d§lまだまだ飲めそうな気がする,...<br>
ハズレ!<br><br>
・スロット<br>
(支払金額)円支払いました<br>
(受取金額)円受け取りました<br>
\[Man10Slot]おめでとうございます！(役の名前)です！<br>
\[Man10Slot]外れました<br><br>
・両替機<br>
[Gacha2]X...X...($(受取金額))X...Xが当たりました。<br><br>
・丁半など<br>
(支払金額).0円支払いました<br>
(受取金額).0円受取りました<br><br>
・現金チャージログの扱い<br>
カジノ滞在時に、<br>
10,20,40,80万円の現金チャージ → dan5の売却<br>
ただし、5,10万円のチャージ: 5分以内にBarSlot酒の当選記録がある → その酒の売却とする<br><br>
・スロット名の推定<br>
(1) スロットの分類方法<br>
まず、以下のルール (a), (b) に従ってログを、<br>
同じスロットを回していると思われる区間ごとに分割する：<br><br>
(a) 前回の支払い／受け取りログから一定時間が経過している<br><br>
(b) 前回と比較して、1回転の金額が変化している<br><br>
このように分割された各区間内でスロットを推定する<br>
その区間における1回転の金額に対応するスロットが1つだけ存在する場合は、即座にスロット名を特定できる<br>
その区間における1回転の金額に対応するスロットが複数存在する場合は、該当区間内のログから<br>
"[Man10Slot]おめでとうございます！〜です！"<br>
の形式に一致するログを探し、〜 に当てはまる「役名」を抽出する<br><br>
抽出された役名と、slotInfo.iniで設定されている「スロット情報の役名一覧」と照らし合わせて、<br>
回していたスロットを推定する<br>
その区間の1回転の金額に対応する複数のスロットと一致した場合は、一致回数が最も多いスロットを採用する<br>
該当スロットが特定できなかった場合は、「不明」として扱う<br><br>
(2) スロット情報の設定方法<br>
スロットごとの情報は、以下の形式で定義する：<br>
[1回転の金額]<br>
{スロット名} = {役名1};{役名2};...<br>
各スロットに対応する 役名 を = の右側に記述し、複数ある場合は ; で区切る<br>
例：<br>
Re:ばったくじ = ハズレ;小当たり;中当たり;当たり;大当たり<br>
分類が困難なスロットはother(回転回数が極端に少ないスロットやボス系スロットなど)<br>