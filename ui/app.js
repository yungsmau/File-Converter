"use strict";

/* ====================================================================
   Состояние. Все, что видно в окне, рисуется из этого объекта функцией render().
   ==================================================================== */
const state = {
  tab: "convert", // "convert" | "pdf"
  help: false, // открыта ли подсказка по форматам
  picker: false, // открыт ли выбор формата
  convert: {
    file: null,
    target: null,
    busy: false,
    result: null,
    error: null,
    hint: null,
  },
  pdf: {
    op: "merge", // "merge" | "split" | "compress"
    files: [],
    busy: false,
    result: null,
    error: null,
    hint: null,
    level: "medium",
    splitMode: "ranges", // "each" | "ranges" | "every"
    ranges: "",
    every: 2,
    preview: null,
  },
};

let OPS = []; // операции из Python: id, multi, accepts
let FORMATS = []; // форматы из Python для подсказки "?"

const api = () => window.pywebview.api;
const app = document.getElementById("app");

/* ====================================================================
   Мелкие помощники
   ==================================================================== */
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

const stem = (name) => name.replace(/\.[^.]+$/, "");
const extLabel = (ext) => ext.replace(".", "").toUpperCase();

function plural(n, forms) {
  const m10 = n % 10,
    m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return forms[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return forms[1];
  return forms[2];
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} Б`;
  let value = bytes / 1024;
  let unit = "КБ";
  if (value >= 1024) {
    value /= 1024;
    unit = "МБ";
  }
  if (value >= 1024) {
    value /= 1024;
    unit = "ГБ";
  }
  const text = value < 10 ? value.toFixed(1) : String(Math.round(value));
  return `${text.replace(".", ",")} ${unit}`;
}

const opInfo = (id) =>
  OPS.find((o) => o.id === id) || {
    id,
    multi: id === "merge",
    accepts: [".pdf"],
  };

/* ====================================================================
   Иконки
   ==================================================================== */
const BADGE_COLORS = {
  ".xlsx": "#1b7a4a",
  ".xlsm": "#1b7a4a",
  ".xls": "#1b7a4a",
  ".csv": "#0e7c86",
  ".tsv": "#0e7c86",
  ".pdf": "#c23a3a",
  ".txt": "#5e5e66",
};
const IMAGE_COLOR = "#7b4fd0";

function fileIcon(ext, width = 72) {
  const color = BADGE_COLORS[ext] || IMAGE_COLOR;
  const height = Math.round((width * 76) / 64);
  return `<svg width="${width}" height="${height}" viewBox="0 0 64 76" aria-hidden="true">
    <path d="M14 2h28l16 16v48a4 4 0 0 1-4 4H14a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4z" fill="var(--surface)" stroke="var(--page-line)" stroke-width="1.5"/>
    <path d="M42 2v12a4 4 0 0 0 4 4h12" fill="var(--page-fold)" stroke="var(--page-line)" stroke-width="1.5"/>
    <rect x="2" y="38" width="44" height="21" rx="5" fill="${color}"/>
    <text x="24" y="53" text-anchor="middle" font-family="system-ui,-apple-system,Segoe UI,sans-serif" font-size="12" font-weight="700" fill="#fff" letter-spacing="0.4">${esc(extLabel(ext))}</text>
  </svg>`;
}

const svg = (body, size = 18, extra = "") =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${body}</svg>`;

const ICONS = {
  upload:
    '<path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  merge:
    '<path d="M7 3v6a5 5 0 0 0 5 5M17 3v6a5 5 0 0 1-5 5M12 14v7M9 18l3 3 3-3"/>',
  split:
    '<path d="M12 3v7M12 10c0 3-5 3-5 7v4M12 10c0 3 5 3 5 7v4M4 18l3 3 3-3M14 18l3 3 3-3"/>',
  compress: '<path d="M12 3v6M9 6l3 3 3-3M12 21v-6M9 18l3-3 3 3M5 12h14"/>',
};

const CLOSE = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M3 3l8 8M11 3l-8 8"/></svg>`;
const CHECK = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 4.8"/></svg>`;
const ARROW = `<svg class="arrow" width="64" height="24" viewBox="0 0 64 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12h54M48 4l10 8-10 8"/></svg>`;
const DOTS = `<svg width="12" height="18" viewBox="0 0 12 18" fill="currentColor" aria-hidden="true"><circle cx="3" cy="3" r="1.5"/><circle cx="9" cy="3" r="1.5"/><circle cx="3" cy="9" r="1.5"/><circle cx="9" cy="9" r="1.5"/><circle cx="3" cy="15" r="1.5"/><circle cx="9" cy="15" r="1.5"/></svg>`;
const CHEVRON = `<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 3.5l3 3 3-3"/></svg>`;

/* ====================================================================
   Подписи
   ==================================================================== */
const CAPTIONS = {
  ".jpg": "Фото",
  ".png": "Без потерь",
  ".webp": "Компактный",
  ".bmp": "Без сжатия",
  ".gif": "256 цветов",
  ".tiff": "Для печати",
  ".pdf": "Документ",
  ".csv": "Разделитель ;",
  ".tsv": "Через табуляцию",
  ".xlsx": "Таблица Excel",
  ".txt": "Только текст",
};

const DEFAULT_TARGET = {
  ".xlsx": ".csv",
  ".xlsm": ".csv",
  ".xls": ".csv",
  ".csv": ".xlsx",
  ".tsv": ".xlsx",
  ".jpg": ".png",
  ".png": ".jpg",
  ".webp": ".jpg",
  ".heic": ".jpg",
  ".heif": ".jpg",
  ".pdf": ".jpg",
};

const OP_META = {
  merge: { title: "Объединить", desc: "Склеить в один PDF" },
  split: { title: "Разделить", desc: "Разбить на части" },
  compress: { title: "Сжать", desc: "Уменьшить размер" },
};

const LEVELS = [
  { id: "low", title: "Легкое", desc: "Без потери качества" },
  { id: "medium", title: "Среднее", desc: "Картинки до 150 DPI", best: true },
  { id: "high", title: "Сильное", desc: "До 100 DPI, заметнее потери" },
];

function pickerNote(file, target) {
  if (file.kind === "pdf" && target === ".txt")
    return "Берется текстовый слой PDF. Для сканов нужен OCR, его пока нет";
  if (file.kind === "pdf")
    return "Каждая страница станет отдельным файлом · 150 DPI";
  if (target === ".csv")
    return "Каждый лист станет отдельным файлом · разделитель «;»";
  if (target === ".tsv")
    return "Каждый лист станет отдельным файлом · разделитель: табуляция";
  if (target === ".jpg") return "Качество 90 · прозрачность заливается белым";
  if (target === ".webp") return "Качество 90";
  if (target === ".bmp" || target === ".pdf")
    return "Прозрачность заливается белым";
  return "";
}

/* ====================================================================
   Общие куски разметки
   ==================================================================== */
function dropZone({ title, sub, tags, hint }) {
  return `
    <button type="button" class="drop" data-act="pick">
      <span class="badge">${svg(ICONS.upload, 32).replace('stroke-width="1.9"', 'stroke-width="1.6"')}</span>
      <span class="title">${esc(title)}</span>
      <span class="sub">${esc(sub)}</span>
      ${hint ? `<span class="hint" role="alert">${esc(hint)}</span>` : ""}
      <span class="tags">${tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</span>
    </button>`;
}

function fileMeta(f) {
  if (f.note) return { text: f.note, warn: true };
  const parts = [f.size_text];
  if (f.pages) parts.unshift(`${f.pages} стр.`);
  if (f.dims) parts.push(f.dims);
  return { text: parts.join(" · "), warn: false };
}

function spinnerLabel(text) {
  return `<span class="spinner" aria-hidden="true"></span>${esc(text)}`;
}

const sumSize = (files) =>
  formatSize(files.reduce((acc, f) => acc + f.size, 0));

/* ====================================================================
   Экран "Конвертация"
   ==================================================================== */
function viewConvert() {
  const c = state.convert;
  if (!c.file) {
    return dropZone({
      title: "Перетащите файл сюда",
      sub: "или нажмите, чтобы выбрать",
      tags: ["Excel · CSV", "JPG · PNG · HEIC · WebP", "PDF"],
      hint: c.hint,
    });
  }

  const f = c.file;
  const meta = fileMeta(f);
  const done = c.result;

  let targetCard;
  if (done) {
    const outs = done.outputs;
    const one = outs.length === 1;
    targetCard = `
      <div class="card target">
        <span class="check">${CHECK}</span>
        ${fileIcon(c.target)}
        <div>
          <div class="name">${esc(one ? outs[0].name : `${outs.length} ${plural(outs.length, ["файл", "файла", "файлов"])}`)}</div>
          <div class="meta">${esc(one ? fileMeta(outs[0]).text : sumSize(outs))}</div>
        </div>
      </div>`;
  } else {
    targetCard = `
      <button type="button" class="card target" data-act="open-picker" aria-haspopup="dialog">
        ${fileIcon(c.target)}
        <div>
          <div class="name">${esc(stem(f.name) + c.target)}</div>
          <span class="pick">Формат: ${esc(extLabel(c.target))} ${CHEVRON}</span>
        </div>
      </button>`;
  }

  let actions;
  if (done) {
    const n = done.outputs.length;
    actions = `
      <div class="actions">
        <div class="status-ok" role="status">${n === 1 ? "Готово. Файл сохранен рядом с исходным" : `Готово. Создано ${n} ${plural(n, ["файл", "файла", "файлов"])} рядом с исходным`}</div>
        <div class="btns">
          <button type="button" class="btn" data-act="reveal">Показать в папке</button>
          <button type="button" class="btn ghost" data-act="convert-reset">Конвертировать еще</button>
        </div>
      </div>`;
  } else {
    actions = `
      <div class="actions">
        ${c.error ? `<div class="error" role="alert">${esc(c.error)}</div>` : ""}
        <button type="button" class="btn" data-act="convert-run" ${c.busy ? "disabled" : ""}>
          ${c.busy ? spinnerLabel("Конвертируем…") : "Конвертировать"}
        </button>
      </div>`;
  }

  return `
    <div class="stage">
      <div class="pair ${done ? "done" : ""}">
        <div class="card source">
          ${done || c.busy ? "" : `<button type="button" class="icon-btn remove" data-act="convert-reset" aria-label="Убрать файл">${CLOSE}</button>`}
          ${fileIcon(f.ext)}
          <div>
            <div class="name" title="${esc(f.name)}">${esc(f.name)}</div>
            <div class="meta ${meta.warn ? "warn" : ""}">${esc(meta.text)}</div>
          </div>
        </div>
        ${ARROW}
        ${targetCard}
      </div>
      ${actions}
    </div>`;
}

function viewPicker() {
  const c = state.convert;
  const tiles = c.file.targets
    .map(
      (t) => `
      <button type="button" class="tile" role="radio" aria-checked="${t === c.target}" data-act="choose-target" data-v="${t}">
        ${fileIcon(t, 40)}
        <span class="fmt">${esc(extLabel(t))}</span>
        <span class="cap">${esc(CAPTIONS[t] || "")}</span>
      </button>`,
    )
    .join("");
  return `
    <div class="backdrop" data-act="close-picker-backdrop">
      <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="picker-title">
        <header>
          <h2 id="picker-title">Во что превратить ${esc(extLabel(c.file.ext))}?</h2>
          <button type="button" class="icon-btn" data-act="close-picker" aria-label="Закрыть">${CLOSE}</button>
        </header>
        <div class="grid" role="radiogroup" aria-label="Формат">${tiles}</div>
        <footer>${esc(pickerNote(c.file, c.target))}</footer>
      </div>
    </div>`;
}

/* ====================================================================
   Экран "PDF-инструменты"
   ==================================================================== */
const singleFile = () => state.pdf.files.find((f) => f.ext === ".pdf") || null;

function opsBig() {
  const p = state.pdf;
  return `<div class="ops" role="radiogroup" aria-label="Операция">${[
    "merge",
    "split",
    "compress",
  ]
    .map(
      (id) => `
      <button type="button" class="op" role="radio" aria-checked="${p.op === id}" data-act="set-op" data-v="${id}">
        <span class="ico">${svg(ICONS[id], 20)}</span>
        <span><span class="t">${OP_META[id].title}</span><span class="d">${OP_META[id].desc}</span></span>
      </button>`,
    )
    .join("")}</div>`;
}

function opsCompact() {
  const p = state.pdf;
  return `<div class="seg wide" role="radiogroup" aria-label="Операция">${[
    "merge",
    "split",
    "compress",
  ]
    .map(
      (id) => `
      <button type="button" role="radio" aria-checked="${p.op === id}" data-act="set-op" data-v="${id}">
        ${svg(ICONS[id], 18)}${OP_META[id].title}
      </button>`,
    )
    .join("")}</div>`;
}

function pdfDropZone(hint) {
  const multi = opInfo(state.pdf.op).multi;
  return dropZone({
    title: multi ? "Перетащите PDF или картинки сюда" : "Перетащите PDF сюда",
    sub: multi
      ? "Файлов может быть несколько, порядок вы зададите сами"
      : "или нажмите, чтобы выбрать",
    tags: multi ? ["PDF", "JPG · PNG · HEIC · WebP"] : ["PDF"],
    hint,
  });
}

function singleRow(f) {
  const meta = fileMeta(f);
  return `
    <div class="single">
      ${fileIcon(f.ext, 30)}
      <span class="text" style="flex:1;min-width:0">
        <span class="name" style="display:block;font-size:14px;font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f.name)}</span>
        <span class="meta" style="display:block;font-size:12px;color:var(${meta.warn ? "--err" : "--muted"})">${esc(meta.text)}</span>
      </span>
      <button type="button" class="icon-btn" data-act="remove-file" data-v="${esc(f.path)}" aria-label="Убрать файл">${CLOSE}</button>
    </div>`;
}

function viewMerge() {
  const p = state.pdf;
  const rows = p.files
    .map((f, i) => {
      const meta = f.note
        ? { text: f.note, warn: true }
        : f.kind === "pdf"
          ? { text: `${f.pages} стр. · ${f.size_text}`, warn: false }
          : { text: `Картинка станет страницей · ${f.size_text}`, warn: false };
      return `
      <div class="row" data-i="${i}">
        <button type="button" class="handle" data-act="handle" data-i="${i}" aria-label="Переместить ${esc(f.name)}. Стрелки вверх и вниз меняют порядок">${DOTS}</button>
        <span class="num">${i + 1}</span>
        ${fileIcon(f.ext, 30)}
        <span class="text">
          <span class="name" title="${esc(f.name)}">${esc(f.name)}</span>
          <span class="meta ${meta.warn ? "warn" : ""}">${esc(meta.text)}</span>
        </span>
        <button type="button" class="icon-btn" data-act="remove-file" data-v="${esc(f.path)}" aria-label="Убрать ${esc(f.name)}">${CLOSE}</button>
      </div>`;
    })
    .join("");

  const n = p.files.length;
  const pages = p.files.reduce(
    (acc, f) => acc + (f.kind === "pdf" ? f.pages || 0 : 1),
    0,
  );
  const ready = n >= 2;
  return `
    <div class="list" id="files">${rows}</div>
    <button type="button" class="add" data-act="pick"><svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M7 2v10M2 7h10"/></svg>Добавить файлы <span>· порядок меняется за точки слева</span></button>
    ${p.error ? `<div class="error left" role="alert">${esc(p.error)}</div>` : ""}
    <div style="flex:1"></div>
    <div class="footer">
      <div>
        <div class="sum">${n} ${plural(n, ["файл", "файла", "файлов"])} · ${pages} стр.</div>
        <div class="note">${ready ? `Результат: ${esc(stem(p.files[0].name))}_merged.pdf` : "Добавьте хотя бы два файла"}</div>
      </div>
      <button type="button" class="btn" data-act="run" ${ready && !p.busy ? "" : "disabled"}>${p.busy ? spinnerLabel("Объединяем…") : "Объединить"}</button>
    </div>`;
}

function previewHtml() {
  const p = state.pdf;
  const r = p.preview;
  if (!r) {
    return `<div class="field"><span class="hint">${
      p.splitMode === "ranges"
        ? "Введите диапазоны, например 1-3, 5, 11-"
        : "Предпросмотр появится здесь"
    }</span></div>`;
  }
  if (!r.ok)
    return `<div class="error left" role="alert">${esc(r.error)}</div>`;
  const n = r.parts.length;
  return `
    <div class="field">
      <div class="head"><label>Получится: ${n} ${plural(n, ["файл", "файла", "файлов"])}</label></div>
      <div class="chips">${r.parts
        .map(
          (x) =>
            `<span class="chip">${esc(x.name)} <span>· ${x.pages} стр.</span></span>`,
        )
        .join("")}</div>
    </div>`;
}

function viewSplit(f) {
  const p = state.pdf;
  const modes = [
    ["each", "Каждая страница"],
    ["ranges", "По диапазонам"],
    ["every", "По N страниц"],
  ];
  let input = "";
  if (p.splitMode === "ranges") {
    input = `
      <div class="field">
        <div class="head">
          <label for="ranges">Диапазоны страниц</label>
          <span class="hint">Пустой конец означает «до конца» (11-)</span>
        </div>
        <input id="ranges" class="input" type="text" value="${esc(p.ranges)}" placeholder="1-3, 5, 11-" autocomplete="off" spellcheck="false">
      </div>`;
  } else if (p.splitMode === "every") {
    input = `
      <div class="field">
        <div class="head"><label for="every">Страниц в каждой части</label></div>
        <input id="every" class="input short" type="number" min="1" value="${esc(p.every)}">
      </div>`;
  }
  const ok = p.preview && p.preview.ok;
  return `
    ${singleRow(f)}
    <div class="seg small" role="radiogroup" aria-label="Как разделить">${modes
      .map(
        ([id, label]) =>
          `<button type="button" role="radio" aria-checked="${p.splitMode === id}" data-act="split-mode" data-v="${id}">${label}</button>`,
      )
      .join("")}</div>
    ${input}
    <div id="preview" style="overflow:auto;min-height:0">${previewHtml()}</div>
    ${p.error ? `<div class="error left" role="alert">${esc(p.error)}</div>` : ""}
    <div style="flex:1"></div>
    <div class="footer">
      <div class="note">Файлы появятся рядом с исходным</div>
      <button type="button" class="btn" id="run" data-act="run" ${ok && !p.busy ? "" : "disabled"}>${p.busy ? spinnerLabel("Делим…") : "Разделить"}</button>
    </div>`;
}

function viewCompress(f) {
  const p = state.pdf;
  const r = p.result;
  const levels = LEVELS.map(
    (l) => `
    <button type="button" class="level" role="radio" aria-checked="${p.level === l.id}" data-act="set-level" data-v="${l.id}">
      <span class="t">${l.title}${l.best ? '<span class="best">лучший выбор</span>' : ""}</span>
      <span class="d">${l.desc}</span>
    </button>`,
  ).join("");

  let middle = "";
  if (r) {
    const out = r.outputs[0];
    const ratio = r.source_size
      ? Math.min(100, Math.round((100 * out.size) / r.source_size))
      : 100;
    middle = `
      <div class="result" role="status">
        <div class="line">
          <div class="sizes">
            <span class="before">${esc(r.source_size_text)}</span>
            <svg width="22" height="12" viewBox="0 0 22 12" fill="none" stroke="var(--ok)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 6h16M13 2l5 4-5 4"/></svg>
            <span class="after">${esc(out.size_text)}</span>
          </div>
          <span class="pct">−${r.saved_percent}%</span>
        </div>
        <div class="bar"><i style="width:${ratio}%"></i></div>
        <div class="note">${r.saved_percent === 0 ? "Файл уже хорошо сжат: оставили оригинал" : "Текст остался текстом: его по-прежнему можно выделять и искать"}</div>
      </div>`;
  }

  const footer = r
    ? `<button type="button" class="btn ghost" data-act="result-again">Сжать заново</button>
       <button type="button" class="btn" data-act="reveal">Показать в папке</button>`
    : `<div class="note">Итог: ${esc(stem(f.name))}_compressed.pdf</div>
       <button type="button" class="btn" data-act="run" ${p.busy ? "disabled" : ""}>${p.busy ? spinnerLabel("Сжимаем…") : "Сжать"}</button>`;

  return `
    ${singleRow(f)}
    <div class="levels" role="radiogroup" aria-label="Уровень сжатия">${levels}</div>
    ${middle}
    ${p.error ? `<div class="error left" role="alert">${esc(p.error)}</div>` : ""}
    <div style="flex:1"></div>
    <div class="footer">${footer}</div>`;
}

function viewDoneList() {
  const p = state.pdf;
  const outs = p.result.outputs;
  const n = outs.length;
  return `
    <div class="done-box" role="status">
      <div class="head"><span class="check">${CHECK}</span>${
        n === 1
          ? "Файл создан рядом с исходным"
          : `Создано ${n} ${plural(n, ["файл", "файла", "файлов"])} рядом с исходным`
      }</div>
      <div class="chips">${outs
        .map(
          (o) =>
            `<span class="chip">${esc(o.name)} <span>· ${o.pages ? o.pages + " стр. · " : ""}${esc(o.size_text)}</span></span>`,
        )
        .join("")}</div>
    </div>
    <div style="flex:1"></div>
    <div class="footer">
      <button type="button" class="btn ghost" data-act="pdf-reset">Начать заново</button>
      <button type="button" class="btn" data-act="reveal">Показать в папке</button>
    </div>`;
}

function viewPdf() {
  const p = state.pdf;
  if (!p.files.length) {
    return `${opsBig()}${pdfDropZone(p.hint)}`;
  }
  const head = opsCompact();
  const multi = opInfo(p.op).multi;
  if (multi) {
    return head + (p.result ? viewDoneList() : viewMerge());
  }
  const f = singleFile();
  if (!f) return head + pdfDropZone("Для этой операции нужен PDF-файл");
  if (p.op === "compress") return head + viewCompress(f);
  return head + (p.result ? viewDoneList() : viewSplit(f));
}

/* ====================================================================
   Каркас и отрисовка
   ==================================================================== */
function viewHelp() {
  const rows = FORMATS.map(
    (g) =>
      `<dt>${esc(g.name)}</dt><dd>${esc(g.from.map(extLabel).join(", "))} → ${esc(g.to.map(extLabel).join(", "))}</dd>`,
  ).join("");
  return `<div class="popover" id="help" role="dialog" aria-label="Поддерживаемые форматы" ${state.help ? "" : "hidden"}>
    <h3>Что во что можно превратить</h3><dl>${rows}</dl></div>`;
}

function focusKeyOf(el) {
  if (!el || !el.dataset) return null;
  if (el.id) return "#" + el.id;
  if (el.dataset.act)
    return (
      `[data-act="${el.dataset.act}"]` +
      (el.dataset.v !== undefined
        ? `[data-v="${CSS.escape(el.dataset.v)}"]`
        : "") +
      (el.dataset.i !== undefined ? `[data-i="${el.dataset.i}"]` : "")
    );
  return null;
}

function render(focusKey) {
  const key = focusKey || focusKeyOf(document.activeElement);
  const tabs = [
    ["convert", "Конвертация"],
    ["pdf", "PDF-инструменты"],
  ]
    .map(
      ([id, label]) =>
        `<button type="button" role="tab" aria-selected="${state.tab === id}" data-act="set-tab" data-v="${id}">${label}</button>`,
    )
    .join("");

  app.innerHTML = `
    <div class="topbar">
      <div class="seg" role="tablist">${tabs}</div>
      <button type="button" class="help-btn" data-act="toggle-help" aria-label="Поддерживаемые форматы" aria-expanded="${state.help}">?</button>
      ${viewHelp()}
    </div>
    <div class="view">${state.tab === "convert" ? viewConvert() : viewPdf()}</div>
    ${state.picker ? viewPicker() : ""}`;

  if (key) {
    const target = app.querySelector(key);
    if (target) target.focus({ preventScroll: true });
  }
}

let toastTimer;
function toast(text) {
  const el = document.getElementById("toast");
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3500);
}

