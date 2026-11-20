"use strict";

// Состояние одной вкладки-инструмента: у "PDF-инструментов" и у "Фото" оно одинаковое по форме
function newToolState(op) {
  return {
    op,
    files: [],
    busy: false,
    result: null,
    error: null,
    hint: null,
    level: "medium",
    shrink: "medium",
    order: null,
    splitMode: "ranges", // each | ranges | every
    ranges: "",
    every: 2,
    preview: null,
    selected: new Set(),
    anchor: null,
    outName: "",
    outDir: null,
  };
}

// Состояние вкладки "Конвертация"
function newConvertState(outDir = null) {
  return {
    files: [],
    target: null,
    busy: false,
    finished: false,
    status: {}, // state: run, ok, error
    result: null,
    error: null,
    hint: null,
    outName: "",
    outDir,
  };
}

const commonTargets = (files) =>
  files.length
    ? files[0].targets.filter((t) => files.every((f) => f.targets.includes(t)))
    : [];

/* ====================================================================
    Состояние. Все, что видно в окне, рисуется из этого объекта функцией render().
    ==================================================================== */
const state = {
  tab: "convert", // "convert" | "pdf" | "photo"
  help: false, // открыта ли подсказка по форматам
  settings: {
    open: false,
    values: null,
    choices: null,
    limits: null,
    version: "",
  },
  picker: false, // открыт ли выбор формата
  convert: newConvertState(),
  pdf: newToolState("merge"),
  photo: newToolState("shrink"),
};

const tools = () => (state.tab === "photo" ? state.photo : state.pdf);
const THUMBS = {}; // пусть -> data-url миниатюры.
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

// Имя файла для показа: основа сокращается многоточием, расширение всегда видно, полное имя в подсказке
function nameHtml(name) {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  return `<span class="fname" title="${esc(name)}"><span class="base">${esc(base)}</span><span class="ext">${esc(ext)}</span></span>`;
}

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
  ".json": "#b7791f",
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
  organize:
    '<rect x="4" y="3" width="7" height="9" rx="1.2"/><rect x="13" y="12" width="7" height="9" rx="1.2"/><path d="M14 7h6M17 4l3 3-3 3"/>',
  shrink:
    '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-9 9"/>',
};

const CLOSE = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M3 3l8 8M11 3l-8 8"/></svg>`;
const CHECK = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 4.8"/></svg>`;
const ARROW = `<svg class="arrow" width="64" height="24" viewBox="0 0 64 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12h54M48 4l10 8-10 8"/></svg>`;
const DOTS = `<svg width="12" height="18" viewBox="0 0 12 18" fill="currentColor" aria-hidden="true"><circle cx="3" cy="3" r="1.5"/><circle cx="9" cy="3" r="1.5"/><circle cx="3" cy="9" r="1.5"/><circle cx="9" cy="9" r="1.5"/><circle cx="3" cy="15" r="1.5"/><circle cx="9" cy="15" r="1.5"/></svg>`;
const FOLDER = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`;
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
  ".json": "Данные",
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
  ".json": ".xlsx",
};

const OP_META = {
  merge: { title: "Объединить", desc: "Склеить в один PDF" },
  split: { title: "Разделить", desc: "Разбить на части" },
  compress: { title: "Сжать", desc: "Уменьшить размер" },
  organize: { title: "Страница", desc: "Править страницы" },
  shrink: { title: "Фото", desc: "Уменьшить снимок" },
};

// пресеты уменьшения фото: длинная сторона в пикселях и качество JPEG/WebP
const SHRINK_PRESETS = [
  {
    id: "light",
    title: "Легкое",
    desc: "До 2560 px - качество 90",
    max_side: 2560,
    quality: 90,
  },
  {
    id: "medium",
    title: "Среднее",
    desc: "До 1920 px - для экрана и почты",
    max_side: 1920,
    quality: 85,
    best: true,
  },
  {
    id: "strong",
    title: "Сильное",
    desc: "До 1280 px - для сайта и чатов",
    max_side: 1280,
    quality: 75,
  },
];

// В каком формате сохранится фото (так же решает Python): PNG и WebP остаются, остальное становится JPEG
const shrinkExt = (ext) => (ext === ".png" || ext === ".webp" ? ext : ".jpg");

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
  if (target === ".json")
    return "Каждый лист станет отдельным файлом - первая строка таблицы: название полей";
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

// Ключ миниатюры: файл + номер страницы (с нуля)
const thumbKey = (f) => `${f.path}#${f.page || 0}`;
const ICON_SIZE = { sm: 26, md: 36, lg: 60 };

// size: "sm" в строке списка, "md" в предпросмотре разделения, "lg" в результате
// Миниатюра файла: настоящая, если уже загружена, иначе значок формата
function thumb(f, size = "sm") {
  const key = thumbKey(f);
  const url = THUMBS[key];
  return `<span class="thumb ${size}" data-thumb="${esc(key)}" data-path="${esc(f.path)}" data-page="${f.page || 0}" data-rot="${f.rot || 0}" ${url ? "" : "data-lazy"}>${url ? `<img src="${url}" alt="">` : fileIcon(f.ext, ICON_SIZE[size])}</span>`;
}

// поворот миниаюотры на экране
function fitRot(el) {
  const img = el.querySelector("img");
  if (!img) return;
  const rot = Number(el.dataset.rot || 0);
  const turned = rot % 180 !== 0;
  const k = turned
    ? Math.min(
        1,
        el.clientWidth / img.offsetHeight,
        el.clientHeight / img.offsetWidth,
      )
    : 1;
  img.style.transform = rot ? `rotate(${rot}deg) scale(${k})` : "";
}

// Подгружает миниатюры по одной и вставляет в уже нарисованные места без перерисовки окна
async function loadThumbs(files) {
  for (const f of files) {
    const key = thumbKey(f);
    if (key in THUMBS || f.note) continue;
    THUMBS[key] = false; // помечаем сразу, чтобы не запросить дважды
    const r = await callApi(() => api().thumbnail(f.path, f.page || 0, 160));
    if (!r.ok) continue;
    THUMBS[key] = r.data;
    for (const el of document.querySelectorAll("[data-thumb]")) {
      if (el.dataset.thumb === key) {
        el.innerHTML = `<img src="${r.data}" alt="">`;
        fitRot(el);
      }
    }
  }
}

// Ленивая загрузка: миниатюра запрашивается, только когда ее плитка попала в видимую часть прокручиваемого блока
let thumbObserver = null;
function observeThumbs(root) {
  if (thumbObserver) thumbObserver.disconnect();
  thumbObserver = new IntersectionObserver(
    (entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        thumbObserver.unobserve(en.target);
        loadThumbs([
          {
            path: en.target.dataset.path,
            page: Number(en.target.dataset.page),
            ext: ".pdf",
          },
        ]);
      }
    },
    { root, roogMargin: "120px" },
  );
  root
    .querySelectorAll(".thumb[data-lazy")
    .forEach((el) => thumbObserver.observe(el));
}

// ---------- Увеличение миниатюры при наведении ----------
const BIG = {}; // путь -> Promise с data-URL крупной картинки (грузится один раз)
let zoomFor = null;

