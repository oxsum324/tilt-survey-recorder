# CI 前置失敗證據

Windows checks 的第一步以 runner 內建 PowerShell 建立證據，不依賴 checkout、Node、Python
或已安裝套件。證據放在 `runner.temp/tilt-ci-<run_id>-<attempt>`，避免 checkout 清理工作目錄時刪除。

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

十個情境實際執行 workflow 內的 bootstrap／收尾 PowerShell 及同一個命令 wrapper：

- 成功且原生命令有 stderr，仍依 exit 0 成功。
- npm、Python、瀏覽器三個安裝位置以替代命令注入 exit 47；字型位置注入 PowerShell throw。
- 模擬 checkout、setup-node、setup-python 的 failure 狀態，完全沒有安裝輸出時仍產生附件。
- 執行檔不存在時，不能沿用前一個 exit 0。
- 重複初始化拒絕覆寫既有 bootstrap。

每個情境驗證原始失敗碼、後續步驟跳過、日誌／收據與 SHA，並實際封裝 ZIP 核對必要項目。
模擬清除工作目錄中的暫存檔，另確認 runner 暫存證據仍存在。
這十個情境另計，不加入原本 92、101 或八情境 80 組測試。

所有回歸輸出標為 `local-fault-injection`。模擬 setup action 的步驟狀態不等於本機執行了
GitHub action；本機 ZIP 也不等於 GitHub 已上傳 artifact。真實雲端執行與上傳仍待授權推送後驗證。
若 runner 遺失、硬性終止、磁碟不可寫或上傳服務故障，仍可能無法封存；不得把這些狀況列為通過。