/* ====================================================================
   Работа с файлами
   ==================================================================== */
function setConvertFile(f) {
  const c = state.convert;
  if (!f.targets.length) {
    c.hint = `Формат ${extLabel(f.ext) || "этого файла"} пока не поддерживается`;
    render();
    return;
  }
  c.file = f;
  c.target = f.targets.includes(DEFAULT_TARGET[f.ext])
    ? DEFAULT_TARGET[f.ext]
    : f.targets[0];
  c.result = null;
  c.error = null;
  c.hint = null;
  render();
}

function addPdfFiles(files) {
  const p = state.pdf;
  const info = opInfo(p.op);
  const accepted = files.filter((f) => info.accepts.includes(f.ext));
  const skipped = files.length - accepted.length;
  if (skipped)
    toast(
      `Пропущено: ${skipped} ${plural(skipped, ["файл", "файла", "файлов"])}. Они не подходят для этой операции`,
    );
  if (!accepted.length) {
    p.hint = "Эта операция не работает с такими файлами";
    render();
    return;
  }
  p.hint = null;
  p.result = null;
  p.error = null;
  if (info.multi) {
    for (const f of accepted)
      if (!p.files.some((x) => x.path === f.path)) p.files.push(f);
  } else {
    p.files = [accepted[0]]; // разделение и сжатие работают с одним файлом: новый заменяет прежние
  }
  resetPreview();
  render();
  schedulePreview(true);
}

