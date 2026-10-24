# 桌機補測與證據

這組補測只使用合成案件及本機 `_site`，不表示手機、真實案件匯入或線上發布已驗收。

## 執行

需要 Node.js 22、已安裝的 Google Chrome 與 Microsoft Edge，以及 Python 3.12 以上。
兩個瀏覽器都必須存在；不得因缺少其中一個而略過矩陣。

```powershell
npm.cmd ci --ignore-scripts
python -m pip install -r tests/desktop/requirements.txt
npx.cmd playwright install chrome msedge
npm.cmd test
npm.cmd run test:browser
node build-site.mjs
npm.cmd run test:desktop -- local-01
```

先提交並保持工作樹乾淨，再建置、測試。資料測試目前 92 項；既有 `test:browser` 維持
9 支、101 組 PASS（含 32 項工程回歸）。`test:desktop` 是另外一組，不重複加算到 101。
每次使用新名稱；既有執行目錄存在時直接失敗，避免覆寫歷史。

預設輸出 `output/desktop/<run>/`（忽略提交）。可用 `TILT_DESKTOP_OUTPUT_ROOT` 指定另一個
證據父目錄；用 `TILT_TEST_PYTHON` 指定 Python 可執行檔。四個子命令依序執行、遇錯停止；
保留時間、結束碼、實際提交、執行前後來源 SHA、原始診斷、數值、PDF 每頁影像與證據 SHA。
本機伺服器只綁定 127.0.0.1，命令結束後關閉。

## 三項補測與固定斷言

- PDF：四格 T／TP／TB 標頭逐行精確比較，並保留讀數、H、比率、方向、原始表 mm／除法、
  精確三頁 A4 與頁面指紋全部斷言。16 個標籤反例使用當次矩陣產生的 PDF，無外部歷史檔依賴。
- 畫面：逐點精確比對固定預期值；即時結果與成果表使用 `isVisible` 及 `checkVisibility`
  （含透明與祖先狀態）。兩瀏覽器各四種隱藏反例，共八次，全部必須拒絕。
- 故障：HTTP 500、主控台錯誤、執行例外、連線失敗是 **4 類 8 次**（每瀏覽器各四類），
  均須被對應斷言拒絕。另八個離線判別反例也必須拒絕。

主矩陣為 Chrome／Edge × 1280×720／1600×900 × 一般／強光，八情境各十組檢查，共 80。
故障反例與可見性／PDF 反例獨立記錄，不算進 80 組。
正式情境 HTTP／主控台／執行例外與非預期網路失敗必須為零；每情境只容許一筆精確匹配的
預期離線 worker 連網失敗，且必須有同網址唯一 HTTP 200 快取回應及實際讀數。
結果列增高後 Enter、Tab 與實際遮擋後原生 Tab，保留焦點、中心命中、上方 8 px 及視窗下界。

## CI

`.github/workflows/pages.yml` 在分支推送、對 main 的 PR 及手動執行時先跑 Windows checks。
安裝兩瀏覽器及固定 PyMuPDF，依序執行上述三組測試。任何安裝前先在 runner 暫存區建立證據，
前置命令保存日誌／原始結束碼；失敗也彙整步驟狀態並上傳暫存證據、`output/`、`test-results/`
與可用建置清冊，保留 30 天。前置失敗的十一情境回歸與限制見 [../ci/README.md](../ci/README.md)。
需要長期稽核時仍應下載封存。
只有 main 且 checks 通過後，才執行既有公開建置及 Pages 部署；PR／其他分支只跑檢查。

CI 中文字型由 `install-ci-font.ps1` 安裝至拋棄式 Windows worker，固定上游提交與 SHA-256；
不加入產品、不更動本機字型，也不下載未核對的替代字型。
來源：[Noto CJK Sans 固定提交](https://github.com/notofonts/noto-cjk/tree/523d033d6cb47f4a80c58a35753646f5c3608a78/Sans)，
授權：[OFL](https://github.com/notofonts/noto-cjk/blob/523d033d6cb47f4a80c58a35753646f5c3608a78/Sans/LICENSE)。
不同瀏覽器／字型環境可能揭露新失敗；應保留失敗證據，不改低門檻。
