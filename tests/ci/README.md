# CI 前置失敗證據

Windows checks 的第一步以 runner 內建 PowerShell 建立證據，不依賴 checkout、Node、Python
或已安裝套件。證據放在 `runner.temp/tilt-ci-<run_id>-<attempt>`，避免 checkout 清理工作目錄時刪除。

`runner.temp` 僅用於 bootstrap、收尾、上傳三個步驟的 env；job env 不引用 runner context。
bootstrap 透過 `GITHUB_ENV` 傳遞路徑給後續命令；收尾與上傳各自宣告相同的 step env，
即使前段失敗或未完成匯出，仍有正確的證據路徑。十一情境另外核對 env 匯出內容與可用位置。

`run-command.ps1` 在解析執行檔前就建立日誌與 running 收據，保存命令、參數、提交、範圍、
時間、原始結束碼、錯誤與日誌 SHA。原生命令 stderr 也保存；stderr 本身不取代命令結束碼。
找不到執行檔、PowerShell 字型安裝例外及原生非零狀態均失敗，不以 `continue-on-error` 放行。
workflow 明確傳回 `$LASTEXITCODE`，後續測試仍依成功條件執行。

無論 checkout、setup-node、setup-python 或安裝命令成功與否，`always()` 收尾步驟都使用內建
PowerShell 寫入步驟 outcome／conclusion、提交、時間、bootstrap 是否存在及逐檔 SHA。
接著 `always()` 上傳 runner 暫存證據、既有 output／test-results 及可用建置清冊，保留 30 天。
setup actions 的內部輸出仍在 GitHub 步驟日誌；附件保存這些 actions 的狀態與執行識別，
不宣稱複製了 actions 內部全部 stdout，也不在收尾完成前把上傳標為成功。

## 本機回歸

```powershell
npm.cmd run test:ci-evidence -- local-01
```

需要 PowerShell 7 (`pwsh`) 與 Node；不需要先安裝 npm 套件、Python、瀏覽器或字型。
可用 `TILT_CI_POWERSHELL` 指定 pwsh，`TILT_CI_REGRESSION_OUTPUT_ROOT` 指定新的證據父目錄。
輸出預設 `output/ci-evidence-regressions/<run>/`，既有名稱不覆寫。

十一個情境實際執行 workflow 內的 bootstrap／收尾 PowerShell 及同一個命令 wrapper：

- 成功且原生命令有 stderr，仍依 exit 0 成功。
- npm、Python、瀏覽器三個安裝位置以替代命令注入 exit 47；字型位置注入 PowerShell throw。
- 模擬 checkout、setup-node、setup-python 的 failure 狀態，完全沒有安裝輸出時仍產生附件。
- 執行檔不存在時，不能沿用前一個 exit 0。
- PATH 含兩個同名執行檔時，依既定順序只選第一個，不把多個路徑合成無效命令。
- 重複初始化拒絕覆寫既有 bootstrap。

每個情境驗證原始失敗碼、後續步驟跳過、日誌／收據與 SHA，並實際封裝 ZIP 核對必要項目。
模擬清除工作目錄中的暫存檔，另確認 runner 暫存證據仍存在。
這十一個情境另計，不加入原本 92、101 或八情境 80 組測試。

所有回歸輸出標為 `local-fault-injection`。模擬 setup action 的步驟狀態不等於本機執行了
GitHub action；本機 ZIP 也不等於 GitHub 已上傳 artifact。真實雲端執行與上傳仍待授權推送後驗證。
若 runner 遺失、硬性終止、磁碟不可寫或上傳服務故障，仍可能無法封存；不得把這些狀況列為通過。

## 工作流程語意驗證

```powershell
pwsh -NoProfile -File tests/ci/install-actionlint.ps1
npm.cmd run test:workflow -- local-01
```

以固定 actionlint 1.7.12 驗證 `.github/workflows/` 全部工作流程；工具來源、版本、下載 ZIP
與執行檔 SHA 固定在 `actionlint-version.json`。工具下載到忽略提交的 `output/tools/`，不加入產品。
CI 在 checkout 後保存工具安裝收據，Node setup 後即執行語意驗證，失敗不放行後續測試／發布。

目前四項語意回歸：完整 Pages workflow、允許 step env 引用 runner 的正例、禁止 job env
引用 runner 的反例、缺少 needs job 的反例。反例必須由真正 actionlint 以 exit 1 拒絕，
正例及完整工作流程必須 exit 0 且無診斷。這組另計，不變更十一情境或 92／101／80 的數量。

不使用 ignore 規則。只關閉額外外掛 shellcheck／pyflakes；工作流程結構、context／型別、
action 輸入與依賴圖的內建檢查均保留。它是本機靜態驗證，不代表 GitHub 伺服器或雲端 runner 已執行。
輸出預設 `output/workflow-semantics/<run>/`；可用 `TILT_WORKFLOW_EVIDENCE_ROOT` 指定父目錄，
舊 run 不覆寫，保存原始診斷、輸入 SHA、工具 SHA 與結果。