function addFiles(files) {
  if (!files || !files.length) return;
  if (state.convert.busy || state.pdf.busy) return;
  state.picker = false;
  if (state.tab === "convert") setConvertFile(files[0]);
  else addPdfFiles(files);
}

// Эту функцию вызывает Python, когда файлы брошены в окно
window.onFilesDropped = (files) => addFiles(files);

async function pickFiles() {
  if (!window.pywebview) return;
  const multi = state.tab === "pdf" && opInfo(state.pdf.op).multi;
  const accept = state.tab === "pdf" ? opInfo(state.pdf.op).accepts : null;
  addFiles(await api().pick_files(accept, multi));
}

/* ====================================================================
   Предпросмотр разделения
   ==================================================================== */
let previewTimer = null;
let previewSeq = 0;

function splitOptions() {
  const p = state.pdf;
  if (p.splitMode === "each") return { every: 1 };
  if (p.splitMode === "every")
    return { every: Math.max(1, parseInt(p.every, 10) || 1) };
  return { ranges: p.ranges.trim() };
}

function resetPreview() {
  state.pdf.preview = null;
  previewSeq++; // ответ на прежний запрос больше не нужен
}

function updatePreview() {
  const box = document.getElementById("preview");
  if (box) box.innerHTML = previewHtml();
  const run = document.getElementById("run");
  if (run && state.pdf.op === "split")
    run.disabled =
      !(state.pdf.preview && state.pdf.preview.ok) || state.pdf.busy;
}