function zoomBox() {
  let el = document.getElementById("zoom");
  if (!el) {
    el = document.createElement("div");
    el.id = "zoom";
    el.className = "zoom";
    el.hidden = true;
    document.body.appendChild(el);
  }
  return el;
}

function hideZoom() {
  zoomFor = null;
  const el = document.getElementById("zoom");
  if (el) el.hidden = true;
}

// Копия картинки, повёрнутая на rot градусов (кратно 90)
function rotatedCopy(img, rot) {
  const turned = rot % 180 !== 0;
  const canvas = document.createElement("canvas");
  canvas.width = turned ? img.naturalHeight : img.naturalWidth;
  canvas.height = turned ? img.naturalWidth : img.naturalHeight;
  const g = canvas.getContext("2d");
  g.translate(canvas.width / 2, canvas.height / 2);
  g.rotate((rot * Math.PI) / 180);
  g.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  const copy = new Image();
  copy.src = canvas.toDataURL("image/jpeg", 0.9);
  return copy;
}

async function showZoom(target) {
  const key = target.dataset.thumb;
  if (!THUMBS[key]) return; // нет даже маленькой миниатюры: увеличивать нечего
  zoomFor = key;
  BIG[key] ??= callApi(() =>
    api().thumbnail(target.dataset.path, Number(target.dataset.page), 360),
  ).then((r) => (r.ok ? r.data : ""));
  const url = await BIG[key];
  if (!url || zoomFor !== key) return; // пока грузилось, курсор ушел
  let img = new Image();
  img.src = url;
  await img.decode();
  const rot = Number(target.dataset.rot || 0);
  if (rot) img = rotatedCopy(img, rot);
  if (zoomFor !== key) return;
  const box = zoomBox();
  box.replaceChildren(img);
  box.hidden = false;
  const r = target.getBoundingClientRect();
  const gap = 12;
  // справа от миниатюры; если не помещается, то слева; по вертикали не выходим за окно
  const left =
    r.right + gap + box.offsetWidth <= innerWidth
      ? r.right + gap
      : Math.max(8, r.left - gap - box.offsetWidth);
  const top = Math.min(
    Math.max(8, r.top + r.height / 2 - box.offsetHeight / 2),
    innerHeight - box.offsetHeight - 8,
  );
  box.style.left = `${left}px`;
  box.style.top = `${top}px`;
}

document.addEventListener("mouseover", (e) => {
  if (pageDrag && pageDrag.active) return;
  const t = e.target.closest && e.target.closest("[data-thumb]");
  if (t && !t.contains(e.relatedTarget)) showZoom(t);
});
document.addEventListener("mouseout", (e) => {
  const t = e.target.closest && e.target.closest("[data-thumb]");
  if (t && !t.contains(e.relatedTarget)) hideZoom();
});
document.addEventListener("pointerdown", hideZoom);

const sumSize = (files) =>
  formatSize(files.reduce((acc, f) => acc + f.size, 0));

// Строка "Имя + папка" для экранов, где результат еще не создан. s: state.convert или tools()
function outRow(s, defaultStem, ext, withName = true) {
  const where = s.outDir ? s.outDir.name : "Рядом с исходным";
  const tip = s.outDir
    ? s.outDir.path
    : "Результат появится в папке исходного файла";
  return `
    <div class="out">
      ${
        withName
          ? `<label class="out-name">
        <span class="lbl">Имя</span>
        <input id="outname" class="input" type="text" value="${esc(s.outName)}" placeholder="${esc(defaultStem)}" autocomplete="off" spellcheck="false">
        <span class="out-ext">${esc(ext)}</span>
      </label>`
          : `<span class="out-name"><span class="hint">Имена сохранятся прежние</span></span>`
      }
      <span class="out-folder">
        <button type="button" class="btn ghost small" data-act="pick-folder" title="${esc(tip)}">${FOLDER}<span class="where">${esc(where)}</span></button>
        ${s.outDir ? `<button type="button" class="icon-btn" data-act="reset-folder" aria-label="Сохранять рядом с исходным">${CLOSE}</button>` : ""}
      </span>
    </div>`;
}

const currentOut = () => (state.tab === "convert" ? state.convert : tools());
// [папка, имя] для вызовов Python
const outArgs = (s) => [s.outDir ? s.outDir.path : null, s.outName];

/* ====================================================================
   Экран "Конвертация"
   ==================================================================== */
function viewConvert() {
  const c = state.convert;
  if (!c.files.length) {
    return dropZone({
      title: "Перетащите файлы сюда",
      sub: "можно сразу несколько · или нажмите, чтобы выбрать",
      tags: ["Excel · CSV · JSON", "JPG · PNG · HEIC · WebP", "PDF"],
      hint: c.hint,
    });
  }
  return c.files.length === 1 ? viewConvertOne(c) : viewConvertBatch(c);
}

