/* 아침 약 체크 — 앱 로직
 * Supabase 설정(config.js)이 비어 있으면 데모 모드(localStorage)로 동작한다.
 */
(() => {
  "use strict";

  const cfg = window.APP_CONFIG || {};
  const isDemo = !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY;

  // ---------- 날짜 유틸 (기기 로컬 기준) ----------
  const pad = (n) => String(n).padStart(2, "0");
  const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayStr = () => fmtDate(new Date());
  const fmtTime = (iso) => {
    const d = new Date(iso);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
  const fmtDateKorean = (dateStr) => {
    const [y, m, d] = dateStr.split("-").map(Number);
    const day = WEEKDAYS[new Date(y, m - 1, d).getDay()];
    return `${m}월 ${d}일 ${day}요일`;
  };

  // ---------- 데이터 계층 ----------
  // 공통 인터페이스: listMeds, addMed, updateMed, deactivateMed,
  //                 logsByDateRange(from,to), addLog(medId,date), removeLog(medId,date)

  const demoStore = {
    KEY: "morning-meds-demo",
    _load() {
      try {
        return JSON.parse(localStorage.getItem(this.KEY)) || { meds: [], logs: [], seq: 1 };
      } catch {
        return { meds: [], logs: [], seq: 1 };
      }
    },
    _save(db) { localStorage.setItem(this.KEY, JSON.stringify(db)); },
    async listMeds() { return this._load().meds; },
    async addMed({ name, dosage, memo }) {
      const db = this._load();
      db.meds.push({ id: db.seq++, name, dosage, memo, active: true, created_at: new Date().toISOString() });
      this._save(db);
    },
    async updateMed(id, { name, dosage, memo }) {
      const db = this._load();
      const m = db.meds.find((m) => m.id === id);
      if (m) Object.assign(m, { name, dosage, memo });
      this._save(db);
    },
    async deactivateMed(id) {
      const db = this._load();
      const m = db.meds.find((m) => m.id === id);
      if (m) m.active = false;
      this._save(db);
    },
    async logsByDateRange(from, to) {
      return this._load().logs.filter((l) => l.date >= from && l.date <= to);
    },
    async addLog(medId, date) {
      const db = this._load();
      if (!db.logs.some((l) => l.medication_id === medId && l.date === date)) {
        db.logs.push({ medication_id: medId, date, taken_at: new Date().toISOString() });
      }
      this._save(db);
    },
    async removeLog(medId, date) {
      const db = this._load();
      db.logs = db.logs.filter((l) => !(l.medication_id === medId && l.date === date));
      this._save(db);
    },
  };

  let sb = null;
  const supaStore = {
    async listMeds() {
      const { data, error } = await sb.from("medications").select("*").order("created_at");
      if (error) throw error;
      return data;
    },
    async addMed({ name, dosage, memo }) {
      const { error } = await sb.from("medications").insert({ name, dosage, memo });
      if (error) throw error;
    },
    async updateMed(id, { name, dosage, memo }) {
      const { error } = await sb.from("medications").update({ name, dosage, memo }).eq("id", id);
      if (error) throw error;
    },
    async deactivateMed(id) {
      const { error } = await sb.from("medications").update({ active: false }).eq("id", id);
      if (error) throw error;
    },
    async logsByDateRange(from, to) {
      const { data, error } = await sb.from("intake_logs").select("*").gte("date", from).lte("date", to);
      if (error) throw error;
      return data;
    },
    async addLog(medId, date) {
      // unique(medication_id, date) 이므로 중복 insert는 무시
      const { error } = await sb.from("intake_logs").upsert(
        { medication_id: medId, date, taken_at: new Date().toISOString() },
        { onConflict: "medication_id,date", ignoreDuplicates: true }
      );
      if (error) throw error;
    },
    async removeLog(medId, date) {
      const { error } = await sb.from("intake_logs").delete().eq("medication_id", medId).eq("date", date);
      if (error) throw error;
    },
  };

  const store = isDemo ? demoStore : supaStore;

  // ---------- 상태 ----------
  const state = {
    view: "today",
    meds: [],          // 전체(비활성 포함) — 과거 기록 표시에 필요
    todayLogs: [],     // 오늘 날짜 로그
    renderedDate: todayStr(),
    calMonth: new Date(), // 캘린더가 보여주는 달
    calLogs: [],
  };
  const activeMeds = () => state.meds.filter((m) => m.active);
  const medById = (id) => state.meds.find((m) => m.id === id);

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const el = {
    app: $("app"), login: $("login"), loading: $("loading"),
    demoBanner: $("demo-banner"), logoutBtn: $("logout-btn"),
    todayDate: $("today-date"), todaySummary: $("today-summary"),
    progressFill: $("progress-fill"), doneBanner: $("done-banner"),
    medCards: $("med-cards"), todayEmpty: $("today-empty"),
    calTitle: $("cal-title"), calGrid: $("cal-grid"),
    medForm: $("med-form"), medId: $("med-id"), medName: $("med-name"),
    medDosage: $("med-dosage"), medMemo: $("med-memo"),
    medSave: $("med-save"), medCancel: $("med-cancel"),
    medList: $("med-list"), manageEmpty: $("manage-empty"),
    dayModal: $("day-modal"), dayModalTitle: $("day-modal-title"), dayModalList: $("day-modal-list"),
    loginForm: $("login-form"), loginError: $("login-error"),
  };

  // ---------- 렌더: 오늘 ----------
  async function loadToday() {
    const t = todayStr();
    state.renderedDate = t;
    const [meds, logs] = await Promise.all([store.listMeds(), store.logsByDateRange(t, t)]);
    state.meds = meds;
    state.todayLogs = logs;
    renderToday();
  }

  function renderToday() {
    const meds = activeMeds();
    const logByMed = new Map(state.todayLogs.map((l) => [l.medication_id, l]));
    const takenCount = meds.filter((m) => logByMed.has(m.id)).length;

    el.todayDate.textContent = fmtDateKorean(state.renderedDate);
    el.todaySummary.textContent = meds.length ? `${takenCount} / ${meds.length} 복용` : "";
    el.progressFill.style.width = meds.length ? `${(takenCount / meds.length) * 100}%` : "0";
    el.doneBanner.hidden = !(meds.length > 0 && takenCount === meds.length);
    el.todayEmpty.hidden = meds.length > 0;

    el.medCards.innerHTML = "";
    for (const m of meds) {
      const log = logByMed.get(m.id);
      const btn = document.createElement("button");
      btn.className = "med-card" + (log ? " taken" : "");
      btn.setAttribute("aria-pressed", log ? "true" : "false");
      const sub = [m.dosage, m.memo].filter(Boolean).join(" · ");
      btn.innerHTML = `
        <span class="check" aria-hidden="true">✓</span>
        <span class="med-info">
          <span class="med-name">${esc(m.name)}</span>
          ${sub ? `<span class="med-sub">${esc(sub)}</span>` : ""}
        </span>
        <span class="med-time">${log ? esc(fmtTime(log.taken_at)) + " 복용" : ""}</span>`;
      btn.addEventListener("click", () => toggleMed(m.id, !!log));
      el.medCards.appendChild(btn);
    }
  }

  async function toggleMed(medId, isTaken) {
    if (isTaken && !confirm("복용 체크를 취소할까요?")) return;
    const date = todayStr();
    // 자정이 지났으면 화면부터 새 날짜로 갱신
    if (date !== state.renderedDate) return loadToday();
    try {
      if (isTaken) {
        state.todayLogs = state.todayLogs.filter((l) => l.medication_id !== medId);
        renderToday(); // 낙관적 갱신
        await store.removeLog(medId, date);
      } else {
        state.todayLogs.push({ medication_id: medId, date, taken_at: new Date().toISOString() });
        renderToday();
        await store.addLog(medId, date);
      }
    } catch (e) {
      console.error(e);
      alert("저장에 실패했어요. 네트워크를 확인해 주세요.");
    }
    await loadToday(); // 서버 기준으로 재동기화
  }

  // ---------- 렌더: 캘린더 ----------
  async function loadCalendar() {
    const y = state.calMonth.getFullYear();
    const m = state.calMonth.getMonth();
    const from = fmtDate(new Date(y, m, 1));
    const to = fmtDate(new Date(y, m + 1, 0));
    const [meds, logs] = await Promise.all([store.listMeds(), store.logsByDateRange(from, to)]);
    state.meds = meds;
    state.calLogs = logs;
    renderCalendar();
  }

  function renderCalendar() {
    const y = state.calMonth.getFullYear();
    const m = state.calMonth.getMonth();
    el.calTitle.textContent = `${y}년 ${m + 1}월`;

    const logsByDate = new Map();
    for (const l of state.calLogs) {
      if (!logsByDate.has(l.date)) logsByDate.set(l.date, []);
      logsByDate.get(l.date).push(l);
    }

    const meds = activeMeds();
    const firstMedDate = state.meds.length
      ? state.meds.map((x) => fmtDate(new Date(x.created_at))).sort()[0]
      : null;
    const today = todayStr();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const startWeekday = new Date(y, m, 1).getDay();

    el.calGrid.innerHTML = "";
    for (let i = 0; i < startWeekday; i++) el.calGrid.appendChild(document.createElement("div"));

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = fmtDate(new Date(y, m, d));
      const dayLogs = logsByDate.get(dateStr) || [];
      const trackable = firstMedDate && dateStr >= firstMedDate && dateStr <= today;

      let dotCls = "blank";
      if (dayLogs.length > 0) {
        dotCls = meds.length > 0 && dayLogs.length >= meds.length ? "full" : "partial";
      } else if (trackable) {
        dotCls = "none";
      }

      const cell = document.createElement("button");
      cell.className = "cal-cell" + (dayLogs.length || trackable ? " has-data" : "") + (dateStr === today ? " today" : "");
      cell.disabled = !dayLogs.length && !trackable;
      cell.innerHTML = `<span class="d">${d}</span><i class="dot ${dotCls}"></i>`;
      if (!cell.disabled) cell.addEventListener("click", () => openDayModal(dateStr, dayLogs));
      el.calGrid.appendChild(cell);
    }
  }

  function openDayModal(dateStr, dayLogs) {
    el.dayModalTitle.textContent = fmtDateKorean(dateStr);
    const logByMed = new Map(dayLogs.map((l) => [l.medication_id, l]));
    // 현재 활성 약 + 그날 기록이 있는 비활성 약을 함께 표시
    const ids = new Set([...activeMeds().map((m) => m.id), ...logByMed.keys()]);
    el.dayModalList.innerHTML = "";
    for (const id of ids) {
      const med = medById(id);
      if (!med) continue;
      const log = logByMed.get(id);
      const li = document.createElement("li");
      li.innerHTML = `
        <span>${esc(med.name)}${med.active ? "" : ' <small style="color:var(--muted)">(삭제됨)</small>'}</span>
        ${log
          ? `<span class="taken-time">✓ ${esc(fmtTime(log.taken_at))} 복용</span>`
          : `<span class="not-taken">미복용</span>`}`;
      el.dayModalList.appendChild(li);
    }
    el.dayModal.hidden = false;
  }

  // ---------- 렌더: 약 관리 ----------
  async function loadManage() {
    state.meds = await store.listMeds();
    renderManage();
  }

  function renderManage() {
    const meds = activeMeds();
    el.manageEmpty.hidden = meds.length > 0;
    el.medList.innerHTML = "";
    for (const m of meds) {
      const sub = [m.dosage, m.memo].filter(Boolean).join(" · ");
      const li = document.createElement("li");
      li.className = "med-item";
      li.innerHTML = `
        <span class="med-info">
          <div class="med-name">${esc(m.name)}</div>
          ${sub ? `<div class="med-sub">${esc(sub)}</div>` : ""}
        </span>
        <span class="item-actions">
          <button class="ghost-btn" data-act="edit">수정</button>
          <button class="ghost-btn danger" data-act="del">삭제</button>
        </span>`;
      li.querySelector('[data-act="edit"]').addEventListener("click", () => startEdit(m));
      li.querySelector('[data-act="del"]').addEventListener("click", () => deleteMed(m));
      el.medList.appendChild(li);
    }
  }

  function startEdit(m) {
    el.medId.value = m.id;
    el.medName.value = m.name;
    el.medDosage.value = m.dosage || "";
    el.medMemo.value = m.memo || "";
    el.medSave.textContent = "수정 저장";
    el.medCancel.hidden = false;
    el.medName.focus();
  }

  function resetForm() {
    el.medForm.reset();
    el.medId.value = "";
    el.medSave.textContent = "약 추가";
    el.medCancel.hidden = true;
  }

  async function deleteMed(m) {
    if (!confirm(`'${m.name}'을(를) 삭제할까요?\n과거 복용 기록은 그대로 남아요.`)) return;
    try {
      await store.deactivateMed(m.id);
    } catch (e) {
      console.error(e);
      alert("삭제에 실패했어요.");
    }
    await loadManage();
  }

  el.medForm.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const payload = {
      name: el.medName.value.trim(),
      dosage: el.medDosage.value.trim() || null,
      memo: el.medMemo.value.trim() || null,
    };
    if (!payload.name) return;
    try {
      if (el.medId.value) await store.updateMed(Number(el.medId.value), payload);
      else await store.addMed(payload);
      resetForm();
      await loadManage();
    } catch (e) {
      console.error(e);
      alert("저장에 실패했어요.");
    }
  });
  el.medCancel.addEventListener("click", resetForm);

  // ---------- 탭/뷰 전환 ----------
  const loaders = { today: loadToday, calendar: loadCalendar, manage: loadManage };

  async function switchView(view) {
    state.view = view;
    document.querySelectorAll(".tab").forEach((t) => {
      const on = t.dataset.view === view;
      t.classList.toggle("active", on);
      t.setAttribute("aria-selected", String(on));
    });
    document.querySelectorAll(".view").forEach((v) => (v.hidden = v.id !== `view-${view}`));
    await loaders[view]();
  }

  document.querySelectorAll(".tab").forEach((t) =>
    t.addEventListener("click", () => switchView(t.dataset.view))
  );
  document.querySelectorAll("[data-goto]").forEach((b) =>
    b.addEventListener("click", () => switchView(b.dataset.goto))
  );

  $("cal-prev").addEventListener("click", () => {
    state.calMonth = new Date(state.calMonth.getFullYear(), state.calMonth.getMonth() - 1, 1);
    loadCalendar();
  });
  $("cal-next").addEventListener("click", () => {
    state.calMonth = new Date(state.calMonth.getFullYear(), state.calMonth.getMonth() + 1, 1);
    loadCalendar();
  });

  $("day-modal-close").addEventListener("click", () => (el.dayModal.hidden = true));
  el.dayModal.addEventListener("click", (ev) => {
    if (ev.target === el.dayModal) el.dayModal.hidden = true;
  });

  // ---------- 동기화 (멀티 기기 + 자정 넘김) ----------
  function refreshCurrentView() {
    if (el.app.hidden) return;
    // 자정이 지나면 오늘 화면 날짜를 갱신해야 한다
    if (state.view === "today" || todayStr() !== state.renderedDate) {
      loaders[state.view]().catch(console.error);
    } else if (!isDemo) {
      loaders[state.view]().catch(console.error);
    }
  }
  setInterval(() => {
    if (document.visibilityState === "visible") refreshCurrentView();
  }, 30_000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshCurrentView();
  });

  // ---------- 인증 & 시작 ----------
  function showApp() {
    el.loading.hidden = true;
    el.login.hidden = true;
    el.app.hidden = false;
    el.demoBanner.hidden = !isDemo;
    el.logoutBtn.hidden = isDemo;
    switchView("today").catch(console.error);
  }

  function showLogin() {
    el.loading.hidden = true;
    el.app.hidden = true;
    el.login.hidden = false;
  }

  async function init() {
    if (isDemo) return showApp();

    sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

    el.loginForm.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      el.loginError.hidden = true;
      const { error } = await sb.auth.signInWithPassword({
        email: $("login-email").value.trim(),
        password: $("login-password").value,
      });
      if (error) {
        el.loginError.textContent = "로그인에 실패했어요. 이메일/비밀번호를 확인해 주세요.";
        el.loginError.hidden = false;
        return;
      }
      showApp();
    });

    el.logoutBtn.addEventListener("click", async () => {
      await sb.auth.signOut();
      showLogin();
    });

    const { data: { session } } = await sb.auth.getSession();
    session ? showApp() : showLogin();
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  init().catch((e) => {
    console.error(e);
    el.loading.textContent = "초기화에 실패했어요. 새로고침해 주세요.";
  });
})();
