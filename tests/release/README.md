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

新增9組回歸：一組靜態發布反例，以及Chrome／Edge各四組：

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
