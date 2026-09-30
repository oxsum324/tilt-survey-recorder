# 傾斜測量紀錄 V0.1.0

第一期桌上試填版。純前端 ES modules，無建置工具、無後端，案件與讀數只存在本機瀏覽器。

- [開啟測試工具](https://oxsum324.github.io/tilt-survey-recorder/?release=0.1.0)
- [第一期交付與待確認事項](docs/versions/v0.1.0.md)
- [規格檢視與後續精進](docs/review-and-next.md)

## 試填流程

1. 在「案件與表頭」填表頭，或按「載入範本合成示例」。示例會取代目前案件，頁內對話框可先匯出。
2. 在「立面參數」調整樓高、女兒牆、寬度、側立面長度。模式 C 須先設定兩點法或由左至右方位角。
3. 在「測點與讀數」新增測點組，選 A、B、C 作業方式。填妥後按「確認本組讀數」。
4. 在「成果與輸出」預覽每頁 2 組、每組 2 方向的 A4 成果表，預設附原始讀數表。
5. 使用「系統列印／另存 PDF」，選 A4、直向、100% 比例，關閉瀏覽器自行加入的頁首／頁尾。系統列印保留向量圖及可選取文字。
6. 離開現場前按「匯出案件檔」，確認 `.tiltsurvey` 已保存。此檔含原始讀數、各模式保留資料、更正原因與時間。

## 作業方式

| 方式 | 輸入 | 結果 |
|---|---|---|
| A 直接偏移量 | ΔX（cm）與方向、H（cm）；或上／下尺讀數 | 立面內、立面外各 1～2 回 |
| B HD／VD | TP、TB 的 HD、VD（m）與測站位置 | 一個測站一個方向；VD 可為負值 |
| C N／E／Z | 一組 TP／TB 座標（m），立面基準 | 同組資料同時得到兩方向；合成參考值只在原始表 |

方向皆以觀看者站在立面外、面向立面為準：立面內正向向右，立面外正向向後（朝建物內側）。儀器 X／Y 不自動轉成 N／E。

原始讀數以字串保存，十進位換算採有理數，座標相減後才投影，保留小於 1 mm 的資訊。表列 ΔX 與 H 最後四捨五入至整數 mm，顯示 0.1 cm；分母採表列 H ÷ ΔX 四捨五入。兩回取有號位移平均。V0.1.0 對 B／C 兩回 H 不同的情況先要求一致後才出成果，採用策略待確認。

## 保存與離線

IndexedDB 資料庫 `tilt-survey-v1`，project 與 media 分開保存。草稿自動保存；已確認讀數改動後須填更正原因，否則不產生成果預覽。切換模式保留原資料。可匯出完整案件檔並再匯入；匯入取代前可先匯出、直接取代、取消。案件檔是可編輯 JSON，不是防竄改或簽章文件。

第一次連線成功並顯示「離線資源已準備」後，可離線重新開啟。Service Worker 快取名稱 `tilt-survey-v0.1.0`，所有路徑皆相對於專案子目錄。新版本需關閉舊工具分頁後重開，避免一次工作途中混用程式版本。

資料不會上傳 GitHub，裝置與瀏覽器間不會同步；清除網站資料、無痕視窗或瀏覽器儲存空間被回收都可能移除本機案件。完整案件檔應另行保存。

## 本版範圍與停止點

依派工規格只完成第一期，待使用者以一個實際案例桌上試填確認版面與計算後進第二期。使用者本次要求 GitHub 測試，因此提前提供第一期測試網址；原始案件照片、範本 PDF、內部資料蒐集文件未納入 repo。

照片拍攝／標註／EXIF／照片頁是第二期；佈設圖、強光模式、常亮與直接下載影像式 PDF 是第三期。本版沒有上述介面。本工具記錄與計算，不作安全判定、補償估算或施工前後比較。

## 開發與驗證

```powershell
npm.cmd ci --ignore-scripts
npm.cmd test
npm.cmd run test:browser
npm.cmd start
```

瀏覽器測試使用 Playwright；Windows 用已安裝 Google Chrome，其他環境使用 Chromium。若需要，先安裝 `npx playwright install chromium`。本機預覽 `http://127.0.0.1:8789/`。應透過伺服器或正式網址開啟，不能雙擊 index.html。

測試只使用合成資料。截圖與實際 PDF 檢視紀錄在 `output/playwright/`（不提交）。GitHub Actions 先跑單元測試，將明列的程式檔複製到 Pages；不直接發布整個工作目錄。`node tests/live.mjs` 比對線上部署清冊與全部程式檔雜湊。

## 參考來源

- 架構與 IndexedDB／離線核心：[level-survey-recorder](https://github.com/oxsum324/level-survey-recorder/tree/78f2ae02646510290854e89ff1ba901776bce9f5)，實際 main HEAD `78f2ae02646510290854e89ff1ba901776bce9f5`（V0.6.3）。複製／改寫範圍見 store.js、sw.js 檔頭，複製後獨立演進。
- 後續照片圈註參考：[section-properties-calculator](https://github.com/oxsum324/section-properties-calculator/tree/2bd935b31e0421743a982c80c7f27fcc0e40d2bc)，實際 master HEAD `2bd935b31e0421743a982c80c7f27fcc0e40d2bc`。annotation.js 最後異動 `641e627d731122d7451aaf1b349e761928efcb6e`；第一期尚未複製圈註核心。
- Pages 發布設定依 [GitHub 官方工作流程文件](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。