// Несколько файлов: список со статусом у каждого, один формат на всех
function viewConvertBatch(c) {
  const n = c.files.length;
  const noun = (k) => plural(k, ["файл", "файла", "файлов"]);
  const rows = c.files
    .map((f) => {
      const st = c.status[f.path];
      const meta = fileMeta(f);
      let text = meta.text;
      let warn = meta.warn;
      let side = c.busy
        ? ""
        : `<button type="button" class="icon-btn" data-act="convert-remove" data-v="${esc(f.path)}" aria-label="Убрать ${esc(f.name)}">${CLOSE}</button>`;
      if (st && st.state === "run")
        side = `<span class="spinner dark" aria-label="Конвертируется"></span>`;
      if (st && st.state === "ok") {
        const outs = st.outs;
        text =
          outs.length === 1
            ? `${outs[0].name} · ${outs[0].size_text}`
            : `${outs.length} ${noun(outs.length)}`;
        side = `<span class="st ok" aria-label="Готово">${CHECK}</span>`;
      }
      if (st && st.state === "error") {
        text = st.text;
        warn = true;
        side = `<span class="st err" aria-label="Ошибка">${CLOSE}</span>`;
      }
      return `
      <div class="row">
        ${fileIcon(f.ext, 34)}
        <span class="text">
          <span class="name">${nameHtml(f.name)}</span>
          <span class="meta ${warn ? "warn" : ""}">${esc(text)}</span>
        </span>
        ${side}
      </div>`;
    })
    .join("");

  const done = c.finished;
  const ok = c.files.filter(
    (f) => c.status[f.path] && c.status[f.path].state === "ok",
  ).length;
  let bottom;
  if (done) {
    const summary =
      ok === 0
        ? "Не удалось конвертировать ни один файл"
        : ok === n
          ? `Готово. ${n} ${noun(n)} в папке «${esc(c.result.folder_name)}»`
          : `Готово ${ok} из ${n}. Остальные не получились: причина у каждого в списке`;
    bottom = `
      <div class="actions">
        <div class="${ok === n ? "status-ok" : "error"}" role="status">${summary}</div>
        <div class="btns">
          ${ok ? `<button type="button" class="btn" data-act="reveal">Показать в папке</button>` : ""}
          <button type="button" class="btn ghost" data-act="convert-reset">Конвертировать еще</button>
        </div>
      </div>`;
  } else {
    const current =
      Object.values(c.status).filter((x) => x.state !== "run").length + 1;
    bottom = `
      <div class="actions">
        ${c.busy ? "" : outRow(c, "", c.target, false)}
        ${c.error ? `<div class="error" role="alert">${esc(c.error)}</div>` : ""}
        <button type="button" class="btn" data-act="convert-run" ${c.busy ? "disabled" : ""}>
          ${c.busy ? spinnerLabel(`Конвертируем ${current} из ${n}…`) : `Конвертировать ${n} ${noun(n)}`}
        </button>
      </div>`;
  }

  return `
    <div class="batch-head">
      <div class="sum">${n} ${noun(n)} · ${sumSize(c.files)}</div>
      ${
        done || c.busy
          ? ""
          : `<button type="button" class="btn ghost small" data-act="open-picker" aria-haspopup="dialog">Формат: ${esc(extLabel(c.target))} ${CHEVRON}</button>`
      }
    </div>
    <div class="list" id="files">${rows}</div>
    ${
      done || c.busy
        ? ""
        : `<button type="button" class="add" data-act="pick"><svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M7 2v10M2 7h10"/></svg>Добавить файлы</button>`
    }
    <div style="flex:1"></div>
    ${bottom}`;
}

function viewConvertOne(c) {
  const f = c.files[0];
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
          <div class="name">${one ? nameHtml(outs[0].name) : esc(`${outs.length} ${plural(outs.length, ["файл", "файла", "файлов"])}`)}</div>
          <div class="meta">${esc(one ? fileMeta(outs[0]).text : sumSize(outs))}</div>
        </div>
      </div>`;
  } else {
    targetCard = `
      <button type="button" class="card target" data-act="open-picker" aria-haspopup="dialog">
        ${fileIcon(c.target)}
        <div>
          <div class="name">${nameHtml((c.outName.trim() || stem(f.name)) + c.target)}</div>
          <span class="pick">Формат: ${esc(extLabel(c.target))} ${CHEVRON}</span>
        </div>
      </button>`;
  }

  let actions;
  if (done) {
    const n = done.outputs.length;
    actions = `
      <div class="actions">
        <div class="status-ok" role="status">${n === 1 ? `Готово. Файл сохранен в папку «${esc(done.folder_name)}»` : `Готово. Создано ${n} ${plural(n, ["файл", "файла", "файлов"])} в папке «${esc(done.folder_name)}»`}</div>
        <div class="btns">
          <button type="button" class="btn" data-act="reveal">Показать в папке</button>
          <button type="button" class="btn ghost" data-act="convert-reset">Конвертировать еще</button>
        </div>
      </div>`;
  } else {
    actions = `
      <div class="actions">
        ${c.busy ? "" : outRow(c, stem(f.name), c.target)}
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
            <div class="name">${nameHtml(f.name)}</div>
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
  const tiles = commonTargets(c.files)
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
          <h2 id="picker-title">Во что превратить ${
            c.files.length === 1
              ? esc(extLabel(c.files[0].ext))
              : `${c.files.length} ${plural(c.files.length, ["файл", "файла", "файлов"])}`
          }?</h2>
          <button type="button" class="icon-btn" data-act="close-picker" aria-label="Закрыть">${CLOSE}</button>
        </header>
        <div class="grid" role="radiogroup" aria-label="Формат">${tiles}</div>
        <footer>${esc(pickerNote(c.files[0], c.target))}</footer>
      </div>
    </div>`;
}

/* ====================================================================
   Экран "PDF-инструменты"
   ==================================================================== */
const singleFile = () =>
  tools().files.find((f) => opInfo(tools().op).accepts.includes(f.ext)) || null;