function schedulePreview(immediate = false) {
  clearTimeout(previewTimer);
  const p = state.pdf;
  const f = singleFile();
  if (state.tab !== "pdf" || p.op !== "split" || !f) return;
  if (p.splitMode === "ranges" && !p.ranges.trim()) {
    resetPreview();
    updatePreview();
    return;
  }
  previewTimer = setTimeout(
    async () => {
      const seq = ++previewSeq;
      let r;
      try {
        r = await api().split_preview(f.path, splitOptions());
      } catch (e) {
        r = { ok: false, error: String(e) };
      }
      if (seq !== previewSeq) return;
      p.preview = r;
      updatePreview();
    },
    immediate ? 0 : 250,
  );
}

/* ====================================================================
   Запуск операций
   ==================================================================== */
async function callApi(fn) {
  try {
    return await fn();
  } catch (e) {
    return { ok: false, error: `Не удалось выполнить: ${e}` };
  }
}

async function runConvert() {
  const c = state.convert;
  if (c.busy) return;
  c.busy = true;
  c.error = null;
  render();
  const r = await callApi(() => api().convert(c.file.path, c.target, {}));
  c.busy = false;
  if (r.ok) c.result = r;
  else c.error = r.error;
  render("[data-act='reveal']");
}

async function runPdf() {
  const p = state.pdf;
  if (p.busy) return;
  p.busy = true;
  p.error = null;
  render();
  let r;
  if (p.op === "merge") {
    r = await callApi(() =>
      api().run_tool(
        "merge",
        p.files.map((f) => f.path),
        {},
      ),
    );
  } else if (p.op === "split") {
    r = await callApi(() =>
      api().run_tool("split", [singleFile().path], splitOptions()),
    );
  } else {
    r = await callApi(() =>
      api().run_tool("compress", [singleFile().path], { level: p.level }),
    );
  }
  p.busy = false;
  if (r.ok) p.result = r;
  else p.error = r.error;
  render("[data-act='reveal']");
}

