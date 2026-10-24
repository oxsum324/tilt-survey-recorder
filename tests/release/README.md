# 同版離線殼升級與發布驗證

`npm run test:release` 在本機建置完成後執行；CI 在 `site_build` 後、桌機矩陣前以獨立命令執行。
它不取代原4／11／92／101／8情境80項或原14類取證回歸。

`checks/fixtures/upgrade-v0.4.2` 固定為原發布提交
`4c32e09c8d2960dd062906da035c82d5e8a61172` 的27份公開runtime，逐檔驗SHA及長度。
同一origin先供應舊版，再切換到本次 `_site`。不替新worker追加測試用註解。

快取識別末段為26份runtime（不含worker自己）的路徑與SHA集合之SHA-256前16位。
修改任何runtime後，必須同步更新sw.js內的CACHE；發布回歸同時拒絕未變worker、
重用舊快取、以及快取識別未對應本次runtime的三種反例。
顯示版本仍為V0.4.2，案件資料庫名稱與資料不變。

原9組回歸保留：一組靜態發布反例，以及Chrome／Edge各四組：

- 舊版內建合成案件加一張合成照片、一張底圖，升級後完整project、確認／更正欄位、
  媒體ID／原bytes SHA、指紋及離線照片／底圖皆保留；不以版本字樣判斷更新。
- 故意繼續供應舊worker，必須因實際app.js SHA仍舊而exit1，不能靠逾時或watchdog通過。
- 各16項基本功能，沿用v9的全部既有檢查；改為首次goto及載入內建示例前就附加監控與trace。
- 首次導覽注入console.error，必須在任何基本項目通過前exit1，保存原stderr、DOM／HTML／PNG／trace。

另有3項程序收據回歸：缺少執行檔、原生斷言失敗、原生exit0但JSON為failed。
`runCaptured` 先建立running收據與stdout／stderr檔，保留rawExitCode；語意失敗映射為exit1。
正式子程序直接拋回原例外並非回傳failed後正常退出；所有預期失敗均另計。

輸出預設 `output/playwright/release-regressions/`，或`TILT_RELEASE_OUTPUT_ROOT`指定的新父目錄；
每次使用唯一子目錄，不覆寫失敗。所有附件由既有CI output路徑上傳。
內建合成PNG與記憶體圖片輸入不等於使用者實際匯入檔驗收，尺寸模擬不等於手機實機，
系統列印PDF不等於影像式PDF逐值驗收。外層命令收據才代表本機或GitHub Actions來源。

## SVG底圖顯示補強

原HTML img檢查保留，另由共用 `svg-map.mjs` 要求恰有一個SVG image、非空href、
原圖成功解碼、尺寸／SHA符合案件媒體、畫面可見且未被遮擋。
實際SVG href與保留原檔解碼後全部64,000像素逐色核對，最大色差不得超過4。
保存實際SVG截圖，從截圖三個位置取RGBA，逐色差不得超過4，與原圖同位置像素核對。
三個位置各有紅、綠、藍色特徵，必須符合指定RGBA；整圖解碼比較及原色差界限4保留。
這仍是合成底圖的特徵點檢查，不是一般圖片或整張畫面的視覺辨識替代品。

另外加入Chrome／Edge各兩組：移除SVG image、破損PNG；必須各以指定斷言／解碼錯誤
原生exit1，不能使用逾時或watchdog。失敗當下四附件及stderr保存，案件、媒體與離線
快照仍須相同。發布回歸現為原9＋新增4＝13組；原3項程序回歸不變。

`npm run test:live` 執行版控中的線上取證：先記錄遠端main SHA並驗證實際Pages
manifest／27檔，再於隔離持久設定檔用固定舊fixture建立舊worker與案件。初始舊fixture
有明列的response routing；種子瀏覽器關閉後重開同一設定檔，驗證階段沒有route handler。
先離線重開舊案件，另保存並嚴格核對一筆預期worker失敗；恢復連線後從真實Pages更新。
升級後再次離線重開，另外的完整診斷區間仍必須精確一筆worker失敗。
兩段原始事件均保留並分別嚴格核對，不接受零筆，也不以任意排除取代斷言。
每個瀏覽器各跑正常升級、16項基本功能、移除圖片、破損圖片，共8組，另計32項基本檢查。
這不是自然累積的使用者設定檔，也不部署候選分支；guard記候選測試來源，結果另記
實際線上main提交。兩者不必相同，不把候選程式誤稱已上線。

CI於分支／PR增加獨立live_release取證步驟；main的部署前CI跳過此步驟，避免在
Pages尚未部署新main時要求它已上線。既有checks／build／deploy門檻維持不變。

## 成功結束的trace與局部遮蔽回歸

guard只啟動一次trace export，先寫非隱藏`.pending`檔。成功結束的原兩秒期限不變；
逾時仍原生失敗，失敗取證在原artifact／總期限內等待同一個export promise，不能再次stop。
只有完整成功後才刪除暫存trace。若export永不完成或失敗，其他附件仍獨立嘗試保存，
明列trace缺件，不以pending或重跑冒稱完整；超過失敗取證期限的完成不會改寫正式附件。