function opsBig() {
  const p = tools();
  return `<div class="ops" role="radiogroup" aria-label="Операция">${[
    "merge",
    "split",
    "compress",
    "organize",
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
  const p = tools();
  return `<div class="seg wide" role="radiogroup" aria-label="Операция">${[
    "merge",
    "split",
    "compress",
    "organize",
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
  const multi = opInfo(tools().op).multi;
  if (state.tab === "photo") {
    return dropZone({
      title: "Перетащите фото сюда",
      sub: "или нажмите, чтобы выбрать",
      tags: ["JPG · PNG · HEIC · WebP"],
      hint,
    });
  }
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
        <span class="name" style="display:block;font-size:14px;font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${nameHtml(f.name)}</span>
        <span class="meta" style="display:block;font-size:12px;color:var(${meta.warn ? "--err" : "--muted"})">${esc(meta.text)}</span>
      </span>
      <button type="button" class="icon-btn" data-act="remove-file" data-v="${esc(f.path)}" aria-label="Убрать файл">${CLOSE}</button>
    </div>`;
}

function viewMerge() {
  const p = tools();
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
        ${thumb(f)}
        <span class="text">
          <span class="name">${nameHtml(f.name)}</span>
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
    ${outRow(p, `${stem(p.files[0].name)}_merged`, ".pdf")}
    <div class="footer">
      <div>
        <div class="sum">${n} ${plural(n, ["файл", "файла", "файлов"])} · ${pages} стр.</div>
        <div class="note">${ready ? "" : "Добавьте хотя бы два файла"}</div>
      </div>
      <button type="button" class="btn" data-act="run" ${ready && !p.busy ? "" : "disabled"}>${p.busy ? spinnerLabel("Объединяем…") : "Объединить"}</button>
    </div>`;
}

function splitNote() {
  const r = tools().preview;
  if (!r) return "";
  if (!r.ok) return `<span class="err" role="alert">${esc(r.error)}</span>`;
  const n = r.parts.length;
  return `Получится: ${n} ${plural(n, ["файл", "файла", "файлов"])}`;
}

// [1, 2, 3, 5, 10] -> "1-3, 5, 10"
function pagesToRanges(pages) {
  const sorted = [...pages].sort((a, b) => a - b);
  const out = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    out.push(j > i ? `${sorted[i]}-${sorted[j]}` : `${sorted[i]}`);
    i = j + 1;
  }
  return out.join(", ");
}

// Сетка всех страниц документа. В режиме диапазонов клик отмечает страницу (Shift+клик отмечает диапазон),
// в остальных режимах плитки только показывают, где пройдут разрезы
function pageGrid(f, selectable) {
  const tiles = Array.from({ length: f.pages || 0 }, (_, i) => {
    const n = i + 1;
    const on = selectable && tools().selected.has(n);
    const act = selectable ? `data-act="toggle-page"` : "";
    return `<button type="button" class="pg ${on ? "on" : ""}" ${act} data-v="${n}" aria-pressed="${on}" aria-label="Страница ${n}">${thumb({ path: f.path, page: i, ext: ".pdf" }, "md")}<span class="n">${n}</span></button>`;
  }).join("");
  return `<div id="pagegrid" class="pagegrid">${tiles}</div>`;
}

// Разрезы на сетке: полоска слева у первой страницы каждой части, а в режиме "по N" части ещё и чередуются по цвету
function syncCuts() {
  const p = tools();
  const grid = document.getElementById("pagegrid");
  if (!grid || p.op !== "split") return;
  const parts = p.preview && p.preview.ok ? p.preview.parts : [];
  const partOf = new Map();
  parts.forEach((x, idx) => {
    for (let n = x.first; n <= x.last; n++) partOf.set(n, idx);
  });
  const starts = new Set(parts.map((x) => x.first));
  for (const el of grid.querySelectorAll(".pg")) {
    const n = Number(el.dataset.v);
    el.classList.toggle("cut", starts.has(n) && n > 1);
    el.classList.toggle(
      "pa",
      p.splitMode === "every" && partOf.has(n) && partOf.get(n) % 2 === 0,
    );
    el.classList.toggle(
      "pb",
      p.splitMode === "every" && partOf.has(n) && partOf.get(n) % 2 === 1,
    );
  }
}

// Подсветка сетки по состоянию p.selected (без перерисовки: иначе сбросится прокрутка)
function syncGrid() {
  const sel = tools().selected;
  for (const el of document.querySelectorAll("#pagegrid .pg")) {
    const on = sel.has(Number(el.dataset.v));
    el.classList.toggle("on", on);
    el.setAttribute("aria-pressed", String(on));
  }
}

// ---------- Организатор страниц --------
const ROT_LEFT = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6V2.5M3 6h3.5M3.4 6A5.5 5.5 0 1 1 2.6 9.5"/></svg>`;
const ROT_RIGHT = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 6V2.5M13 6H9.5M12.6 6A5.5 5.5 0 1 0 13.4 9.5"/></svg>`;

// p.order: страницы результата в нужном порядке. Сначала все страницы по порядку; удаление убирает их из списка
function ensureOrder(f) {
  const p = tools();
  if (!p.order)
    p.order = Array.from({ length: f.pages || 0 }, (_, i) => ({
      page: i + 1,
      rotate: 0,
    }));
  return p.order;
}

const orgChanged = (f) => {
  const order = tools().order || [];
  return (
    order.length !== f.pages ||
    order.some((x, i) => x.page !== i + 1 || x.rotate)
  );
};

function orgTiles(f) {
  const p = tools();
  return ensureOrder(f)
    .map((x, i) => {
      const on = p.selected.has(x.page);
      const title =
        x.page === i + 1
          ? `Страница ${i + 1}`
          : `Страница ${i + 1} (была ${x.page})`;
      return `<button type="button" class="pg ${on ? "on" : ""}" data-act="org-toggle" data-v="${x.page}" aria-pressed="${on}" aria-label="${title}" title="${title}">${thumb({ path: f.path, page: x.page - 1, ext: ".pdf", rot: x.rotate }, "md")}<span class="n">${i + 1}</span></button>`;
    })
    .join("");
}

function viewOrganize(f) {
  const p = tools();
  ensureOrder(f);
  return `
    ${singleRow(f)}
    <div class="org-bar">
      <span class="org-sum" id="org-sum"></span>
      <button type="button" class="btn ghost small" id="org-all" data-act="org-all"></button>
      <button type="button" class="btn ghost small icon" id="org-left" data-act="org-rotate" data-v="-90" aria-label="Повернуть выбранные влево" title="Повернуть влево">${ROT_LEFT}</button>
      <button type="button" class="btn ghost small icon" id="org-right" data-act="org-rotate" data-v="90" aria-label="Повернуть выбранные вправо" title="Повернуть вправо">${ROT_RIGHT}</button>
      <button type="button" class="btn ghost small danger" id="org-delete" data-act="org-delete">Удалить</button>
      <button type="button" class="btn ghost small" id="org-reset" data-act="org-reset">Вернуть все</button>
    </div>
    <div id="pagegrid" class="pagegrid">${orgTiles(f)}</div>
    ${p.error ? `<div class="error left" role="alert">${esc(p.error)}</div>` : ""}
    ${outRow(p, `${stem(f.name)}_edited`, ".pdf")}
    <div class="footer">
      <div class="note">Исходный файл не изменится</div>
      <button type="button" class="btn" id="run" data-act="run">${p.busy ? spinnerLabel("Сохраняем…") : "Сохранить"}</button>
    </div>`;
}

// Счетчики, подписи и доступность кнопок организатора (без перерисовки окна: иначе сбросится прокрутка сетки)
function syncOrgBar() {
  const p = tools();
  const f = singleFile();
  if (p.op !== "organize" || !f || !p.order) return;
  const k = p.selected.size;
  const all = k === p.order.length && k > 0;
  const set = (id, fn) => {
    const el = document.getElementById(id);
    if (el) fn(el);
  };
  set(
    "org-sum",
    (el) =>
      (el.textContent = `Страниц: ${p.order.length} из ${f.pages}${k ? ` · выбрано ${k}` : ""}`),
  );
  set(
    "org-all",
    (el) => (el.textContent = all ? "Снять выбор" : "Выбрать все"),
  );
  for (const id of ["org-left", "org-right"])
    set(id, (el) => (el.disabled = !k));
  for (const tile of document.querySelectorAll("#pagegrid .thumb")) {
    // поворот у каждой плитки берём из списка: его мог изменить поворот, удаление или «Вернуть всё»
    const item = p.order.find(
      (x) => x.page === Number(tile.closest(".pg").dataset.v),
    );
    tile.dataset.rot = item ? item.rotate : 0;
    fitRot(tile); // повторный вызов безопасен: результат зависит только от размера картинки и поворота
  }
  set("org-delete", (el) => {
    el.disabled = !k || k === p.order.length; // нельзя удалить все страницы
    el.textContent = k ? `Удалить (${k})` : "Удалить";
  });
  set("org-reset", (el) => (el.hidden = !orgChanged(f)));
  set(
    "run",
    (el) => (el.disabled = p.busy || !p.order.length || !orgChanged(f)),
  );
  syncGrid();
}

// Структура списка изменилась (удалили страницы): пересобираем плитки, сохраняя прокрутку
function rebuildOrg() {
  const grid = document.getElementById("pagegrid");
  const f = singleFile();
  if (!grid || !f) return render();
  const top = grid.scrollTop;
  grid.innerHTML = orgTiles(f);
  grid.scrollTop = top;
  observeThumbs(grid);
  syncOrgBar();
}

function viewSplit(f) {
  const p = tools();
  const modes = [
    ["each", "Каждая страница"],
    ["ranges", "По диапазонам"],
    ["every", "По N страниц"],
  ];
  let input = "";
  if (p.splitMode === "ranges") {
    input = `<input id="ranges" class="input" type="text" value="${esc(p.ranges)}" placeholder="1-3, 5, 11-" title="Пустой конец означает «до конца»: 11-" aria-label="Диапазоны страниц" autocomplete="off" spellcheck="false">`;
  } else if (p.splitMode === "every") {
    input = `<input id="every" class="input short" type="number" min="1" value="${esc(p.every)}" aria-label="Страниц в каждой части">`;
  }
  const ok = p.preview && p.preview.ok;
  return `
    ${singleRow(f)}
    <div class="split-bar">
      <div class="seg small" role="radiogroup" aria-label="Как разделить">${modes
        .map(
          ([id, label]) =>
            `<button type="button" role="radio" aria-checked="${p.splitMode === id}" data-act="split-mode" data-v="${id}">${label}</button>`,
        )
        .join("")}</div>
      ${input}
    </div>
    ${pageGrid(f, p.splitMode === "ranges")}
    ${p.error ? `<div class="error left" role="alert">${esc(p.error)}</div>` : ""}
    ${outRow(p, stem(f.name), ".pdf")}
    <div class="footer">
      <div class="note" id="splitnote">${splitNote()}</div>
      <button type="button" class="btn" id="run" data-act="run" ${ok && !p.busy ? "" : "disabled"}>${p.busy ? spinnerLabel("Делим…") : "Разделить"}</button>
    </div>`;
}

function viewCompress(f) {
  const p = tools();
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
    : `<div class="note"></div>
       <button type="button" class="btn" data-act="run" ${p.busy ? "disabled" : ""}>${p.busy ? spinnerLabel("Сжимаем…") : "Сжать"}</button>`;

  return `
    ${singleRow(f)}
    <div class="levels" role="radiogroup" aria-label="Уровень сжатия">${levels}</div>
    ${middle}
    ${p.error ? `<div class="error left" role="alert">${esc(p.error)}</div>` : ""}
    <div style="flex:1"></div>
    ${r ? "" : outRow(p, `${stem(f.name)}_compressed`, ".pdf")}
    <div class="footer">${footer}</div>`;
}

function viewPhoto() {
  const f = singleFile();
  return f ? viewShrink(f) : pdfDropZone(tools().hint);
}

function viewShrink(f) {
  const p = tools();
  const r = p.result;
  const ext = shrinkExt(f.ext);
  const presets = SHRINK_PRESETS.map(
    (l) => `
    <button type="button" class="level" role="radio" aria-checked="${p.shrink === l.id}" data-act="set-shrink" data-v="${l.id}">
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
        <div class="note">${esc(f.dims || "")}${f.dims && out.dims ? " → " : ""}${esc(out.dims || "")}${r.saved_percent === 0 ? " · Файл и так легкий: оставили как есть" : ""}</div>
      </div>`;
  }

  const footer = r
    ? `<button type="button" class="btn ghost" data-act="result-again">Заново</button>
       <button type="button" class="btn" data-act="reveal">Показать в папке</button>`
    : `<div class="note">${ext === ".png" ? "PNG сохраняется без потерь, меняется только размер" : ""}</div>
       <button type="button" class="btn" data-act="run" ${p.busy ? "disabled" : ""}>${p.busy ? spinnerLabel("Уменьшаем…") : "Уменьшить"}</button>`;

  return `
    ${singleRow(f)}
    <div class="levels" role="radiogroup" aria-label="Насколько уменьшить">${presets}</div>
    ${middle}
    ${p.error ? `<div class="error left" role="alert">${esc(p.error)}</div>` : ""}
    <div style="flex:1"></div>
    ${r ? "" : outRow(p, `${stem(f.name)}_small`, ext)}
    <div class="footer">${footer}</div>`;
}

function viewDoneList() {
  const p = tools();
  const outs = p.result.outputs;
  const n = outs.length;
  return `
    <div class="done-box" role="status">
      <div class="head"><span class="check">${CHECK}</span>${
        n === 1
          ? `Файл создан в папке «${esc(p.result.folder_name)}»`
          : `Создано ${n} ${plural(n, ["файл", "файла", "файлов"])} в папке «${esc(p.result.folder_name)}»`
      }</div>
      <div class="gallery">${outs
        .map(
          (o) => `
        <div class="out-tile">
          ${thumb(o, "lg")}
          <span class="nm">${nameHtml(o.name)}</span>
          <span class="mt">${o.pages ? o.pages + " стр. · " : ""}${esc(o.size_text)}</span>
        </div>`,
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
  const p = tools();
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
  if (p.op === "organize")
    return head + (p.result ? viewDoneList() : viewOrganize(f));
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

const GEAR = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M2.5 5h11M2.5 11h11"/><circle cx="6" cy="5" r="1.9" fill="var(--surface)"/><circle cx="10.5" cy="11" r="1.9" fill="var(--surface)"/></svg>`;

// Панель настроек: изменения сохраняются сразу и действуют на все следующие конвертации
function viewSettings() {
  const s = state.settings;
  if (!s.values) return "";
  const v = s.values;
  // значение кладём в data-v как JSON: так числа остаются числами, а Tab не теряется
  const seg = (key, options, label) =>
    `<div class="seg small" role="radiogroup" aria-label="${label}">${options
      .map(
        ([val, text]) =>
          `<button type="button" role="radio" aria-checked="${v[key] === val}" data-act="set-setting" data-k="${key}" data-v="${esc(JSON.stringify(val))}">${text}</button>`,
      )
      .join("")}</div>`;
  const [qMin, qMax] = s.limits.quality;
  return `<div class="popover wide" id="settings" role="dialog" aria-label="Настройки" ${s.open ? "" : "hidden"}>
    <h3>Настройки</h3>
    <div class="setting">
      <div class="lbl">Разделитель в CSV</div>
      ${seg(
        "delimiter",
        s.choices.delimiter.map((d) => [d, d === "\t" ? "Tab" : d]),
        "Разделитель в CSV",
      )}
      <div class="sub">Русский Excel открывает CSV с «;» без лишних действий</div>
    </div>
    <div class="setting">
      <div class="lbl">Качество JPG и WebP <output id="set-quality-val">${v.quality}</output></div>
      <input id="set-quality" class="range" type="range" min="${qMin}" max="${qMax}" step="1" value="${v.quality}" aria-label="Качество JPG и WebP">
      <div class="sub">Чем ниже, тем меньше файл. В «Фото» качество задаёт выбранный вариант</div>
    </div>
    <div class="setting">
      <div class="lbl">Разрешение при PDF → картинка</div>
      ${seg(
        "dpi",
        s.choices.dpi.map((d) => [d, String(d)]),
        "Разрешение в DPI",
      )}
      <div class="sub">Больше DPI: чётче и тяжелее файл</div>
    </div>
    <div class="setting">
      <div class="lbl">Проверять обновления при запуске</div>
      ${seg(
        "check_updates",
        [
          [true, "Вкл"],
          [false, "Выкл"],
        ],
        "Проверять обновления",
      )}
      <div class="sub">Версия ${esc(s.version)}.
        <button type="button" class="link-btn" data-act="check-now">Проверить сейчас</button></div>
    </div>
    <div class="setting-foot"><button type="button" class="btn ghost small" data-act="reset-settings">Сбросить настройки</button></div>
  </div>`;
}

// Баннер о новой версии: показывается над содержимым вкладки, пока пользователь не нажмёт "Позже"
function viewUpdate() {
  const u = state.update;
  if (!u) return "";
  return `<div class="update-bar" role="status">
    <span>Вышла версия <b>${esc(u.version)}</b></span>
    <span class="update-btns">
      <button type="button" class="btn small" data-act="update-download">Скачать</button>
      <button type="button" class="btn ghost small" data-act="update-later">Позже</button>
    </span>
  </div>`;
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
  hideZoom();
  const key = focusKey || focusKeyOf(document.activeElement);
  const tabs = [
    ["convert", "Конвертация"],
    ["pdf", "PDF-инструменты"],
    ["photo", "Фото"],
  ]
    .map(
      ([id, label]) =>
        `<button type="button" role="tab" aria-selected="${state.tab === id}" data-act="set-tab" data-v="${id}">${label}</button>`,
    )
    .join("");

  app.innerHTML = `
    <div class="topbar">
      <div class="seg" role="tablist">${tabs}</div>
        <div class="topbtns">
          <button type="button" class="help-btn" data-act="toggle-settings" aria-label="Настройки" aria-expanded="${state.settings.open}">${GEAR}</button>
          <button type="button" class="help-btn" data-act="toggle-help" aria-label="Поддерживаемые форматы" aria-expanded="${state.help}">?</button>
        </div>
        ${viewHelp()}
        ${viewSettings()}
    </div>
    ${viewUpdate()}
    <div class="view">${state.tab === "convert" ? viewConvert() : state.tab === "photo" ? viewPhoto() : viewPdf()}</div>
    ${state.picker ? viewPicker() : ""}`;

  const lazyRoot =
    document.getElementById("pagegrid") ||
    document.getElementById("preview") ||
    document.querySelector(".done-box .gallery");
  if (lazyRoot) observeThumbs(lazyRoot);
  syncCuts();
  syncOrgBar();
  if (key) {
    const target = app.querySelector(key);
    if (target) target.focus({ preventScroll: true });
  }
}

function applySettings(r) {
  Object.assign(state.settings, {
    values: r.values,
    choices: r.choices,
    limits: r.limits,
  });
}

async function saveSettings(values) {
  const r = await callApi(() => api().save_settings(values));
  if (r.ok) return;
  toast(r.error);
  const fresh = await callApi(() => api().get_settings());
  if (fresh.ok) applySettings(fresh);
  render();
}

let settingsTimer;

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
function addConvertFiles(files) {
  const c = state.convert;
  if (c.finished) Object.assign(c, newConvertState(c.outDir));
  let unsupported = 0;
  let mixed = 0;
  for (const f of files) {
    if (!f.targets.length) unsupported++;
    else if (c.files.some((x) => x.path === f.path)) continue;
    else if (!commonTargets([...c.files, f]).length) mixed++;
    else c.files.push(f);
  }
  if (mixed)
    toast(
      `Пропущено: ${mixed} ${plural(mixed, ["файл", "файла", "файлов"])}. Для них нет общего формата с остальными`,
    );
  if (!c.files.length) {
    c.hint = unsupported
      ? `Формат ${extLabel(files[0].ext) || "этого файла"} пока не поддерживается`
      : c.hint;
    render();
    return;
  }
  const targets = commonTargets(c.files);
  if (!targets.includes(c.target)) {
    const first = c.files[0];
    c.target = targets.includes(DEFAULT_TARGET[first.ext])
      ? DEFAULT_TARGET[first.ext]
      : targets[0];
  }
  if (c.files.length > 1) c.outName = "";
  c.result = null;
  c.status = {};
  c.error = null;
  c.hint = null;
  render();
}

function addPdfFiles(files) {
  const p = tools();
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
  loadThumbs(accepted);
}

function addFiles(files) {
  if (!files || !files.length) return;
  if (state.convert.busy || state.pdf.busy || state.photo.busy) return;
  state.picker = false;
  if (state.tab === "convert") addConvertFiles(files);
  else addPdfFiles(files);
}

// Эту функцию вызывает Python, когда файлы брошены в окно
window.onFilesDropped = (files) => addFiles(files);

async function pickFiles() {
  if (!window.pywebview) return;
  const multi = state.tab === "convert" || opInfo(tools().op).multi;
  const accept = state.tab !== "convert" ? opInfo(tools().op).accepts : null;
  addFiles(await api().pick_files(accept, multi));
}

/* ====================================================================
   Предпросмотр разделения
   ==================================================================== */
let previewTimer = null;
let previewSeq = 0;

function splitOptions() {
  const p = tools();
  if (p.splitMode === "each") return { every: 1 };
  if (p.splitMode === "every")
    return { every: Math.max(1, parseInt(p.every, 10) || 1) };
  return { ranges: p.ranges.trim() };
}

function resetPreview() {
  tools().preview = null;
  tools().selected = new Set();
  tools().anchor = null;
  tools().order = null;
  previewSeq++; // ответ на прежний запрос больше не нужен
}

function updatePreview() {
  const p = tools();
  const note = document.getElementById("splitnote");
  if (note) note.innerHTML = splitNote();
  if (p.splitMode === "ranges") {
    // выделение в сетке следует за текстом в поле: пустое поле снимает всё, верный текст отмечает его страницы
    if (!p.ranges.trim()) p.selected = new Set();
    else if (p.preview && p.preview.ok) {
      p.selected = new Set(
        p.preview.parts.flatMap((x) =>
          Array.from({ length: x.last - x.first + 1 }, (_, k) => x.first + k),
        ),
      );
    }
    syncGrid();
  }
  syncCuts();
  const run = document.getElementById("run");
  if (run && p.op === "split")
    run.disabled = !(p.preview && p.preview.ok) || p.busy;
}

function schedulePreview(immediate = false) {
  clearTimeout(previewTimer);
  const p = tools();
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
        r = await api().split_preview(f.path, splitOptions(), p.outName);
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
  c.status = {};
  render();

  if (c.files.length === 1) {
    const r = await callApi(() =>
      api().convert(c.files[0].path, c.target, {}, ...outArgs(c)),
    );
    c.busy = false;
    c.finished = Boolean(r.ok);
    if (r.ok) c.result = r;
    else c.error = r.error;
    render("[data-act='reveal']");
    return;
  }

  // Партия: файлы по очереди, чтобы видеть, какой готов. Ошибка одного не останавливает остальные
  const outputs = [];
  let folderName = "";
  for (const f of c.files) {
    c.status[f.path] = { state: "run" };
    render();
    const r = await callApi(() =>
      api().convert(f.path, c.target, {}, c.outDir ? c.outDir.path : null, ""),
    );
    if (r.ok) {
      c.status[f.path] = { state: "ok", outs: r.outputs };
      outputs.push(...r.outputs);
      folderName = r.folder_name;
    } else {
      c.status[f.path] = { state: "error", text: r.error };
    }
  }
  c.busy = false;
  c.finished = true;
  c.result = outputs.length ? { outputs, folder_name: folderName } : null;
  render("[data-act='reveal']");
}

async function runPdf() {
  const p = tools();
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
        ...outArgs(p),
      ),
    );
  } else if (p.op === "split") {
    r = await callApi(() =>
      api().run_tool(
        "split",
        [singleFile().path],
        splitOptions(),
        ...outArgs(p),
      ),
    );
  } else if (p.op === "organize") {
    r = await callApi(() =>
      api().run_tool(
        "organize",
        [singleFile().path],
        { pages: p.order },
        ...outArgs(p),
      ),
    );
  } else if (p.op === "shrink") {
    const preset = SHRINK_PRESETS.find((x) => x.id === p.shrink);
    r = await callApi(() =>
      api().run_tool(
        "shrink",
        [singleFile().path],
        { max_side: preset.max_side, quality: preset.quality },
        ...outArgs(p),
      ),
    );
  } else {
    r = await callApi(() =>
      api().run_tool(
        "compress",
        [singleFile().path],
        { level: p.level },
        ...outArgs(p),
      ),
    );
  }
  p.busy = false;
  if (r.ok) p.result = r;
  else p.error = r.error;
  render("[data-act='reveal']");
}