function reveal() {
  const result =
    state.tab === "convert" ? state.convert.result : state.pdf.result;
  if (result && result.outputs.length) api().reveal(result.outputs[0].path);
}

/* ====================================================================
   Действия (по атрибуту data-act)
   ==================================================================== */
const ACTIONS = {
  "set-tab": (el) => {
    state.tab = el.dataset.v;
    state.picker = false;
    state.help = false;
    render();
    schedulePreview(true);
  },
  "toggle-help": () => {
    state.help = !state.help;
    render("[data-act='toggle-help']");
  },
  pick: () => pickFiles(),

  // конвертация
  "open-picker": () => {
    state.picker = true;
    render();
    const selected = app.querySelector(".tile[aria-checked='true']");
    if (selected) selected.focus();
  },
  "close-picker": () => closePicker(),
  "close-picker-backdrop": (el, e) => {
    if (e.target === el) closePicker();
  },
  "choose-target": (el) => {
    state.convert.target = el.dataset.v;
    state.picker = false;
    render("[data-act='open-picker']");
  },
  "convert-run": () => runConvert(),
  "convert-reset": () => {
    state.convert = {
      file: null,
      target: null,
      busy: false,
      result: null,
      error: null,
      hint: null,
    };
    render();
  },

  // PDF
  "set-op": (el) => {
    const p = state.pdf;
    p.op = el.dataset.v;
    p.result = null;
    p.error = null;
    p.hint = null;
    resetPreview();
    render(`[data-act="set-op"][data-v="${p.op}"]`);
    schedulePreview(true);
  },
  "remove-file": (el) => {
    const p = state.pdf;
    p.files = p.files.filter((f) => f.path !== el.dataset.v);
    p.result = null;
    p.error = null;
    resetPreview();
    render();
    schedulePreview(true);
  },
  "split-mode": (el) => {
    const p = state.pdf;
    p.splitMode = el.dataset.v;
    p.error = null;
    resetPreview();
    render();
    schedulePreview(true);
  },
  "set-level": (el) => {
    const p = state.pdf;
    p.level = el.dataset.v;
    p.result = null;
    p.error = null;
    render();
  },
  run: () => runPdf(),
  "result-again": () => {
    state.pdf.result = null;
    render();
  },
  "pdf-reset": () => {
    Object.assign(state.pdf, {
      files: [],
      result: null,
      error: null,
      hint: null,
    });
    resetPreview();
    render();
  },
  reveal: () => reveal(),
};

