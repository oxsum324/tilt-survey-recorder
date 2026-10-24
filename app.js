import { verifyFingerprint } from "./integrity.js";
import {
  VERSION,
  createProject,
  createFacade,
  createPair,
  measurement,
  labels,
  isConfirmed,
  confirmObservation,
  sampleProject,
  modeFor,
} from "./model.js";
import { calculatePair } from "./calc.js";
import {
  normalizeProject,
  loadProject,
  saveProject,
  replaceProject,
  makeBackup,
  parseBackup,
} from "./store.js";
import { buildingParameters, escapeXml as esc } from "./sketch.js";
import { outputIssues, fullReport } from "./media-report.js";
import { createMediaUI } from "./media-ui.js";
import { setupDisplay } from "./display.js";
import { imagePdf } from "./pdf.js";
import { downloadBlob } from "./media.js";
let project,
  tab = "case",
  selectedPair,
  selectedFacade,
  includeRaw = true,
  includePhotos = true,
  includeMap = true,
  reportKind = "all",
  reportPromise = Promise.resolve(),
  reportGeneration = 0,
  saveTimer,
  saving = Promise.resolve(),
  failedSave = false,
  storageBlocked = false,
  reportStale = true;
let preparedShare = null,
  shareGeneration = 0,
  sharing = false;
let resultsExpanded = false;
const exportActionTimes = new Map(),
  exportActionKey = (id) => `tilt-survey-exported-at:${id}`;
const $ = (selector) => document.querySelector(selector),
  workspace = $("#workspace"),
  shareButton = $("#shareCaseButton"),
  desktopActions = $("#desktopCaseActions"),
  mobileLayout = matchMedia("(max-width:640px)");
const option = (value, text, current) =>
  `<option value="${value}"${value === current ? " selected" : ""}>${text}</option>`;
function input(
  label,
  path,
  value,
  { unit = "", signed = false, placeholder = "", type = "text", numeric = true, ariaLabel = "" } = {},
) {
  return `<label class="field"><span>${label}${unit ? ` <small>（${unit}）</small>` : ""}</span><div class="input-wrap"><input data-field="${path}" value="${esc(value)}" type="${type}" ${numeric ? 'inputmode="decimal" enterkeyhint="next"' : ""} ${placeholder ? `placeholder="${esc(placeholder)}"` : ""} autocomplete="off"${type === "text" ? ' maxlength="3000"' : ""}${ariaLabel ? ` aria-label="${esc(ariaLabel)}"` : ""}>${signed ? `<button class="sign-button" type="button" data-sign="${path}" aria-label="${label}切換正負號">±</button>` : ""}</div></label>`;
}
const select = (label, path, value, options) =>
  `<label class="field"><span>${label}</span><select data-field="${path}">${options.map(([v, t]) => option(v, t, value)).join("")}</select></label>`;
const check = (label, path, value) =>
  `<label class="check-field"><input type="checkbox" data-field="${path}"${value ? " checked" : ""}>${label}</label>`;