依據：[GitHub context 可用位置](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#context-availability)、
[actionlint 固定版本](https://github.com/rhysd/actionlint/releases/tag/v1.7.12)。

## 瀏覽器失敗當下診斷

`review-followups-browser.mjs` 的八情境在導覽前開始事件觀測與 Playwright trace。
任何導覽、等待或既有斷言失敗，都在關閉 context 前保存原例外、URL／DOM 狀態、HTML、
全頁 PNG、HTTP 回應、console、pageerror、requestfailed 及 trace ZIP，附逐檔 SHA。
不重試、不修改原 30000 ms 等待或既有斷言；失敗仍拋回同一個原始例外。
個別診斷寫入失敗明列 captureErrors，不能把「有收據」當成所有附件皆完整；儲存錯誤不取代原失敗。
成功情境只保存結果與事件收據，trace 丟棄；新 run 名稱避免覆寫舊證據。

```powershell
npm.cmd run test:browser-evidence
```

新增五項回歸另計：真實 locator 逾時／畫面與四類事件、截圖寫入失敗、頁面先關閉、成功、
拒絕覆寫既有失敗。Windows 每項依序使用 Chrome／Edge，共十次驗證；前三項共六個子程序必須 exit 1，測試才通過；500 ms 只用在合成反例，
不套用到原 101 項測試。CI 在瀏覽器與字型安裝後執行，失敗阻擋後續命令。
預設輸出 `output/playwright/timeout-regressions/`；`TILT_BROWSER_REGRESSION_ROOT` 可指定全新目錄。
正式八情境診斷預設 `output/playwright/failure-evidence/<unique-run>/`；
`TILT_BROWSER_FAILURE_ROOT` 可指定全新父目錄。兩者均納入現有 CI output 附件路徑。

這次只套用於曾發生首頁等待逾時的 review-followups 八情境，不宣稱其他八支腳本已有同等保存。
trace 記錄瀏覽器操作與網路，不記錄 Node assert 的判定；原例外與命令日誌另外保存。
本機回歸不代表雲端 CI、GitHub 上傳或第一次歷史逾時根因已驗證。
runner 硬性終止或磁碟不可寫仍可能無法完整取證；頁面無回應的等待現已設獨立期限。
依據：[Playwright tracing](https://playwright.dev/docs/api/class-tracing)。

### 取證期限與首份收據隔離

原五類回歸及全部舊斷言保留，另加首份 failure.json 寫入失敗、真實無回應 renderer、
遲到回應不可發布、清理不回應、總預算耗盡五類，共十類。前七類各跑 Chrome／Edge（十四次），
後三類是明列為 unit simulation 的期限／例外身分測試，不列真實瀏覽器附件。
五種失敗模式共十個子程序均須 exit 1、未被 watchdog 強殺、且拋回同一個原始 Error 物件。

固定預設每項取證最多 2000 ms、整體取證預算 12000 ms、清理最多 2000 ms。
此預算只作用於診斷／清理，不變更原產品測試的 30000 ms 等待或 4000 ms 弱訊號門檻。
DOM、HTML、PNG、trace 各自開始嘗試並平行取證；超時明列 captureErrors／artifactAttempts。
超時後以有期限的 context 清理終止尚未完成的頁面操作；呼叫端的 context／browser 清理
也有獨立期限，失敗只留診斷，不取代原測試錯誤。
若沒有先前測試錯誤，清理失敗仍向外拋出並使測試失敗，不把清理失敗悄悄改成通過。

failure.json／events.json／result.json 各自隔離寫入；首份 failure.json 失敗仍嘗試其餘附件，
由 result.json 保存原錯誤與寫入失敗。先寫唯一 .pending 暫存檔，完成且未超時才發布正式檔名；
遲到的 DOM／HTML／PNG 回應不再有發布續程。trace 使用唯一 .pending 路徑，只有期限內完成
才發布 trace.zip；未完成暫存檔留作診斷、不列有效附件 SHA，外層封存待子程序退出後再雜湊全部檔案。
預算用盡時不保證所有附件可完成；有收據不能當成附件全數完整。核心檔案系統無回應、OS 硬性終止
仍不在 Node 計時器可保證的範圍。子程序另有 30000 ms watchdog；觸發強殺就是回歸失敗，不能列通過。
總預算用盡而無法更新最終 metadata 時，保留最初 failed 收據，並把完整 failed fallback record
寫到 stderr，隨命令日誌封存；不能把早期 running 的 result.json 當成成功。
真實 renderer 回歸先取得原 locator TimeoutError，再使 renderer 忙迴圈無回應，測的是失敗取證分支。
暫存檔使用不以句點開頭的 pending-...pending 名稱，避免 upload-artifact v4 預設排除隱藏檔；
回歸核對暫存檔確實存在、不是隱藏檔名，且不混入有效附件 SHA 清冊。雲端實際上傳仍待執行。