function closePicker() {
  state.picker = false;
  render("[data-act='open-picker']");
}

document.addEventListener("click", (e) => {
  // клик мимо подсказки закрывает ее
  if (
    state.help &&
    !e.target.closest("#help") &&
    !e.target.closest("[data-act='toggle-help']")
  ) {
    state.help = false;
    render();
  }
  const el = e.target.closest("[data-act]");
  if (!el || el.disabled) return;
  const action = ACTIONS[el.dataset.act];
  if (action) action(el, e);
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (state.picker) closePicker();
    else if (state.help) {
      state.help = false;
      render("[data-act='toggle-help']");
    }
    return;
  }
  // перестановка файлов с клавиатуры: фокус на "точках", стрелки вверх и вниз
  const handle = e.target.closest && e.target.closest("[data-act='handle']");
  if (handle && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
    e.preventDefault();
    const files = state.pdf.files;
    const i = Number(handle.dataset.i);
    const j = e.key === "ArrowUp" ? i - 1 : i + 1;
    if (j < 0 || j >= files.length) return;
    [files[i], files[j]] = [files[j], files[i]];
    state.pdf.result = null;
    render(`[data-act="handle"][data-i="${j}"]`);
  }
});

// поля ввода: перерисовывать все окно на каждую букву нельзя (пропадет фокус), обновляем только предпросмотр
app.addEventListener("input", (e) => {
  const p = state.pdf;
  if (e.target.id === "ranges") {
    p.ranges = e.target.value;
    p.error = null;
    schedulePreview();
  } else if (e.target.id === "every") {
    p.every = e.target.value;
    p.error = null;
    schedulePreview();
  }
});