function get(path) {
  return path.split(".").reduce((obj, key) => obj?.[key], project);
}
function set(path, value) {
  const keys = path.split("."),
    last = keys.pop();
  keys.reduce((obj, key) => obj[key], project)[last] = value;
}
function notice(text, error = false) {
  $("#notice").hidden = false;
  $("#notice").textContent = text;
  $("#notice").className = error ? "notice error" : "notice";
}
function updateStatus() {
  if (project) updateCaseSummary();
  const unexported = project.updatedAt !== project.lastExportedAt;
  $("#saveStatus").textContent = failedSave
    ? "本機保存失敗，請立即匯出"
    : unexported
      ? "有未匯出的變更"
      : "本機已保存 · 已匯出";
  $("#saveStatus").className = failedSave
    ? "status-error"
    : unexported
      ? "status-pending"
      : "status-saved";
}
function queueSave() {
  clearTimeout(saveTimer);
  if (storageBlocked) return Promise.resolve();
  const snapshot = structuredClone(project);
  saving = saving
    .catch(() => {})
    .then(() => saveProject(snapshot))
    .then(() => {
      failedSave = false;
      if (snapshot.updatedAt === project.updatedAt)
        document.documentElement.dataset.saveState = "saved";
      updateStatus();
    })
    .catch((e) => {
      failedSave = true;
      updateStatus();
      notice(`本機保存未完成：${e.message}。目前畫面資料仍可匯出。`, true);
    });
  return saving;
}
function changed() {
  invalidateShare();
  document.documentElement.dataset.saveState = "pending";
  project.updatedAt = new Date(
    Math.max(Date.now(), Date.parse(project.updatedAt) + 1),
  ).toISOString();
  reportStale = true;
  updateStatus();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(queueSave, 200);
}
function dialog(title, text, buttons, { reason = false } = {}) {
  const d = $("#actionDialog");
  $("#dialogTitle").textContent = title;
  $("#dialogText").textContent = text;
  $("#reasonLabel").hidden = !reason;
  $("#dialogReason").value = "";
  $("#dialogButtons").innerHTML = buttons
    .map(
      ([value, label]) =>
        `<button value="${value}"${value === "cancel" ? "" : ' class="primary"'}>${label}</button>`,
    )
    .join("");
  d.returnValue = "";
  d.showModal();
  return new Promise((resolve) =>
    d.addEventListener(
      "close",
      () => resolve({ value: d.returnValue || "cancel", reason: $("#dialogReason").value }),
      { once: true },
    ),
  );
}
async function allowReplace(title) {
  const answer = await dialog(title, "目前案件會被取代。可先匯出完整案件檔再繼續。", [
    ["export", "先匯出再取代"],
    ["replace", "直接取代"],
    ["cancel", "取消"],
  ]);
  if (answer.value === "export") {
    try {
      await exportCase();
    } catch (e) {
      notice(e.message, true);
      return false;
    }
  }
  return answer.value === "export" || answer.value === "replace";
}
function heading(eyebrow, title, text) {
  const short =
    {
      案件設定: "案件與表頭",
      立面示意: "立面參數",
      現場讀數: "測點與讀數",
      成果與輸出: "成果與輸出",
    }[eyebrow] || title;
  return `<div class="section-heading"><p class="eyebrow">${eyebrow}</p><h2 aria-label="${esc(title)}"><span class="heading-full">${title}</span><span class="heading-short">${short}</span></h2><p>${text}</p><details class="page-help"><summary aria-label="${esc(short)}使用說明">說明</summary><p>${text}</p></details></div>`;
}
function mobileCaseActions() {
  return `<section class="card mobile-case-actions" aria-label="案件檔案操作"><h3>案件檔案與備份</h3><div class="button-row"><button data-action="export">匯出案件檔</button><button data-action="import">匯入案件檔</button><button data-action="verify-file">驗證案件檔指紋</button><span class="share-slot"></span></div><p class="hint">不同裝置不會同步；離開現場前請確認完整案件檔已保存。</p></section>`;
}
function updateCaseSummary() {
  const completed = project.pairs.reduce((n, p) => {
    const f = project.facades.find((f) => f.id === p.facadeId);
    if (!f || !isConfirmed(p, f)) return n;
    const r = calculatePair(p, f, project.settings);
    return n + ["inPlane", "outPlane"].filter((axis) => r[axis].status === "ok").length;
  }, 0);
  let exportedAt = exportActionTimes.get(project.id);
  try {
    exportedAt ||= localStorage.getItem(exportActionKey(project.id));
  } catch {}
  const known = exportedAt && Number.isFinite(Date.parse(exportedAt)),
    time = known
      ? new Date(exportedAt).toLocaleString("zh-TW", { hour12: false })
      : project.lastExportedAt
        ? "未記錄（案件已有匯出標記）"
        : "尚未匯出";
  $("#caseSummary").innerHTML =
    `<h3>案件摘要</h3><dl><dt>案件名稱</dt><dd>${esc(project.header.caseNumber || "未命名案件")}</dd><dt>測點組數</dt><dd>${project.pairs.length} 組</dd><dt>已完成方向數</dt><dd>${completed}／${project.pairs.length * 2}（已確認且可計算）</dd><dt>上次匯出時間（本機）</dt><dd><time id="lastExportActionTime"${known ? ` datetime="${esc(exportedAt)}"` : ""}>${esc(time)}</time></dd></dl>`;
}
function positionCaseActions() {
  desktopActions.append(shareButton);
  const slot = workspace.querySelector(".share-slot");
  if (mobileLayout.matches && slot) slot.append(shareButton);
}
function positionSelectors() {
  const heading = workspace.querySelector(".section-heading"),
    list = workspace.querySelector(".pair-list,.facade-list");
  if (!heading || !list) return;
  const previous = workspace.querySelector(".page-selector");
  if (!mobileLayout.matches) {
    if (previous) {
      heading.after(list);
      previous.remove();
    }
    return;
  }
  const summary = previous?.querySelector("summary") || document.createElement("summary"),
    current = [...list.querySelectorAll("button")].find(
      (b) =>
        (b.dataset.pair && b.dataset.pair === selectedPair) ||
        (b.dataset.facade && b.dataset.facade === selectedFacade),
    );
  summary.textContent = (current?.textContent || "選擇測點").replace(" ✓", "");
  summary.title = summary.textContent;
  summary.setAttribute("aria-label", `切換${summary.textContent}`);
  if (previous) return;
  const picker = document.createElement("details");
  picker.className = "page-selector";
  picker.append(summary, list);
  heading.append(picker);
}
function responsiveChrome() {
  $("#statusPanel").open = !mobileLayout.matches;
  const noticeBox = $("#notice");
  if (mobileLayout.matches) $("#mobileNoticeSlot").append(noticeBox);
  else $("#main").prepend(noticeBox);
  positionCaseActions();
  positionSelectors();
}
mobileLayout.addEventListener("change", responsiveChrome);
responsiveChrome();
function caseView() {
  const h = project.header;
  return (
    heading(
      "案件設定",
      "先留下這次量測的基本資料",
      "表頭皆可編輯；未填欄位會以「○○」呈現，並在輸出前提醒。",
    ) +
    `<section class="card"><h3>案件與成果表表頭</h3><div class="form-grid">${[
      ["orgName", "公會／機關名稱"],
      ["caseNumber", "鑑定案編號"],
      ["householdNo", "住戶編號"],
      ["address", "測量地址"],
      ["surveyDate", "測量日期"],
      ["surveyor", "測量人員"],
      ["instrument", "使用儀器（廠牌型號）"],
    ]
      .map(([k, t]) =>
        input(t, `header.${k}`, h[k], {
          numeric: false,
          placeholder: k === "surveyDate" ? "例：115年09月30日" : "",
        }),
      )
      .join("")}</div></section>
    <section class="card"><h3>新增測點的預設作業方式</h3><div class="mode-cards">${[
      ["A", "直接讀偏移量", "↕", "經緯儀、垂直儀或錘球，現場已讀得 ΔX"],
      ["B", "水平距與高差", "↗", "全站儀一個測站量一個方向，輸入 HD／VD"],
      ["C", "三維座標", "⊥", "同組 TP／TB 座標，同時分解兩個方向"],
    ]
      .map(
        ([m, t, icon, d]) =>
          `<button data-default-mode="${m}" class="mode-card${project.settings.defaultMode === m ? " selected" : ""}" aria-pressed="${project.settings.defaultMode === m}"><span class="mode-icon">${icon}</span><b>${m}｜${t}</b><span>${d}</span></button>`,
      )
      .join("")}</div></section>
    <section class="card"><h3>量測提示與編號 <span class="tag">可調整</span></h3><p>下列設定僅作讀數提示，不是規範判定值。</p><div class="form-grid">${input("兩測回較差提示值", "settings.toleranceMm", project.settings.toleranceMm, { unit: "mm" })}${input("小偏移提示值", "settings.minOffsetMm", project.settings.minOffsetMm, { unit: "mm" })}${input("短垂距提示值", "settings.minHeightCm", project.settings.minHeightCm, { unit: "cm" })}${select(
      "測線編號",
      "settings.labelStyle",
      project.settings.labelStyle,
      [
        ["prime", "T1／T1′（範本）"],
        ["TS", "T1／S1（自訂對應）"],
      ],
    )}</div>${check("方向加註絕對方位（須填立面朝向）", "settings.showCompass", project.settings.showCompass)}<p class="hint">T／S 在本工具僅為立面內、立面外的命名選項；與特定手冊之工地相對方向不自動對應。</p></section>
    <section class="card"><h3>開始試填</h3><div class="button-row"><button class="primary" data-action="tab-readings">前往測點與讀數 →</button><button data-action="sample">載入範本合成示例</button><button data-action="new">另建空白案件</button></div><p class="hint">示例僅含樣張數值，不含真實案件資料。</p></section>` +
    mobileCaseActions()
  );
}
function facadeView() {
  const index = project.facades.findIndex((f) => f.id === selectedFacade);
  const f = project.facades[index],
    prefix = `facades.${index}`;
  return (
    heading("立面示意", "用立面參數描述測線位置", "參數只供圖面示意；量測垂距 H 仍取自原始讀數。") +
    `<div class="button-row facade-list">${project.facades.map((f) => `<button data-facade="${f.id}" class="${f.id === selectedFacade ? "primary" : ""}">${esc(f.name)}</button>`).join("")}<button data-action="add-facade">＋新增立面</button></div>
    <section class="card"><h3>立面資料</h3><div class="form-grid">${input("立面名稱", `${prefix}.name`, f.name, { numeric: false })}${input("外法線朝向（北＝0，順時針）", `${prefix}.facingDeg`, f.facingDeg, { unit: "度", placeholder: "選填，0 至小於 360" })}${input("立面寬", `${prefix}.building.widthCm`, f.building.widthCm, { unit: "cm" })}${input("側立面繪製長度", `${prefix}.building.sideShownCm`, f.building.sideShownCm, { unit: "cm" })}${input("女兒牆高度", `${prefix}.building.parapetCm`, f.building.parapetCm, { unit: "cm" })}${select(
      "一樓開口形式",
      `${prefix}.building.groundFloorType`,
      f.building.groundFloorType,
      [
        ["shop", "店面"],
        ["house", "住宅"],
        ["blank", "不畫開口"],
      ],
    )}</div>${check("繪製開口示意", `${prefix}.building.showOpenings`, f.building.showOpenings)}<h4>各樓層樓高（由下而上）</h4><div class="floor-grid">${f.building.floorHeightsCm.map((h, i) => input(`${i + 1}F 樓高`, `${prefix}.building.floorHeightsCm.${i}`, h, { unit: "cm" })).join("")}</div><div class="button-row"><button data-action="add-floor">＋新增樓層</button><button data-action="remove-floor" ${f.building.floorHeightsCm.length === 1 ? "disabled" : ""}>移除頂層</button></div><p class="hint">預設樓高及寬度均可調整；TB 離地高度未量測時，圖面會明確註記。</p></section>
    <section class="card"><h3>模式 C 的立面基準</h3><p>兩點法由面向立面的左端 A 指向右端 B；方位角也是由左至右方向。</p>${select(
      "基準方式",
      `${prefix}.baseline.method`,
      f.baseline.method,
      [
        ["none", "尚未設定"],
        ["twoPoints", "兩點法（A 左、B 右）"],
        ["azimuth", "方位角法"],
      ],
    )}<div class="form-grid">${f.baseline.method === "twoPoints" ? ["A", "B"].map((pos) => ["N", "E"].map((key) => input(`${pos}（${pos === "A" ? "左端" : "右端"}）${key}（${key === "N" ? "北" : "東"}）`, `${prefix}.baseline.${pos}.${key}`, f.baseline[pos][key], { unit: "m", signed: true })).join("")).join("") : f.baseline.method === "azimuth" ? input("由左至右方位角 α", `${prefix}.baseline.azimuthDeg`, f.baseline.azimuthDeg, { unit: "度" }) : ""}</div><p class="hint">儀器 X／Y 軸與 N／E 的對應仍須依實際儀器確認。</p></section>`
  );
}
function resultView(pair) {
  const f = project.facades.find((f) => f.id === pair.facadeId),
    r = calculatePair(pair, f, project.settings),
    l = labels(pair, project.settings);
  return ["inPlane", "outPlane"]
    .map((axis) => {
      const v = r[axis];
      return `<div class="result-box"><p>${l[axis]}｜${axis === "inPlane" ? "立面內（左右）" : "立面外（前後）"}</p>${v.status === "ok" ? `<strong>${v.ratioText}</strong><b>${esc(v.directionText)}</b><div class="result-values">△X ${v.dxCm} cm　H ${v.hCm} cm</div>${v.differenceMm === null ? "" : `<small>兩測回較差 ${+v.differenceMm.toFixed(6)} mm</small>`}${v.warnings.map((w) => `<div class="result-warning">${esc(w)}</div>`).join("")}` : v.status === "skipped" ? `<strong class="no-result">未施測</strong><span>${esc(v.reason)}</span>` : `<strong class="no-result">待完成讀數</strong><span>${esc(v.error)}</span>`}</div>`;
    })
    .join("");
}
function liveResultsView(pair) {
  const f = project.facades.find((f) => f.id === pair.facadeId),
    r = calculatePair(pair, f, project.settings),
    l = labels(pair, project.settings);
  const summary = ["inPlane", "outPlane"]
    .map((axis) => {
      const v = r[axis],
        text =
          v.status === "ok"
            ? `${v.ratioText} ${v.directionText.replace("傾", "")}`
            : v.status === "skipped"
              ? "未施測"
              : "待完成";
      return `<span>${l[axis]} ${esc(text)}</span>`;
    })
    .join('<span class="result-separator">｜</span>');
  return `<div id="liveResultPanels" class="live-result-panels"${resultsExpanded ? ' data-expanded="true"' : ""}>${resultView(pair)}</div><button id="resultSummaryButton" class="result-summary-button" data-action="toggle-results" aria-expanded="${resultsExpanded}" aria-controls="liveResultPanels" aria-label="${resultsExpanded ? "收回" : "展開"}完整即時結果">${summary}</button>`;
}
function numericRound(round, prefix, keys) {
  return `<div class="coordinate-table">${["tp", "tb"].map((pos) => `<div class="coordinate-point"><h4>${pos === "tp" ? "TP 上測點" : "TB 下測點"}</h4><div class="coordinate-fields">${keys.map(([key, t]) => input(t, `${prefix}.${pos}.${key}`, round[pos][key], { unit: "m", signed: key !== "HD" })).join("")}</div></div>`).join("")}</div>`;
}
const disclosureKey = "tilt-survey-disclosures";
let disclosurePrefs = {};
try {
  const savedPrefs = JSON.parse(localStorage.getItem(disclosureKey) || "{}");
  if (savedPrefs && typeof savedPrefs === "object" && !Array.isArray(savedPrefs))
    disclosurePrefs = savedPrefs;
} catch {}
function disclosure(key, title, summary, body, force = false) {
  return `<details class="form-disclosure" data-ui-disclosure="${esc(key)}"${force || disclosurePrefs[key] === true ? " open" : ""}><summary><b>${title}</b><span title="${esc(summary)}">${esc(summary)}</span></summary><div class="disclosure-body">${body}</div></details>`;
}
function moreSummary(pair) {
  return [
    pair.corner === "custom"
      ? `自訂 ${pair.cornerOffsetCm || "—"} cm`
      : pair.corner === "left"
        ? "左角"
        : "右角",
    pair.tbHeightCm ? `TB ${pair.tbHeightCm} cm` : "",
    pair.note ? `備註：${pair.note}` : "",
  ]
    .filter(Boolean)
    .join(" ‧ ");
}
function directionForm(pair, index, axis) {
  const m = pair[axis],
    prefix = `pairs.${index}.${axis}`,
    l = labels(pair, project.settings),
    isIn = axis === "inPlane",
    mode = modeFor(pair, axis),
    rounds = mode === "C" ? pair.C.rounds : m[mode].rounds;
  const sources =
    mode === "A"
      ? rounds.map((r) => (r.source === "ruler" ? "上／下讀數差" : "直接輸入")).join("／")
      : mode === "B"
        ? { front: "正前方", rightSide: "右側延伸線", leftSide: "左側延伸線" }[m.B.station]
        : "共用座標";
  const summary = `${m.mode ? m.mode : "沿用 " + pair.mode} ‧ ${m.status === "skipped" ? "未施測" : "已施測"} ‧ ${rounds.length} 測回 ‧ ${sources}`;
  let settings = `<div class="form-grid">${select(
    "本方向作業方式",
    `${prefix}.mode`,
    m.mode ?? "",
    [
      ["", `沿用測點組（${pair.mode}）`],
      ["A", "A｜直接偏移量"],
      ["B", "B｜水平距與高差"],
      ["C", "C｜三維座標"],
    ],
  )}${select("施測狀態", `${prefix}.status`, m.status, [
    ["measured", "已施測／輸入中"],
    ["skipped", "未施測（須填原因）"],
  ])}`;
  if (mode !== "C")
    settings += `<label class="field"><span>測回數</span><select data-rounds="${index}|${axis}|${mode}">${[1, 2].map((n) => option(String(n), `${n} 測回`, String(rounds.length))).join("")}</select></label>`;
  if (mode === "B")
    settings += select(
      "測站位置",
      `${prefix}.B.station`,
      m.B.station,
      isIn
        ? [
            ["rightSide", "立面右側延伸線"],
            ["leftSide", "立面左側延伸線"],
          ]
        : [["front", "立面正前方"]],
    );
  if (mode === "A")
    settings += rounds
      .map((r, i) =>
        select(
          rounds.length > 1 ? `第 ${i + 1} 回偏移量來源` : "偏移量來源",
          `${prefix}.A.rounds.${i}.source`,
          r.source,
          [
            ["offset", "直接輸入偏移量"],
            ["ruler", "上讀數／下讀數之差"],
          ],
        ),
      )
      .join("");
  settings += "</div>";
  let body =
    m.status === "skipped"
      ? input("未施測原因", `${prefix}.skipReason`, m.skipReason, { numeric: false })
      : mode === "C"
        ? '<p class="hint">此分量使用上方本測點組共用座標。</p>'
        : (mode === "A" && !pair.sharedH
            ? input("垂距 H", `${prefix}.A.hCm`, m.A.hCm, { unit: "cm" })
            : "") +
          rounds
            .map(
              (r, i) =>
                `<div class="round-block"><h4>第 ${i + 1} 測回</h4>${
                  mode === "A"
                    ? `<div class="form-grid">${r.source === "ruler" ? input("上讀數", `${prefix}.A.rounds.${i}.upperCm`, r.upperCm, { unit: "cm", signed: true }) + input("下讀數", `${prefix}.A.rounds.${i}.lowerCm`, r.lowerCm, { unit: "cm", signed: true }) : input("偏移量 ΔX", `${prefix}.A.rounds.${i}.dxCm`, r.dxCm, { unit: "cm" })}${select(
                        "傾斜方向",
                        `${prefix}.A.rounds.${i}.dir`,
                        r.dir,
                        isIn
                          ? [
                              ["right", "向右傾"],
                              ["left", "向左傾"],
                            ]
                          : [
                              ["back", "向後傾"],
                              ["front", "向前傾"],
                            ],
                      )}</div>`
                    : numericRound(r, `${prefix}.B.rounds.${i}`, [
                        ["HD", "HD 水平距"],
                        ["VD", "VD 高差"],
                      ])
                }</div>`,
            )
            .join("");
  return `<section class="card measurement-card" data-reading-axis="${axis}"><h3>${l[axis]}｜${isIn ? "立面內（左右）" : "立面外（前後）"}</h3><p class="record-state" data-record-axis="${axis}">記錄狀態：${
    m.status === "skipped"
      ? "未施測"
      : isConfirmed(
            pair,
            project.facades.find((f) => f.id === pair.facadeId),
          )
        ? "已確認"
        : "待確認"
  }</p>${body}${disclosure(`direction:${pair.id}:${axis}`, "本方向設定", summary, settings, m.status === "skipped" || rounds.length === 2)}</section>`;
}
function pairSettingsView(pair, index, uses) {
  const more = `<div class="form-grid more-grid">${select(
    "量測角位置",
    `pairs.${index}.corner`,
    pair.corner,
    [
      ["right", "右角"],
      ["left", "左角"],
      ["custom", "自訂"],
    ],
  )}${pair.corner === "custom" ? input("測線距立面左端", `pairs.${index}.cornerOffsetCm`, pair.cornerOffsetCm, { unit: "cm" }) : ""}${input("TB 離地高度", `pairs.${index}.tbHeightCm`, pair.tbHeightCm, { unit: "cm", placeholder: "可留空" })}${input("現場備註", `pairs.${index}.note`, pair.note, { numeric: false })}</div>`;
  return `<div id="liveResults" class="live-results" aria-live="polite"></div><section class="card pair-settings" data-pair-card><div class="form-grid">${select(
    "預設作業方式",
    `pairs.${index}.mode`,
    pair.mode,
    [
      ["A", "A｜直接偏移量"],
      ["B", "B｜水平距與高差"],
      ["C", "C｜三維座標"],
    ],
  )}${select(
    "所屬立面",
    `pairs.${index}.facadeId`,
    pair.facadeId,
    project.facades.map((f) => [f.id, f.name]),
  )}</div>${uses("A") ? `<div class="shared-height-row">${check("兩方向共用垂距 H", `pairs.${index}.sharedH`, pair.sharedH)}${pair.sharedH ? input("H", `pairs.${index}.inPlane.A.hCm`, pair.inPlane.A.hCm, { unit: "cm", ariaLabel: "共用垂距 H（cm）" }) : ""}</div>` : ""}${disclosure(`pair:${pair.id}:more`, "更多設定", moreSummary(pair), more, pair.corner !== "right" || !!pair.tbHeightCm || !!pair.note)}${uses("B") ? '<p class="hint">測站應位於待測分量的方向線上；視線斜交時，量得值為視線方向分量。</p>' : ""}${uses("C") ? '<p class="hint">N（北）、E（東）、Z（高程），請先在「立面參數」設定基準。</p>' : ""}</section>`;
}
function readingCardsView(pair, index) {
  return `<div class="measurement-grid">${directionForm(pair, index, "inPlane")}${directionForm(pair, index, "outPlane")}</div><section class="card confirm-card"><div id="confirmState"></div><div class="button-row"><button class="primary" data-action="confirm">確認本組讀數</button><button data-action="preview">預覽成果表</button><button data-action="tab-photos">點位照片與標註</button><button data-action="tab-map">平面圖標示</button><button class="danger-text" data-action="delete-pair">刪除本組</button></div><p class="hint">草稿會自動保存；產出成果前須確認讀數。更正已確認的讀數時，會要求填原因。</p></section>`;
}
function readingsView() {
  const index = project.pairs.findIndex((p) => p.id === selectedPair),
    pair = project.pairs[index],
    uses = (mode) => pair && ["inPlane", "outPlane"].some((axis) => modeFor(pair, axis) === mode);
  let content =
    heading(
      "現場讀數",
      "先確認測點，再記錄兩個方向",
      "方向基準：站在立面外、面向立面。向後表示頂部朝建物內側。",
    ) +
    `<div class="button-row pair-list">${project.pairs
      .map(
        (p) =>
          `<button data-pair="${p.id}" class="${p.id === selectedPair ? "primary" : ""}">測點組 ${p.index}${
            isConfirmed(
              p,
              project.facades.find((f) => f.id === p.facadeId),
            )
              ? " ✓"
              : ""
          }</button>`,
      )
      .join("")}<button data-action="add-pair">＋新增測點組</button></div>`;
  if (!pair) return content + '<section class="card">請新增測點組。</section>';
  content += pairSettingsView(pair, index, uses);
  if (uses("C"))
    content += `<section class="card"><h3>TP／TB 共用三維座標</h3>${pair.C.rounds
      .map(
        (r, i) =>
          `<div class="round-block"><h4>第 ${i + 1} 測回</h4>${numericRound(
            r,
            `pairs.${index}.C.rounds.${i}`,
            [
              ["N", "N（北）"],
              ["E", "E（東）"],
              ["Z", "Z（高程）"],
            ],
          )}</div>`,
      )
      .join(
        "",
      )}${disclosure(`coordinates:${pair.id}`, "座標設定", `${pair.C.rounds.length} 測回`, `<label class="field"><span>座標測回數</span><select data-rounds="${index}|pair|C">${[1, 2].map((n) => option(String(n), `${n} 測回`, String(pair.C.rounds.length))).join("")}</select></label>`, pair.C.rounds.length === 2)}</section>`;
  content += readingCardsView(pair, index);
  return content;
}
function readingKeyboard() {
  if (tab !== "readings") return;
  const fields = [...workspace.querySelectorAll('input[inputmode="decimal"]')].filter(
    (e) => e.getClientRects().length,
  );
  fields.forEach((e, i) => (e.enterKeyHint = i === fields.length - 1 ? "done" : "next"));
}
function reportView() {
  return (
    heading(
      "成果與輸出",
      "把讀數、照片與位置整理成 A4 附件",
      "照片附件及佈設圖可獨立輸出；成果表仍須先確認讀數。",
    ) +
    `<section class="card report-controls"><label class="field"><span>輸出內容</span><select id="reportKind">${[
      ["all", "完整附件（成果＋勾選項目）"],
      ["results", "成果表"],
      ["photos", "點位照片"],
      ["map", "測點佈設圖"],
    ]
      .map(([v, t]) => option(v, t, reportKind))
      .join(
        "",
      )}</select></label><div class="button-row"><button class="primary" data-action="build-report">更新預覽</button><button data-action="print">系統列印／另存 PDF</button><button data-action="download-pdf">下載影像式 PDF</button><button data-action="export">匯出完整案件檔</button></div><label class="check-field"><input id="includeRaw" type="checkbox"${includeRaw ? " checked" : ""}>附原始讀數表與更正紀錄</label><label class="check-field"><input id="includePhotos" type="checkbox"${includePhotos ? " checked" : ""}>完整附件包含點位照片</label><label class="check-field"><input id="includeMap" type="checkbox"${includeMap ? " checked" : ""}>完整附件包含佈設圖（有底圖時）</label><p class="hint">系統列印保留向量圖及可選取文字；直接下載 PDF 為影像式。輸出期間請保持此分頁開啟。</p><div id="reportWarnings"></div></section><div id="reportRoot" class="report-pages"></div>` +
    mobileCaseActions()
  );
}
const resultsSizeObserver = new ResizeObserver((entries) => {
  for (const { target: element } of entries) {
    if (element?.isConnected && element.id === "liveResults")
      document.documentElement.style.setProperty(
        "--live-results-height",
        `${element.getBoundingClientRect().height}px`,
      );
  }
});
function observeResultsSize() {
  resultsSizeObserver.disconnect();
  const element = $("#liveResults");
  if (element) resultsSizeObserver.observe(element);
  else document.documentElement.style.removeProperty("--live-results-height");
}
function updateResults() {
  const pair = project.pairs.find((p) => p.id === selectedPair);
  if (tab === "readings" && pair) {
    $("#liveResults").innerHTML = liveResultsView(pair);
    $("#confirmState").textContent = isConfirmed(
      pair,
      project.facades.find((f) => f.id === pair.facadeId),
    )
      ? "本組讀數已確認"
      : "本組有待確認的讀數";
    workspace.querySelectorAll("[data-record-axis]").forEach(
      (e) =>
        (e.textContent =
          "記錄狀態：" +
          (pair[e.dataset.recordAxis].status === "skipped"
            ? "未施測"
            : isConfirmed(
                  pair,
                  project.facades.find((f) => f.id === pair.facadeId),
                )
              ? "已確認"
              : "待確認")),
    );
    const more = workspace.querySelector("[data-pair-card] .form-disclosure>summary>span");
    if (more) {
      more.textContent = moreSummary(pair);
      more.title = moreSummary(pair);
    }
  }
}
function render() {
  desktopActions.append(shareButton);
  mediaUI.dispose();
  reportGeneration++;
  document.body.classList.toggle("readings-active", tab === "readings");
  document.documentElement.classList.toggle("readings-active", tab === "readings");
  document
    .querySelectorAll("[data-tab]")
    .forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  workspace.innerHTML = {
    case: caseView,
    facades: facadeView,
    readings: readingsView,
    photos: mediaUI.photosView,
    map: mediaUI.mapView,
    reports: reportView,
  }[tab]();
  positionCaseActions();
  positionSelectors();
  updateCaseSummary();
  readingKeyboard();
  const active = $(".sidebar nav button.active"),
    nav = $(".sidebar nav");
  if (mobileLayout.matches)
    nav.scrollLeft =
      active.offsetLeft - nav.offsetLeft - (nav.clientWidth - active.clientWidth) / 2;
  updateResults();
  observeResultsSize();
  if (tab === "reports") buildReport();
  else mediaUI.mount(tab);
}
function resizeReports() {
  const root = $("#reportRoot");
  if (root)
    root.style.setProperty("--report-scale", Math.min(1, root.clientWidth / ((210 * 96) / 25.4)));
}
function buildReport() {
  $("#reportRoot").dataset.ready = "false";
  resizeReports();
  const job = ++reportGeneration,
    snapshot = structuredClone(project),
    options = { kind: reportKind, includeRaw, includePhotos, includeMap };
  reportStale = true;
  reportPromise = (async () => {
    const issues = outputIssues(snapshot, options),
      missing = Object.keys(snapshot.header).filter((k) => !snapshot.header[k].trim());
    $("#reportWarnings").innerHTML = issues.length
      ? `<p class="error">請先完成下列事項：</p><ul>${issues.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`
      : missing.length
        ? '<p class="warning">尚有表頭欄位未填，附件以「○○」佔位。</p>'
        : "";
    $("#reportRoot").innerHTML = issues.length
      ? ""
      : '<p class="report-loading">正在整理附件影像…</p>';
    if (issues.length) {
      $("#reportRoot").dataset.ready = "true";
      return;
    }
    try {
      const html = await fullReport(snapshot, options);
      if (job !== reportGeneration || tab !== "reports" || snapshot.updatedAt !== project.updatedAt)
        return;
      resizeReports();
      $("#reportRoot").innerHTML = html;
      await document.fonts.ready;
      await Promise.all([...$("#reportRoot").querySelectorAll("img")].map((img) => img.decode()));
      if (job !== reportGeneration || tab !== "reports" || snapshot.updatedAt !== project.updatedAt)
        return;
      reportStale = false;
      resizeReports();
      $("#reportRoot").dataset.ready = "true";
    } catch (e) {
      if (job === reportGeneration && tab === "reports") {
        $("#reportRoot").innerHTML = "";
        notice(`附件預覽未完成：${e.message}`, true);
      }
    }
  })();
  return reportPromise;
}
function hasReadings(pair) {
  return [pair.inPlane.A, pair.outPlane.A, pair.inPlane.B, pair.outPlane.B, pair.C].some((m) =>
    JSON.stringify(m).match(/"(?:dxCm|upperCm|lowerCm|HD|VD|N|E|Z|hCm)":"[^"]+"/),
  );
}
function shareSupported() {
  try {
    return (
      typeof navigator.share === "function" &&
      !!navigator.canShare?.({
        files: [new File([""], "案件.tiltsurvey", { type: "application/json" })],
      })
    );
  } catch {
    return false;
  }
}
function invalidateShare() {
  const button = $("#shareCaseButton");
  if (preparedShare || button.textContent === "正在準備案件檔…")
    notice("案件已變更，請重新準備分享檔案。");
  shareGeneration++;
  preparedShare = null;
  button.textContent = "準備分享案件檔";
  button.disabled = sharing;
}
async function caseFile() {
  const origin = project,
    backupProject = structuredClone(project);
  backupProject.lastExportedAt = backupProject.updatedAt;
  clearTimeout(saveTimer);
  await queueSave();
  const backup = await makeBackup(backupProject),
    blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  if (blob.size > 250 * 1024 * 1024)
    throw Error("案件檔超過 250 MB，請先另存照片原檔並減少本案件照片。");
  const name = `傾斜測量_${(backupProject.header.caseNumber || "未命名").replace(/[<>:"/\\|?*]/g, "_")}_${new Date().toISOString().slice(0, 10)}.tiltsurvey`;
  return {
    origin,
    updatedAt: backupProject.updatedAt,
    file: new File([blob], name, { type: blob.type }),
  };
}
async function markExported(data) {
  const at = new Date().toISOString();
  exportActionTimes.set(data.origin.id, at);
  try {
    localStorage.setItem(exportActionKey(data.origin.id), at);
  } catch {}
  if (project === data.origin) {
    updateCaseSummary();
    if (project.updatedAt === data.updatedAt) {
      project.lastExportedAt = data.updatedAt;
      await queueSave();
    }
  }
}
async function exportCase() {
  const data = await caseFile();
  downloadBlob(data.file, data.file.name);
  await markExported(data);
  notice("完整案件檔已交由瀏覽器下載，請確認檔案已保存。");
}
async function prepareShare() {
  const job = ++shareGeneration,
    button = $("#shareCaseButton");
  preparedShare = null;
  button.disabled = true;
  button.textContent = "正在準備案件檔…";
  try {
    const data = await caseFile();
    if (job !== shareGeneration || project !== data.origin || project.updatedAt !== data.updatedAt)
      return;
    if (!navigator.canShare?.({ files: [data.file] }))
      throw Error("此裝置無法分享案件檔，請使用匯出");
    preparedShare = data;
    button.textContent = "分享已準備的案件檔";
    notice("案件檔已準備，請再次點擊「分享已準備的案件檔」。");
  } catch (e) {
    if (job === shareGeneration) throw e;
  } finally {
    if (job === shareGeneration) {
      button.disabled = false;
      if (!preparedShare) button.textContent = "準備分享案件檔";
    }
  }
}
async function shareCase() {
  const data = preparedShare;
  if (sharing || !data) return;
  if (project !== data.origin || project.updatedAt !== data.updatedAt) {
    invalidateShare();
    return;
  }
  const button = $("#shareCaseButton");
  sharing = true;
  button.disabled = true;
  try {
    // Invoke synchronously from the second click; all media work has finished.
    await navigator.share({ files: [data.file], title: "傾斜測量案件檔" });
    await markExported(data);
    notice("完整案件檔已交由系統分享。");
  } catch (e) {
    if (e.name === "AbortError") {
      notice("已取消分享，匯出狀態未變更。");
      return;
    }
    throw e;
  } finally {
    sharing = false;
    button.disabled = false;
  }
}
async function adopt(newProject, media = []) {
  invalidateShare();
  clearTimeout(saveTimer);
  await saving;
  await replaceProject(newProject, media);
  project = newProject;
  document.documentElement.dataset.saveState = "saved";
  reportKind = "all";
  selectedPair = project.pairs[0]?.id;
  selectedFacade = project.facades[0].id;
  failedSave = false;
  storageBlocked = false;
  reportStale = true;
  updateStatus();
  render();
}
async function action(name) {
  const pair = project.pairs.find((p) => p.id === selectedPair),
    facade = project.facades.find((f) => f.id === selectedFacade);
  if (name === "export") return exportCase();
  if (name === "share") return preparedShare ? shareCase() : prepareShare();
  if (name === "toggle-results") {
    resultsExpanded = !resultsExpanded;
    updateResults();
    $("#resultSummaryButton").focus({ preventScroll: true });
    return;
  }
  if (name === "verify-file") {
    $("#verifyFile").click();
    return;
  }
  if (name === "import") {
    $("#importFile").click();
    return;
  }
  if (name === "new" || name === "sample") {
    if (await allowReplace(name === "new" ? "建立空白案件" : "載入合成示例")) {
      await adopt(name === "new" ? createProject() : sampleProject());
      notice(name === "new" ? "空白案件已建立。" : "合成示例已載入，可直接預覽成果表。");
    }
    return;
  }
  if (name === "tab-photos" || name === "tab-map") {
    tab = name === "tab-photos" ? "photos" : "map";
    render();
    return;
  }
  if (name === "tab-readings" || name === "preview") {
    tab = name === "preview" ? "reports" : "readings";
    render();
    window.scrollTo(0, 0);
    return;
  }
  if (name === "add-pair") {
    if (project.pairs.length >= 200) throw Error("本版最多 200 組測點");
    const index = Math.max(project.nextPairIndex || 1, ...project.pairs.map((p) => p.index + 1));
    const p = createPair(index, selectedFacade, project.settings.defaultMode);
    project.nextPairIndex = index + 1;
    project.pairs.push(p);
    selectedPair = p.id;
  } else if (name === "delete-pair") {
    if (!pair) return;
    const answer = await dialog(
      "刪除測點組",
      `將刪除測點組 ${pair.index} 及其讀數，原有更正紀錄會保留。`,
      [
        ["delete", "刪除本組"],
        ["cancel", "取消"],
      ],
    );
    if (answer.value !== "delete") return;
    project.pairs = project.pairs.filter((p) => p.id !== pair.id);
    project.nextPairIndex = Math.max(project.nextPairIndex || 1, pair.index + 1);
    selectedPair = project.pairs[0]?.id;
  } else if (name === "add-facade") {
    if (project.facades.length >= 100) throw Error("本版最多 100 個立面");
    const f = createFacade(`立面 ${project.facades.length + 1}`);
    project.facades.push(f);
    selectedFacade = f.id;
  } else if (name === "add-floor") {
    if (facade.building.floorHeightsCm.length >= 60) throw Error("本版最多 60 層");
    facade.building.floorHeightsCm.push("320");
  } else if (name === "remove-floor") {
    if (facade.building.floorHeightsCm.length > 1) facade.building.floorHeightsCm.pop();
  } else if (name === "confirm") {
    if (!pair) return;
    const f = project.facades.find((f) => f.id === pair.facadeId),
      r = calculatePair(pair, f, project.settings);
    const errors = Object.values(r)
      .filter((r) => r.status === "error")
      .map((r) => r.error);
    if (errors.length) throw Error(errors.join("；"));
    buildingParameters(f, pair);
    let reason = "";
    if (pair.confirmed && !isConfirmed(pair, f)) {
      const response = await dialog(
        "更正已確認讀數",
        "更正原因會與更正前後原始值一併保存。",
        [
          ["confirm", "保存更正"],
          ["cancel", "取消"],
        ],
        { reason: true },
      );
      if (response.value !== "confirm") return;
      reason = response.reason;
    }
    confirmObservation(project, pair, f, reason);
    notice(`測點組 ${pair.index} 讀數已確認。`);
  } else if (name === "build-report") {
    buildReport();
    return;
  } else if (name === "print" || name === "download-pdf") {
    if (tab !== "reports") {
      tab = "reports";
      render();
    } else if (reportStale) buildReport();
    await reportPromise;
    if (reportStale) throw Error("請先完成附件預覽列出的事項");
    await document.fonts.ready;
    if (name === "print") {
      window.print();
      return;
    }
    const b = $('[data-action="download-pdf"]'),
      pdfName = `傾斜測量_${project.header.caseNumber || "未命名"}_${reportKind}.pdf`;
    b.disabled = true;
    try {
      const blob = await imagePdf($("#reportRoot"), (i, n) =>
        notice(`正在產生影像式 PDF：${i}／${n} 頁…`),
      );
      downloadBlob(blob, pdfName);
      notice("影像式 PDF 已交由瀏覽器下載，請確認檔案已保存。");
    } finally {
      if (b.isConnected) b.disabled = false;
    }
    return;
  } else return;
  changed();
  render();
}
const mediaUI = createMediaUI({
  project: () => project,
  selectedPair: () => selectedPair,
  selectPair: (value) => {
    selectedPair = value;
    positionSelectors();
  },
  tab: () => tab,
  changed,
  notice,
  dialog,
  render,
  navigate: (value) => {
    tab = value;
    render();
  },
  preview: (kind) => {
    reportKind = kind;
    tab = "reports";
    render();
  },
});
setupDisplay();
document.addEventListener("click", async (event) => {
  const b = event.target.closest("button");
  if (!b || b.closest("#actionDialog")) return;
  try {
    if (b.dataset.tab) {
      tab = b.dataset.tab;
      render();
      window.scrollTo(0, 0);
    } else if (b.dataset.pair) {
      selectedPair = b.dataset.pair;
      render();
    } else if (b.dataset.facade) {
      selectedFacade = b.dataset.facade;
      render();
    } else if (b.dataset.defaultMode) {
      project.settings.defaultMode = b.dataset.defaultMode;
      changed();
      render();
    } else if (b.dataset.action) await action(b.dataset.action);
    else if (b.dataset.sign) {
      const value = get(b.dataset.sign);
      set(b.dataset.sign, value.startsWith("-") ? value.slice(1) : value ? "-" + value : "-");
      const input = Array.from(document.querySelectorAll("[data-field]")).find(
        (e) => e.dataset.field === b.dataset.sign,
      );
      input.value = get(b.dataset.sign);
      changed();
      updateResults();
      input.focus();
    }
  } catch (e) {
    notice(e.message, true);
  }
});
document.addEventListener("input", (event) => {
  const e = event.target;
  if (!e.dataset.field || e.tagName === "SELECT" || e.type === "checkbox") return;
  set(e.dataset.field, e.value);
  changed();
  updateResults();
});
document.addEventListener("change", async (event) => {
  const e = event.target;
  try {
    if (e.id === "reportKind") {
      reportKind = e.value;
      buildReport();
      return;
    }
    if (["includeRaw", "includePhotos", "includeMap"].includes(e.id)) {
      if (e.id === "includeRaw") includeRaw = e.checked;
      else if (e.id === "includePhotos") includePhotos = e.checked;
      else includeMap = e.checked;
      buildReport();
      return;
    }
    if (e.dataset.rounds) {
      const [i, axis, mode] = e.dataset.rounds.split("|"),
        m = axis === "pair" ? project.pairs[i][mode] : project.pairs[i][axis][mode];
      if (e.value === "1") {
        m.extraRound = m.rounds[1];
        m.rounds = m.rounds.slice(0, 1);
      } else if (m.rounds.length === 1) {
        m.rounds.push(
          m.extraRound ||
            structuredClone(
              mode === "C" ? createPair(1, "").C.rounds[0] : measurement(axis)[mode].rounds[0],
            ),
        );
      }
      changed();
      render();
      return;
    }
    if (!e.dataset.field || (e.tagName !== "SELECT" && e.type !== "checkbox")) return;
    const path = e.dataset.field;
    if (path.endsWith(".mode")) {
      const pair = project.pairs[+path.split(".")[1]];
      if (hasReadings(pair) && e.value !== get(path)) {
        const response = await dialog(
          "切換作業方式",
          "原讀數保留，成果只採用新選擇的方式。已確認的讀數須重新確認並填更正原因。",
          [
            ["switch", "切換並保留原讀數"],
            ["cancel", "取消"],
          ],
        );
        if (response.value !== "switch") {
          e.value = get(path);
          return;
        }
      }
    }
    set(path, e.type === "checkbox" ? e.checked : e.value);
    if (/^pairs\.\d+\.mode$/.test(path)) {
      const pair = project.pairs[+path.split(".")[1]];
      for (const axis of ["inPlane", "outPlane"]) pair[axis].mode = "";
    }
    changed();
    render();
  } catch (error) {
    notice(error.message, true);
  }
});
$("#shareCaseButton").hidden = !shareSupported();
$("#verifyFile").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  try {
    if (file.size > 250 * 1024 * 1024) throw Error("案件檔超過 250 MB");
    const result = await verifyFingerprint(parseBackup(await file.text()));
    notice(
      result.matches === null
        ? `此舊案件檔未附指紋；計算 SHA-256：${result.actual}。目前案件未變更。`
        : result.matches
          ? `案件檔指紋一致：${result.actual}。目前案件未變更。`
          : `案件檔指紋不一致：計算 ${result.actual}，檔載 ${result.expected}。目前案件未變更。`,
      result.matches === false,
    );
  } catch (e) {
    notice(`指紋驗證未完成：${e.message}。目前案件未變更。`, true);
  }
});
$("#importFile").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  try {
    if (file.size > 250 * 1024 * 1024) throw Error("案件檔超過 250 MB");
    const backup = parseBackup(await file.text());
    if (await allowReplace("匯入案件檔")) {
      await adopt(backup.project, backup.media);
      notice("案件檔已匯入。");
    }
  } catch (e) {
    notice(`匯入未完成：${e.message}`, true);
  }
});
document.addEventListener("keydown", (event) => {
  if (
    tab !== "readings" ||
    event.key !== "Enter" ||
    event.isComposing ||
    event.keyCode === 229 ||
    event.defaultPrevented ||
    !event.target.matches('input[data-field][inputmode="decimal"]')
  )
    return;
  const fields = Array.from(
      workspace.querySelectorAll('input[data-field][inputmode="decimal"]'),
    ).filter((e) => e.getClientRects().length),
    next = fields[fields.indexOf(event.target) + 1];
  event.preventDefault();
  if (next) next.focus();
  else event.target.blur();
});
document.addEventListener(
  "toggle",
  (event) => {
    const key = event.target.dataset.uiDisclosure;
    if (!key) return;
    disclosurePrefs[key] = event.target.open;
    try {
      localStorage.setItem(disclosureKey, JSON.stringify(disclosurePrefs));
    } catch {}
    readingKeyboard();
  },
  true,
);
window.addEventListener("resize", () => {
  resizeReports();
  readingKeyboard();
});
new ResizeObserver(([entry]) =>
  document.documentElement.style.setProperty(
    "--app-header-height",
    `${entry.target.getBoundingClientRect().height}px`,
  ),
).observe($(".app-header"));
window.addEventListener("pagehide", () => {
  clearTimeout(saveTimer);
  if (project) queueSave();
});
let swReload = false,
  updateRequested = false,
  previousController = navigator.serviceWorker?.controller;