function reveal() {
  const result = currentOut().result;
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
    state.settings.open = false;
    render("[data-act='toggle-help']");
  },
  "toggle-settings": () => {
    state.settings.open = !state.settings.open;
    state.help = false;
    render("[data-act='toggle-settings']");
  },
  "set-setting": async (el) => {
    const key = el.dataset.k;
    const value = JSON.parse(el.dataset.v);
    state.settings.values[key] = value; // сразу показываем выбор, а сохраняем следом
    render(
      `[data-act="set-setting"][data-k="${key}"][data-v="${CSS.escape(el.dataset.v)}"]`,
    );
    await saveSettings({ [key]: value });
  },
  "reset-settings": async () => {
    const r = await callApi(() => api().reset_settings());
    if (r.ok) applySettings(r);
    else toast(r.error);
    render("[data-act='reset-settings']");
  },
  "update-download": async () => {
    const r = await callApi(() => api().open_release(state.update.url));
    if (!r.ok) toast(r.error);
  },
  "update-later": async () => {
    const version = state.update.version;
    state.update = null;
    render();
    await callApi(() => api().skip_update(version)); // запомнили: про эту версию больше не напоминаем
  },
  "check-now": async () => {
    const r = await callApi(() => api().check_updates(true));
    if (!r.ok) return toast(r.error);
    if (r.update) {
      state.update = r.update;
      state.settings.open = false;
      render();
    } else {
      toast("У вас последняя версия");
    }
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
    state.convert = newConvertState(state.convert.outDir);
    render();
  },
  "convert-remove": (el) => {
    const c = state.convert;
    c.files = c.files.filter((f) => f.path !== el.dataset.v);
    if (!c.files.length) {
      state.convert = newConvertState(c.outDir);
    } else if (!commonTargets(c.files).includes(c.target)) {
      c.target = commonTargets(c.files)[0];
    }
    render();
  },
  // PDF
  "set-op": (el) => {
    const p = tools();
    p.op = el.dataset.v;
    p.outName = "";
    p.result = null;
    p.error = null;
    p.hint = null;
    resetPreview();
    render(`[data-act="set-op"][data-v="${p.op}"]`);
    schedulePreview(true);
  },
  "remove-file": (el) => {
    const p = tools();
    p.files = p.files.filter((f) => f.path !== el.dataset.v);
    p.result = null;
    p.error = null;
    resetPreview();
    render();
    schedulePreview(true);
  },
  "split-mode": (el) => {
    const p = tools();
    p.splitMode = el.dataset.v;
    p.error = null;
    resetPreview();
    render(`[data-act="split-mode"][data-v="${p.splitMode}"]`);
    schedulePreview(true);
  },
  "toggle-page": (el, e) => {
    const p = tools();
    const n = Number(el.dataset.v);
    if (e.shiftKey && p.anchor) {
      const [a, b] = [Math.min(p.anchor, n), Math.max(p.anchor, n)];
      for (let i = a; i <= b; i++) p.selected.add(i);
    } else {
      if (p.selected.has(n)) p.selected.delete(n);
      else p.selected.add(n);
      p.anchor = n;
    }
    p.ranges = pagesToRanges(p.selected);
    p.error = null;
    const input = document.getElementById("ranges");
    if (input) input.value = p.ranges;
    syncGrid();
    schedulePreview(true);
  },
  "set-level": (el) => {
    const p = tools();
    p.level = el.dataset.v;
    p.result = null;
    p.error = null;
    render();
  },
  "org-toggle": (el, e) => {
    const p = tools();
    const n = Number(el.dataset.v);
    const pos = (page) => p.order.findIndex((x) => x.page === page);
    if (e.shiftKey && p.anchor && pos(p.anchor) >= 0) {
      const [a, b] = [pos(p.anchor), pos(n)].sort((x, y) => x - y);
      for (let i = a; i <= b; i++) p.selected.add(p.order[i].page);
    } else {
      if (p.selected.has(n)) p.selected.delete(n);
      else p.selected.add(n);
      p.anchor = n;
    }
    p.error = null;
    syncOrgBar();
  },
  "org-all": () => {
    const p = tools();
    p.selected =
      p.selected.size === p.order.length
        ? new Set()
        : new Set(p.order.map((x) => x.page));
    p.anchor = null;
    syncOrgBar();
  },
  "org-rotate": (el) => {
    const p = tools();
    const turn = Number(el.dataset.v);
    for (const x of p.order)
      if (p.selected.has(x.page)) x.rotate = (x.rotate + turn + 360) % 360;
    syncOrgBar();
  },
  "org-delete": () => {
    const p = tools();
    if (!p.selected.size || p.selected.size === p.order.length) return;
    p.order = p.order.filter((x) => !p.selected.has(x.page));
    p.selected = new Set();
    p.anchor = null;
    rebuildOrg();
  },
  "org-reset": () => {
    const p = tools();
    p.order = null;
    p.selected = new Set();
    p.anchor = null;
    rebuildOrg();
  },
  "set-shrink": (el) => {
    const p = tools();
    p.shrink = el.dataset.v;
    p.result = null;
    p.error = null;
    render();
  },
  run: () => runPdf(),
  "result-again": () => {
    tools().result = null;
    render();
  },
  "pdf-reset": () => {
    Object.assign(tools(), {
      files: [],
      result: null,
      error: null,
      hint: null,
      outName: "",
    });
    resetPreview();
    render();
  },
  "pick-folder": async () => {
    if (!window.pywebview) return;
    const folder = await api().pick_folder();
    if (!folder) return;
    const s = currentOut();
    s.outDir = folder;
    s.error = null;
    render("[data-act='pick-folder']");
  },
  "reset-folder": () => {
    currentOut().outDir = null;
    render("[data-act='pick-folder']");
  },
  reveal: () => reveal(),
};