`test:trace-completion`在本機及CI獨立執行7項新增回歸；兩項真實瀏覽器注入模式各跑
Chrome／Edge，完成動作後在native export前／後延遲2250ms，要求原期限失敗、stop一次、
四附件完整及原錯誤／stderr不變。其餘模擬明列為unit simulation，不冒稱真實trace。
原14類回歸及原成功案例不留failure trace的斷言均保留。

Chrome／Edge在staged與live各加局部遮蔽反例：只覆蓋第一色塊，保留完整href、
64,000解碼像素及中心命中，必須由原實際截圖像素斷言失敗，另外兩色不變。
原13組staged及8組live保留，新增後為15組staged／10組live，各自的基本檢查仍32項。
移除、破損反例的原指定錯誤與非零退出斷言保留。

子收據的`scope`及`execution`記實際本機／GitHub環境、run、attempt、job與工作流程SHA；
合成／staged／live與靜態驗證範圍另列，避免將雲端執行誤標成本機。

## 匯出診斷、離線傳輸邊界與設定檔清理

trace另記停止請求、API進入／完成／拒絕、失敗取證等待、pending存在及大小，並記錄
頁面關閉／瀏覽器連線狀態。`trace-export.json`在原取證期限內獨立保存；Playwright內部
壓縮與下載階段仍不透明，不將pending存在誤稱為有效trace，不增加任何原期限。

live持久設定檔使用本機CONNECT傳輸閘門：TLS仍由瀏覽器直接驗證真實Pages，連線時
只轉送原始bytes；離線時先封鎖通道並關閉既有連線，再進行原瀏覽器離線驗證。
驗證session仍無Playwright route handler，所有原HTTP／console／requestfailed及精確一筆
離線失敗斷言保留。這避免瀏覽器自己的worker更新檢查繞過頁面離線模擬，不能稱作
作業系統或手機實際斷網。`worker-lifecycle.jsonl`從首次goto前記CDP註冊／版本／錯誤、
頁面controller與installing狀態、worker腳本SHA及phase；transport事件另存。

`test:reliability`於本機與CI獨立跑13項，原14類與7項完整保留。兩個真實瀏覽器
失敗路徑trace延遲子程序必須保留原錯誤、其他三附件及明列缺件，不能冒稱完整trace。
Chrome／Edge另以合成localhost舊殼、明確CDP更新及受控install邊界，重現頁面離線時
取得新worker、其27筆實際安裝fetch失敗，加上原導覽共28筆；必須由原嚴格斷言拒絕。
這證明可產生該現象的機制，不證明歷史雲端的特定排程，未將觀測不足寫成確定根因。

持久設定檔清理移除不必要的setOffline協定往返，傳輸、瀏覽器關閉及刪除共享原2000ms
期限，前段失敗仍嘗試後段。只允許系統temp下獨立命名的合成設定檔；清理失敗必須
原生exit1、保存stderr，已存在的產品錯誤不被取代。反例亦要求cleanup完成，EBUSY
不能成為有效圖片反例。逾時後回傳的收據保持不變；清理失敗的殘留路徑明列而不冒稱已刪除。

兩次首次雲端已實際拒絕context-close逾時，四附件與原遮蔽錯誤完整；後續針對本測試
獨立啟動的持久瀏覽器明確選用Browser.close，避開Context.close的先行協定處理。
一般context不自動關閉所屬browser。此路徑共用原2000ms預算，新增第13項回歸；
真實Chrome／Edge的關閉與設定檔刪除仍須逐次通過，不能靠這項模擬代替。

## 收尾與worker觀測器的寫入隔離

`test:evidence-io`在本機及CI另跑13項回歸，不替換原13項可靠性測試。涵蓋transport／
results寫入拒絕或無回應、worker初始化拒絕、同步throw／非同步reject／無回應、
實際觀測器回呼與response.body延續、晚到寫入及正常順序；7個原生失敗子程序必須
exit1、stderr保留原錯誤，實際合成profile仍刪除。單元I/O與EventEmitter注入不冒稱
真實磁碟故障或真實CDP故障；完整Chrome／Edge套件另行執行。

live先完成有界限清理，再保存transport／worker／results，任一寫入失敗不跳過其他
寫入或取代既有錯誤。每項仍限原2000ms，metadata共享原12000ms，清理仍限原2000ms。
worker回呼只排入非同步寫入佇列，錯誤保存於記憶體與stderr，不向外throw或留下未處理
拒絕；封存前排空並移除觀測listener，`worker-observer.json`記錄完整性。計時器提前喚醒時
以單調時鐘確認原絕對期限，新增可控制時鐘的反例，原等待至少2000ms與上界斷言不變。
失敗明列缺件，
最後收據也寫不出時以stderr完整fallback保留；晚到結果不回填已封存收據為成功。
