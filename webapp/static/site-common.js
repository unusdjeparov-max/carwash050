/* site-common.js — общая логика для всех страниц сайта CarWash Cloud.
   Подключается на каждой странице (кроме site-login.html) первым скриптом.
   Отвечает за:
   - проверку входа (редирект на /static/site-login.html, если токена нет)
   - обёртку fetch с заголовком X-Site-Token и обработкой 401
   - рендер сайдбара (с подсветкой активного пункта)
   - выбор активного филиала (для владельца — переключаемый, для админа/мойщика — фиксированный)
*/

const CW = (() => {
  const API = ""; // сайт и API на одном хосте

  // Тема сайта («Glass / Orb») подключается статическим <link> в <head>
  // каждой HTML-страницы (сразу после инлайн-<style>, что гарантирует
  // правильный порядок каскада) — см. webapp/static/*.html. Раньше тема
  // подключалась через JS (document.head.appendChild) отсюда, но это
  // зависело от момента выполнения скрипта и было ненадёжно
  // (могло не успеть отработать до первой отрисовки/из-за кэша браузера).

  // Тема v2 «Studio Blue» (светлая) больше не использует плавающие орбы —
  // фон теперь простой градиент в теле site-theme.css. Функция оставлена
  // пустой (а не удалена), чтобы не трогать порядок вызовов ниже.
  (function injectOrbBg() {})();

  function getToken() { return localStorage.getItem("cw_token") || ""; }
  function getName() { return localStorage.getItem("cw_name") || ""; }
  function getRole() { return localStorage.getItem("cw_role") || ""; }
  function getLoginBranch() { return localStorage.getItem("cw_branch") || ""; }

  function getActiveBranch() {
    const role = getRole();
    if (role === "владелец") {
      return localStorage.getItem("cw_active_branch") || "";
    }
    return getLoginBranch();
  }

  function setActiveBranch(branch) {
    localStorage.setItem("cw_active_branch", branch);
  }

  // ---------- мини-календарь в раскрытом сайдбаре (как в YCLIENTS) ----------
  // calViewDate — какой месяц сейчас показан в мини-календаре (сбрасывается
  // при переходе на другую страницу — обычная навигация по <a>, не SPA).
  // calSelectCallback — если текущая страница умеет сама применять выбранную
  // дату без перезагрузки (см. booking.html → CW.onCalDateSelect), клик по
  // дню в календаре вызывает этот колбэк вместо перехода на /booking.html.
  let calViewDate = null;
  let calSelectCallback = null;

  const WEEKDAYS_RU = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
  const MONTHS_RU = ["январь", "февраль", "март", "апрель", "май", "июнь",
    "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];

  function isoLocal(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function parseIsoLocal(s) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  // Дата, выбранная в мини-календаре сайдбара. По умолчанию — сегодня;
  // страница журнала записи (booking.html) синхронизирует её со своей
  // датой через setCalDate() при каждом изменении (стрелки/«Сегодня»/клик
  // по записи в сетке).
  function getCalDate() {
    const iso = localStorage.getItem("cw_cal_date");
    if (iso) {
      const d = parseIsoLocal(iso);
      if (!isNaN(d.getTime())) return d;
    }
    return new Date();
  }
  function setCalDate(d) {
    localStorage.setItem("cw_cal_date", typeof d === "string" ? d : isoLocal(d));
  }
  // Регистрирует колбэк, вызываемый при клике по дню в мини-календаре, пока
  // открыта текущая страница — чтобы обновить журнал без перезагрузки.
  // Если колбэк не зарегистрирован (мы не на booking.html), клик по дню
  // просто переходит на /static/booking.html?date=...
  function onCalDateSelect(fn) { calSelectCallback = fn; }

  function buildCalendarHtml() {
    const selected = getCalDate();
    if (!calViewDate) calViewDate = new Date(selected.getFullYear(), selected.getMonth(), 1);
    const y = calViewDate.getFullYear(), m = calViewDate.getMonth();
    const firstOfMonth = new Date(y, m, 1);
    const startOffset = (firstOfMonth.getDay() + 6) % 7; // Пн = 0 ... Вс = 6
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const daysInPrevMonth = new Date(y, m, 0).getDate();
    const today = new Date();
    const selIso = isoLocal(selected), todayIso = isoLocal(today);

    const cells = [];
    for (let i = 0; i < startOffset; i++) {
      cells.push({ day: daysInPrevMonth - startOffset + 1 + i, muted: true });
    }
    for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, date: new Date(y, m, d) });
    let nextD = 1;
    while (cells.length % 7 !== 0) cells.push({ day: nextD++, muted: true });

    const cellsHtml = cells.map(c => {
      if (!c.date) return `<div class="cal-cell muted">${c.day}</div>`;
      const iso = isoLocal(c.date);
      const cls = ["cal-cell"];
      if (iso === selIso) cls.push("selected");
      else if (iso === todayIso) cls.push("today");
      return `<div class="${cls.join(" ")}" data-date="${iso}">${c.day}</div>`;
    }).join("");

    return `
      <div class="rail-cal" id="railCal">
        <div class="rail-cal-head">
          <button type="button" class="rail-cal-nav" id="calPrevM"><i class="ti ti-chevron-left"></i></button>
          <span class="rail-cal-title">${MONTHS_RU[m]} ${y}</span>
          <button type="button" class="rail-cal-nav" id="calNextM"><i class="ti ti-chevron-right"></i></button>
        </div>
        <div class="rail-cal-weekdays">${WEEKDAYS_RU.map(w => `<span>${w}</span>`).join("")}</div>
        <div class="rail-cal-grid">${cellsHtml}</div>
      </div>`;
  }

  // Попап выбора филиала — один элемент на всё время жизни страницы,
  // подвешенный к <body> с position:fixed, чтобы не обрезаться узким
  // прокручиваемым сайдбаром (см. renderSidebar → branchSelect).
  let branchPopEl = null;
  function ensureBranchPopEl() {
    if (branchPopEl) return branchPopEl;
    branchPopEl = document.createElement("div");
    branchPopEl.className = "rail-branch-pop";
    branchPopEl.style.display = "none";
    branchPopEl.innerHTML = `
      <div class="rail-branch-pop-title">Филиалы</div>
      <div class="rail-branch-pop-list" id="branchPopList"><div class="rail-branch-pop-empty">Загрузка…</div></div>
    `;
    document.body.appendChild(branchPopEl);
    branchPopEl.addEventListener("click", (e) => e.stopPropagation());
    document.addEventListener("click", () => { branchPopEl.style.display = "none"; });
    window.addEventListener("resize", () => { branchPopEl.style.display = "none"; });
    window.addEventListener("scroll", () => { branchPopEl.style.display = "none"; }, true);
    return branchPopEl;
  }

  function requireAuth() {
    if (!getToken()) {
      window.location.href = "/static/site-login.html";
      return false;
    }
    return true;
  }

  async function authFetch(path, opts = {}) {
    const headers = Object.assign({}, opts.headers || {}, {
      "X-Site-Token": getToken(),
    });
    if (opts.body && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }
    const res = await fetch(API + path, Object.assign({}, opts, { headers }));
    if (res.status === 401) {
      logout();
      throw new Error("Сессия истекла");
    }
    let data = null;
    try { data = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) {
      const msg = (data && data.detail) || `Ошибка запроса (${res.status})`;
      throw new Error(msg);
    }
    return data;
  }

  async function downloadFile(path, filenameFallback) {
    const headers = { "X-Site-Token": getToken() };
    const res = await fetch(API + path, { headers });
    if (res.status === 401) { logout(); throw new Error("Сессия истекла"); }
    if (!res.ok) {
      let msg = `Ошибка запроса (${res.status})`;
      try { const data = await res.json(); if (data && data.detail) msg = data.detail; } catch (e) {}
      throw new Error(msg);
    }
    const blob = await res.blob();
    let filename = filenameFallback || "file";
    const disp = res.headers.get("Content-Disposition") || "";
    const m = disp.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
    if (m) { try { filename = decodeURIComponent(m[1]); } catch (e) { filename = m[1]; } }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function logout() {
    localStorage.removeItem("cw_token");
    localStorage.removeItem("cw_name");
    localStorage.removeItem("cw_role");
    localStorage.removeItem("cw_branch");
    localStorage.removeItem("cw_active_branch");
    window.location.href = "/static/site-login.html";
  }

  const NAV = [
    { group: "Обзор", items: [
      { key: "dashboard", icon: "ti-layout-dashboard", label: "Дашборд", href: "/static/dashboard.html" },
      { key: "cars", icon: "ti-car", label: "Машины", href: "/static/cars.html" },
      { key: "booking", icon: "ti-calendar-event", label: "Запись", href: "/static/booking.html" },
      { key: "cash", icon: "ti-cash", label: "Касса за смену", href: "/static/cash.html" },
    ]},
    { group: "Управление", items: [
      { key: "workers", icon: "ti-users", label: "Сотрудники", href: "/static/workers.html" },
      { key: "clients", icon: "ti-address-book", label: "Клиенты", href: "/static/clients.html" },
      { key: "loyalty", icon: "ti-heart", label: "Лояльность", href: "/static/loyalty.html" },
      { key: "finance", icon: "ti-receipt", label: "Расходы и доходы", href: "/static/finance.html" },
      { key: "reports", icon: "ti-chart-bar", label: "Отчёты", href: "/static/reports.html" },
    ]},
    { group: "Система", items: [
      { key: "history", icon: "ti-history", label: "История изменений", href: "/static/history.html", adminOnly: true },
      { key: "branches", icon: "ti-building-store", label: "Филиалы", href: "/static/branches.html", ownerOnly: true },
      { key: "settings", icon: "ti-settings", label: "Настройки", href: "/static/settings.html" },
    ]},
  ];

  function initials(name) {
    const parts = (name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "??";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  function roleLabel(role) {
    return { "мойщик": "Мойщик", "админ": "Администратор", "владелец": "Владелец" }[role] || role;
  }

  /* Верхняя навигация темы «Cloud» (утверждённый концепт).
     Рендерит шапку в #sidebarRoot (имя функции сохранено, чтобы не менять
     все страницы): логотип, белая «таблетка» навигации с голубым
     индикатором, который плавно переезжает с пункта предыдущей страницы
     на текущий, выбор филиала, выход и профиль. Подпись показывается
     только у активного пункта — у остальных иконка + title-тултип; на
     узких экранах навигация уходит второй строкой и скроллится. */
  const DROP_SVG = '<svg class="i" viewBox="0 0 24 24"><path d="M12 2.5C8 8 5.5 11 5.5 14.5a6.5 6.5 0 0 0 13 0C18.5 11 16 8 12 2.5z"/></svg>';
  function renderSidebar(activeKey) {
    const root = document.getElementById("sidebarRoot");
    if (!root) return;
    root.classList.remove("expanded");
    const role = getRole();
    const items = [].concat(...NAV.map(g => g.items)).filter(it =>
      (!it.ownerOnly || role === "владелец") && (!it.adminOnly || role === "админ" || role === "владелец"));

    let prevKey = null, prevPos = null;
    try { prevKey = sessionStorage.getItem("cw_nav_key"); prevPos = JSON.parse(sessionStorage.getItem("cw_nav_ind") || "null"); } catch (e) {}
    const firstPaint = !root.dataset.painted;
    const startKey = (firstPaint && prevKey && items.some(i => i.key === prevKey)) ? prevKey : activeKey;
    const branch = getActiveBranch();

    root.innerHTML = `
      <header class="top">
        <div class="brand" id="brandBtn"><div class="lg">${DROP_SVG}</div>CarWash</div>
        <nav class="nav" id="cwNav"><span class="ind nt"></span>
          ${items.map(it => `<a data-href="${it.href}" data-key="${it.key}" title="${it.label}" class="${it.key === startKey ? "on" : ""}"><i class="ti ${it.icon}" style="font-size:20px"></i><span>${it.label}</span></a>`).join("")}
        </nav>
        <div class="gap"></div>
        <div class="branch${role === "владелец" ? "" : " no-click"}" id="branchSelect" title="Филиал">
          <i class="ti ti-map-pin" style="font-size:16px"></i><span id="bsValueFull">${branch || "Филиал не выбран"}</span>
          ${role === "владелец" ? `<svg class="i" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>` : ""}
        </div>
        <button class="icobtn" id="logoutBtn" title="Выйти"><i class="ti ti-logout" style="font-size:19px"></i></button>
        <div class="who" title="${getName() || "—"} · ${roleLabel(role)}"><div class="av">${initials(getName())}</div><div><b>${getName() || "—"}</b><small>${roleLabel(role) || ""}</small></div></div>
      </header>`;
    root.dataset.painted = "1";

    const nav = root.querySelector("#cwNav"), ind = nav.querySelector(".ind");
    const links = [...nav.querySelectorAll("a")];
    const COLLAPSED = 46, GAP = 2, PAD = 6;
    const posFor = (key) => {           // x и ширина индикатора для пункта (в «финальном» состоянии)
      const idx = links.findIndex(a => a.dataset.key === key);
      if (idx < 0) return null;
      const lab = links[idx].querySelector("span");
      return { x: PAD + idx * (COLLAPSED + GAP), w: 40 + 20 + 8 + (lab ? lab.scrollWidth : 0) };
    };
    const place = (p) => { if (!p) { ind.style.opacity = 0; return; } ind.style.opacity = 1; ind.style.width = p.w + "px"; ind.style.transform = `translateX(${p.x}px)`; };
    const target = posFor(activeKey);
    const apply = () => {
      links.forEach(a => a.classList.toggle("on", a.dataset.key === activeKey));
      ind.classList.remove("nt"); place(target);
      const act = links.find(a => a.dataset.key === activeKey);
      if (act && target) nav.scrollTo({ left: Math.max(0, target.x - 24), behavior: "smooth" });
    };
    if (startKey !== activeKey) {
      const sp = posFor(startKey) || prevPos; place(sp); void ind.offsetWidth;
      requestAnimationFrame(() => requestAnimationFrame(apply));
    } else { place(target); void ind.offsetWidth; ind.classList.remove("nt"); }
    try { sessionStorage.setItem("cw_nav_key", activeKey); if (target) sessionStorage.setItem("cw_nav_ind", JSON.stringify(target)); } catch (e) {}

    links.forEach(a => a.addEventListener("click", () => { if (a.dataset.key !== activeKey) window.location.href = a.dataset.href; }));
    root.querySelector("#brandBtn").addEventListener("click", () => { window.location.href = "/static/dashboard.html"; });
    root.querySelector("#logoutBtn").addEventListener("click", logout);

    // ---------- попап выбора филиала (владелец) ----------
    if (role === "владелец") {
      const btn = root.querySelector("#branchSelect");
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const pop = ensureBranchPopEl();
        if (pop.style.display !== "none") { pop.style.display = "none"; return; }
        const rect = btn.getBoundingClientRect();
        pop.style.display = "block";
        pop.style.top = Math.round(rect.bottom + 10) + "px";
        pop.style.left = Math.max(12, Math.round(rect.right - pop.offsetWidth)) + "px";
      });
      authFetch("/api/config").then(cfg => {
        const current = getActiveBranch() || cfg.branches[0];
        if (!getActiveBranch()) setActiveBranch(current);
        root.querySelector("#bsValueFull").textContent = current;
        const pop = ensureBranchPopEl();
        const listEl = pop.querySelector("#branchPopList");
        listEl.innerHTML = cfg.branches.map(b => `
          <div class="rail-branch-pop-item ${b === current ? "active" : ""}" data-branch="${b}">
            <span>${b}</span>${b === current ? `<i class="ti ti-check"></i>` : ""}
          </div>`).join("");
        listEl.querySelectorAll(".rail-branch-pop-item").forEach(el => {
          el.addEventListener("click", () => { setActiveBranch(el.dataset.branch); window.location.reload(); });
        });
      }).catch(() => {
        ensureBranchPopEl().querySelector("#branchPopList").innerHTML = `<div class="rail-branch-pop-empty">Не удалось загрузить филиалы</div>`;
      });
    }
  }

  /* ---------- эффекты темы «Cloud»: подсветка за курсором, ripple, count-up, тосты ---------- */
  const _RM = window.matchMedia && matchMedia("(prefers-reduced-motion:reduce)").matches;
  const _fmt = n => Math.round(n).toLocaleString("ru-RU");
  function countUp(el) {
    const to = +el.dataset.count || 0, suffix = el.dataset.suffix || "";
    if (_RM) { el.textContent = _fmt(to) + suffix; return; }
    const t0 = performance.now(), d = 1400;
    (function f(t) { const p = Math.min(1, (t - t0) / d), e = 1 - Math.pow(1 - p, 4); el.textContent = _fmt(to * e) + suffix; if (p < 1) requestAnimationFrame(f); })(t0);
  }
  function runCounts(root) { (root || document).querySelectorAll("[data-count]").forEach(countUp); }
  function toast(msg) {
    let box = document.getElementById("cwToasts");
    if (!box) { box = document.createElement("div"); box.id = "cwToasts"; box.className = "toasts"; document.body.appendChild(box); }
    const t = document.createElement("div"); t.className = "toast";
    t.innerHTML = `<span class="ck"><svg class="i" viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg></span><span></span>`;
    t.lastChild.textContent = msg; box.appendChild(t);
    setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 400); }, 2600);
  }
  document.addEventListener("pointermove", e => {
    const c = e.target.closest && e.target.closest(".card,.panel,.stat-card,.mini-card,.branch-card");
    if (c) { const r = c.getBoundingClientRect(); c.style.setProperty("--mx", (e.clientX - r.left) + "px"); c.style.setProperty("--my", (e.clientY - r.top) + "px"); }
  });
  document.addEventListener("click", e => {
    const b = e.target.closest && e.target.closest(".btn");
    if (!b) return;
    const r = b.getBoundingClientRect(), s = Math.max(r.width, r.height) * 2, x = document.createElement("span");
    x.className = "ripple"; x.style.cssText = `width:${s}px;height:${s}px;left:${e.clientX - r.left - s / 2}px;top:${e.clientY - r.top - s / 2}px`;
    b.appendChild(x); setTimeout(() => x.remove(), 650);
  });
  window.addEventListener("load", () => runCounts());

  function money(n) {
    return (Math.round(n || 0)).toLocaleString("ru-RU") + " ₽";
  }

  function todayLabel() {
    return new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
  }

  return {
    getToken, getName, getRole, getLoginBranch,
    getActiveBranch, setActiveBranch,
    requireAuth, authFetch, downloadFile, logout,
    renderSidebar, initials, roleLabel, money, todayLabel, toast, countUp, runCounts,
    getCalDate, setCalDate, onCalDateSelect,
  };
})();