function closePicker() {
  state.picker = false;
  render("[data-act='open-picker']");
}

document.addEventListener("click", (e) => {
  // клик мимо подсказки закрывает ее
  const outside = (id, toggle) =>
    !e.target.closest(id) && !e.target.closest(toggle);
  if (state.help && outside("#help", "[data-act='toggle-help']")) {
    state.help = false;
    render();
  }
  if (
    state.settings.open &&
    outside("#setting", "[data-act='toggle-settings']")
  ) {
    state.settings.open = false;
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
    } else if (state.settings.open) {
      state.settings.open = false;
      render("[data-act='toggle-settings']");
    }
    return;
  }
  // перестановка файлов с клавиатуры: фокус на "точках", стрелки вверх и вниз
  const handle = e.target.closest && e.target.closest("[data-act='handle']");
  if (handle && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
    e.preventDefault();
    const files = tools().files;
    const i = Number(handle.dataset.i);
    const j = e.key === "ArrowUp" ? i - 1 : i + 1;
    if (j < 0 || j >= files.length) return;
    [files[i], files[j]] = [files[j], files[i]];
    tools().result = null;
    render(`[data-act="handle"][data-i="${j}"]`);
  }
});

// поля ввода: перерисовывать все окно на каждую букву нельзя (пропадет фокус), обновляем только предпросмотр
app.addEventListener("input", (e) => {
  const p = tools();
  if (e.target.id === "ranges") {
    p.ranges = e.target.value;
    p.error = null;
    schedulePreview();
  } else if (e.target.id === "every") {
    p.every = e.target.value;
    p.error = null;
    schedulePreview();
  } else if (e.target.id == "set-quality") {
    // перерисовывать нельзя (ползунок потеряет фаоус), поэтому обновляем только число; когда рука осталивалсь
    const q = Number(e.target.value);
    state.settings.values.quality = q;
    document.getElementById("set-quality-val").textContent = q;
    clearTimeout(settingsTimer);
    settingsTimer = setTimeout(() => saveSettings({ quality: q }), 300);
  } else if (e.target.id === "outname") {
    const s = currentOut();
    s.outName = e.target.value;
    s.error = null;
    if (state.tab === "convert") {
      // перерисовывать окно нельзя (пропадет фокус), поэтому обновляем только имя в карточке
      const name = document.querySelector(".card.target .name");
      if (name)
        name.innerHTML = nameHtml(
          (s.outName.trim() || stem(s.files[0].name)) + s.target,
        );
    } else {
      schedulePreview();
    }
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
    const p = tools();
    const order = [...list.children].map((r) => Number(r.dataset.i));
    p.files = order.map((i) => p.files[i]);
    p.result = null;
    render();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", finish);
  window.addEventListener("pointercancel", finish);
});

/* ---------- Перестановка страниц в организаторе ---------- */
let pageDrag = null; // перетаскивание в процессе: {page, moving, x, y, active, ghost, target, ...}
let suppressClick = false; // сразу после перетаскивания клик по плитке не должен менять выделение

// Новый порядок страниц: страницы из moving переезжают к странице targetPage (перед ней или после)
function moveInOrder(order, moving, targetPage, after) {
  const rest = order.filter((x) => !moving.has(x.page));
  const moved = order.filter((x) => moving.has(x.page));
  let at = rest.findIndex((x) => x.page === targetPage);
  if (at < 0) return order;
  if (after) at++;
  return [...rest.slice(0, at), ...moved, ...rest.slice(at)];
}

document.addEventListener("pointerdown", (e) => {
  const tile =
    e.target.closest &&
    e.target.closest("#pagegrid .pg[data-act='org-toggle']");
  if (!tile || e.button !== 0 || tools().op !== "organize") return;
  const p = tools();
  const page = Number(tile.dataset.v);
  // за отмеченную страницу едут все отмеченные, за неотмеченную только она сама
  const moving = p.selected.has(page) ? new Set(p.selected) : new Set([page]);
  pageDrag = {
    tile,
    moving,
    startX: e.clientX,
    startY: e.clientY,
    x: e.clientX,
    y: e.clientY,
    active: false,
    ghost: null,
    target: null,
    targetEl: null,
    raf: 0,
  };
  window.addEventListener("pointermove", dragMove);
  window.addEventListener("pointerup", dragEnd);
  window.addEventListener("pointercancel", dragCancel);
});

function dragMove(e) {
  const d = pageDrag;
  if (!d) return;
  d.x = e.clientX;
  d.y = e.clientY;
  if (!d.active) {
    if (Math.hypot(d.x - d.startX, d.y - d.startY) < 6) return; // пока это обычный клик
    startPageDrag(d);
  }
  d.ghost.style.left = `${d.x}px`;
  d.ghost.style.top = `${d.y}px`;
  updateDropTarget(d);
}

function startPageDrag(d) {
  d.active = true;
  hideZoom();
  document.body.classList.add("page-drag");
  for (const el of document.querySelectorAll("#pagegrid .pg")) {
    el.classList.toggle("lifted", d.moving.has(Number(el.dataset.v)));
  }
  const ghost = document.createElement("div");
  ghost.className = "drag-ghost";
  ghost.append(d.tile.querySelector(".thumb").cloneNode(true));
  if (d.moving.size > 1) {
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = d.moving.size;
    ghost.append(badge);
  }
  document.body.append(ghost);
  d.ghost = ghost;
  // у края сетки она сама прокручивается
  const tick = () => {
    const grid = document.getElementById("pagegrid");
    if (grid) {
      const r = grid.getBoundingClientRect();
      const edge = 40;
      let speed = 0;
      if (d.y < r.top + edge) speed = -Math.min(14, (r.top + edge - d.y) / 3);
      else if (d.y > r.bottom - edge)
        speed = Math.min(14, (d.y - (r.bottom - edge)) / 3);
      if (speed) {
        grid.scrollTop += speed;
        updateDropTarget(d); // плитки сдвинулись под курсором
      }
    }
    d.raf = requestAnimationFrame(tick);
  };
  d.raf = requestAnimationFrame(tick);
}

// Куда упадёт страница: берём ближайшую плитку (кроме едущих) и смотрим, слева или справа от её середины курсор
function updateDropTarget(d) {
  let best = null;
  let bestDist = Infinity;
  for (const el of document.querySelectorAll("#pagegrid .pg")) {
    if (d.moving.has(Number(el.dataset.v))) continue;
    const r = el.getBoundingClientRect();
    // по вертикали строже: сначала выбирается ряд
    const dist = Math.hypot(
      d.x - (r.left + r.width / 2),
      (d.y - (r.top + r.height / 2)) * 2,
    );
    if (dist < bestDist) {
      best = el;
      bestDist = dist;
    }
  }
  if (d.targetEl) d.targetEl.classList.remove("drop-before", "drop-after");
  d.targetEl = best;
  d.target = null;
  if (!best) return;
  const r = best.getBoundingClientRect();
  const after = d.x > r.left + r.width / 2;
  best.classList.add(after ? "drop-after" : "drop-before");
  d.target = { page: Number(best.dataset.v), after };
}

function endPageDrag() {
  const d = pageDrag;
  window.removeEventListener("pointermove", dragMove);
  window.removeEventListener("pointerup", dragEnd);
  window.removeEventListener("pointercancel", dragCancel);
  if (d && d.active) {
    cancelAnimationFrame(d.raf);
    if (d.ghost) d.ghost.remove();
    document.body.classList.remove("page-drag");
    for (const el of document.querySelectorAll("#pagegrid .pg")) {
      el.classList.remove("lifted", "drop-before", "drop-after");
    }
  }
  pageDrag = null;
  return d;
}

function dragEnd() {
  const d = endPageDrag();
  if (!d || !d.active) return; // обычный клик: им займётся org-toggle
  suppressClick = true;
  setTimeout(() => (suppressClick = false), 0);
  const p = tools();
  if (d.target) {
    p.order = moveInOrder(p.order, d.moving, d.target.page, d.target.after);
    rebuildOrg();
  }
}

function dragCancel() {
  endPageDrag();
}

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && pageDrag && pageDrag.active) dragCancel();
});
// клик, которым закончилось перетаскивание, до обработчиков действий не доходит
document.addEventListener(
  "click",
  (e) => {
    if (!suppressClick) return;
    e.stopPropagation();
    e.preventDefault();
    suppressClick = false;
  },
  true,
);
// браузерное перетаскивание картинки отменило бы наши pointer-события
document.addEventListener("dragstart", (e) => {
  if (e.target.closest && e.target.closest("#pagegrid")) e.preventDefault();
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
  const [ops, formats, settings] = await Promise.all([
    api().operations(),
    api().formats(),
    api().get_settings(),
  ]);
  [OPS, FORMATS] = [ops, formats];
  if (settings.ok) applySettings(settings);
  render();
  callApi(() => api().check_updates()).then((r) => {
    if (r.ok && r.update) {
      state.update = r.update;
      render();
    }
  });
});