if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("./sw.js", { updateViaCache: "none" })
    .then(async (registration) => {
      await navigator.serviceWorker.ready;
      $("#offlineStatus").textContent = navigator.onLine ? "離線資源已準備" : "離線使用中";
      const showUpdate = () => {
        if (registration.waiting) {
          const button = $("#updateButton");
          button.hidden = false;
          button.onclick = async () => {
            await queueSave();
            if (failedSave) {
              notice("請先匯出案件備份，再重新載入新版。", true);
              return;
            }
            updateRequested = true;
            if (registration.waiting) registration.waiting.postMessage("SKIP_WAITING");
            else location.reload();
          };
        }
      };
      showUpdate();
      registration.addEventListener("updatefound", () =>
        registration.installing?.addEventListener("statechange", showUpdate),
      );
    })
    .catch(() => {
      $("#offlineStatus").textContent = "離線資源尚未就緒";
    });
}
navigator.serviceWorker?.addEventListener("controllerchange", () => {
  if (updateRequested && !swReload) {
    swReload = true;
    location.reload();
    return;
  }
  if (previousController) {
    const button = $("#updateButton");
    button.hidden = false;
    button.onclick = async () => {
      await queueSave();
      if (failedSave) {
        notice("請先匯出案件備份，再重新載入新版。", true);
        return;
      }
      location.reload();
    };
  }
  previousController = navigator.serviceWorker.controller;
});
window.addEventListener("online", () => {
  $("#offlineStatus").textContent = "已連線";
});
window.addEventListener("offline", () => {
  $("#offlineStatus").textContent = "離線使用中";
});
try {
  const saved = await loadProject();
  project = saved ? normalizeProject(saved) : createProject();
  if (!saved) await saveProject(project);
} catch (e) {
  project = createProject();
  failedSave = true;
  storageBlocked = true;
  notice(
    `無法讀取本機案件：${e.message}。原本案件未覆寫；目前畫面不會自動保存，可先匯入備份或明確另建案件。`,
    true,
  );
}
selectedPair = project.pairs[0]?.id;
selectedFacade = project.facades[0].id;
document.documentElement.dataset.saveState = failedSave ? "failed" : "saved";
updateStatus();
render();