/* ---------- Перестановка файлов мышью ---------- */
document.addEventListener("pointerdown", (e) => {
  const handle = e.target.closest && e.target.closest("[data-act='handle']");
  if (!handle || e.button !== 0) return;
  e.preventDefault();
  const rowEl = handle.closest(".row");
  const list = rowEl.parentElement;
  rowEl.classList.add("moving");

  const move = (ev) => {
    const rows = [...list.children];
    const from = rows.indexOf(rowEl);
    for (let i = 0; i < rows.length; i++) {
      if (i === from) continue;
      const box = rows[i].getBoundingClientRect();
      if (ev.clientY < box.top || ev.clientY > box.bottom) continue;
      const middle = box.top + box.height / 2;
      if (i > from && ev.clientY > middle)
        list.insertBefore(rowEl, rows[i].nextSibling);
      else if (i < from && ev.clientY < middle)
        list.insertBefore(rowEl, rows[i]);
      break;
    }
  };
  const finish = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", finish);
    const p = state.pdf;
    const order = [...list.children].map((r) => Number(r.dataset.i));
    p.files = order.map((i) => p.files[i]);
    p.result = null;
    render();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", finish);
  window.addEventListener("pointercancel", finish);
});

/* ---------- Подсветка при перетаскивании файла над окном ---------- */
let dragDepth = 0;
const hasFiles = (e) =>
  e.dataTransfer && [...(e.dataTransfer.types || [])].includes("Files");
window.addEventListener("dragenter", (e) => {
  if (!hasFiles(e)) return;
  dragDepth++;
  document.body.classList.add("dragging");
});
window.addEventListener("dragleave", (e) => {
  if (!hasFiles(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) document.body.classList.remove("dragging");
});
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove("dragging");
});

/* ---------- Старт ---------- */
window.addEventListener("pywebviewready", async () => {
  [OPS, FORMATS] = await Promise.all([api().operations(), api().formats()]);
  render();
});
