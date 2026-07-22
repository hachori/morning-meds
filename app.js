/* 약 체크 — 앱 로직
 * Supabase 설정(config.js)이 비어 있거나 URL에 ?demo=1 이 있으면
 * 데모 모드(localStorage)로 동작한다.
 * 가족 구성원(persons)별로 약을 관리하고, 상단 칩으로 사람을 전환한다.
 */
(() => {
  "use strict";

  const cfg = window.APP_CONFIG || {};
  const isDemo =
    !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY ||
    new URLSearchParams(location.search).has("demo");

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
  // 공통 인터페이스:
  //   listPersons, addPerson, updatePerson, deactivatePerson,
  //   listMeds, addMed, updateMed, deactivateMed,
  //   logsByDateRange(from,to), addLog(medId,date), removeLog(medId,date)

  const demoStore = {
    KEY: "morning-meds-demo",
    _load() {
      let db;
      try {
        db = JSON.parse(localStorage.getItem(this.KEY)) || {};
      } catch {
        db = {};
      }
      db.meds = db.meds || [];
      db.logs = db.logs || [];
      db.seq = db.seq || 1;
      db.pseq = db.pseq || 1;
      // 기존(사람 개념 도입 전) 데이터 마이그레이션
      if (!db.persons || !db.persons.length) {
        db.persons = [{ id: db.pseq++, name: "나", active: true, created_at: new Date().toISOString() }];
      }
      const defaultPid = db.persons[0].id;
      for (const m of db.meds) if (m.person_id == null) m.person_id = defaultPid;
      return db;
    },
    _save(db) { localStorage.setItem(this.KEY, JSON.stringify(db)); },
    async listPersons() { return this._load().persons; },
    async addPerson(name) {
      const db = this._load();
      db.persons.push({ id: db.pseq++, name, active: true, created_at: new Date().toISOString() });
      this._save(db);
    },
    async updatePerson(id, name) {
      const db = this._load();
      const p = db.persons.find((p) => p.id === id);
      if (p) p.name = name;
      this._save(db);
    },
    async deactivatePerson(id) {
      const db = this._load();
      const p = db.persons.find((p) => p.id === id);
      if (p) p.active = false;
      this._save(db);
    },
    async listMeds() { return this._load().meds; },
    async addMed({ name, dosage, memo, person_id }) {
      const db = this._load();
      db.meds.push({ id: db.seq++, name, dosage, memo, person_id, active: true, created_at: new Date().toISOString() });
      this._save(db);
    },
    async updateMed(id, { name, dosage, memo, person_id }) {
      const db = this._load();
      const m = db.meds.find((m) => m.id === id);
      if (m) Object.assign(m, { name, dosage, memo, person_id });
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
    async listPersons() {
      const { data, error } = await sb.from("persons").select("*").order("created_at");
      if (error) throw error;
      return data;
    },
    async addPerson(name) {
      const { error } = await sb.from("persons").insert({ name });
      if (error) throw error;
    },
    async updatePerson(id, name) {
      const { error } = await sb.from("persons").update({ name }).eq("id", id);
      if (error) throw error;
    },
    async deactivatePerson(id) {
      const { error } = await sb.from("persons").update({ active: false }).eq("id", id);
      if (error) throw error;
    },
    async listMeds() {
      const { data, error } = await sb.from("medications").select("*").order("created_at");
      if (error) throw error;
      return data;
    },
    async addMed({ name, dosage, memo, person_id }) {
      const { error } = await sb.from("medications").insert({ name, dosage, memo, person_id });
      if (error) throw error;
    },
    async updateMed(id, { name, dosage, memo, person_id }) {
      const { error } = await sb.from("medications").update({ name, dosage, memo, person_id }).eq("id", id);
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
  const PERSON_KEY = "morning-meds-selected-person";
  const state = {
    view: "today",
    persons: [],       // 전체(비활성 포함)
    meds: [],          // 전체(비활성 포함) — 과거 기록 표시에 필요
    todayLogs: [],     // 오늘 날짜 로그 (전 가족)
    renderedDate: todayStr(),
    calMonth: new Date(),
    calLogs: [],
    personId: Number(localStorage.getItem(PERSON_KEY)) || null,
  };
  const activePersons = () => state.persons.filter((p) => p.active);
  const activeMeds = () => state.meds.filter((m) => m.active);
  const medById = (id) => state.meds.find((m) => m.id === id);
  const personById = (id) => state.persons.find((p) => p.id === id);

  function ensurePersonSelected() {
    const list = activePersons();
    if (!list.length) { state.personId = null; return; }
    if (!list.some((p) => p.id === state.personId)) state.personId = list[0].id;
    localStorage.setItem(PERSON_KEY, String(state.personId));
  }
  const medsOfSelected = () => activeMeds().filter((m) => m.person_id === state.personId);

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const el = {
    app: $("app"), login: $("login"), loading: $("loading"),
    demoBanner: $("demo-banner"), logoutBtn: $("logout-btn"),
    personTabs: $("person-tabs"),
    todayDate: $("today-date"), todaySummary: $("today-summary"),
    progressFill: $("progress-fill"), doneBanner: $("done-banner"),
    medCards: $("med-cards"), todayEmpty: $("today-empty"),
    calTitle: $("cal-title"), calGrid: $("cal-grid"),
    personForm: $("person-form"), personId: $("person-id"), personName: $("person-name"),
    personSave: $("person-save"), personCancel: $("person-cancel"), personList: $("person-list"),
    medSectionTitle: $("med-section-title"),
    medForm: $("med-form"), medId: $("med-id"), medName: $("med-name"),
    medDosage: $("med-dosage"), medMemo: $("med-memo"), medPerson: $("med-person"),
    medSave: $("med-save"), medCancel: $("med-cancel"),
    medList: $("med-list"), manageEmpty: $("manage-empty"),
    dayModal: $("day-modal"), dayModalTitle: $("day-modal-title"), dayModalList: $("day-modal-list"),
    loginForm: $("login-form"), loginError: $("login-error"),
  };

  // ---------- 렌더: 사람 탭 ----------
  function renderPersonTabs() {
    ensurePersonSelected();
    el.personTabs.innerHTML = "";
    const logSet = new Set(state.todayLogs.map((l) => l.medication_id));
    for (const p of activePersons()) {
      const meds = activeMeds().filter((m) => m.person_id === p.id);
      const taken = meds.filter((m) => logSet.has(m.id)).length;
      let statusCls = "", statusTxt = "";
      if (meds.length) {
        if (taken === meds.length) { statusCls = "done"; statusTxt = "✓"; }
        else { statusCls = taken > 0 ? "partial" : ""; statusTxt = `${taken}/${meds.length}`; }
      }
      const chip = document.createElement("button");
      chip.className = "person-chip" + (p.id === state.personId ? " active" : "");
      chip.innerHTML = `${esc(p.name)}${statusTxt ? ` <span class="p-status ${statusCls}">${statusTxt}</span>` : ""}`;
      chip.addEventListener("click", () => {
        if (state.personId === p.id) return;
        state.personId = p.id;
        localStorage.setItem(PERSON_KEY, String(p.id));
        renderCurrentView();
      });
      el.personTabs.appendChild(chip);
    }
  }

  function renderCurrentView() {
    renderPersonTabs();
    if (state.view === "today") renderToday();
    else if (state.view === "calendar") renderCalendar();
    else renderManage();
  }

  // ---------- 렌더: 오늘 ----------
  async function loadToday() {
    const t = todayStr();
    state.renderedDate = t;
    const [persons, meds, logs] = await Promise.all([
      store.listPersons(), store.listMeds(), store.logsByDateRange(t, t),
    ]);
    state.persons = persons;
    state.meds = meds;
    state.todayLogs = logs;
    renderPersonTabs();
    renderToday();
  }

  function renderToday() {
    const meds = medsOfSelected();
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
        renderPersonTabs();
        renderToday(); // 낙관적 갱신
        await store.removeLog(medId, date);
      } else {
        state.todayLogs.push({ medication_id: medId, date, taken_at: new Date().toISOString() });
        renderPersonTabs();
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
    const [persons, meds, logs] = await Promise.all([
      store.listPersons(), store.listMeds(), store.logsByDateRange(from, to),
    ]);
    state.persons = persons;
    state.meds = meds;
    state.calLogs = logs;
    renderPersonTabs();
    renderCalendar();
  }

  function renderCalendar() {
    const y = state.calMonth.getFullYear();
    const m = state.calMonth.getMonth();
    el.calTitle.textContent = `${y}년 ${m + 1}월`;

    // 선택된 사람의 약(비활성 포함)에 해당하는 로그만
    const personMedIds = new Set(
      state.meds.filter((x) => x.person_id === state.personId).map((x) => x.id)
    );
    const logsByDate = new Map();
    for (const l of state.calLogs) {
      if (!personMedIds.has(l.medication_id)) continue;
      if (!logsByDate.has(l.date)) logsByDate.set(l.date, []);
      logsByDate.get(l.date).push(l);
    }

    const personMeds = state.meds.filter((x) => x.person_id === state.personId);
    const firstMedDate = personMeds.length
      ? personMeds.map((x) => fmtDate(new Date(x.created_at))).sort()[0]
      : null;
    // 그 날짜에 먹었어야 하는 약 개수: 그 날짜 이전에 등록된 활성 약 + 그날 기록이 있는 약
    const expectedCount = (dateStr) => {
      const ids = new Set(
        personMeds
          .filter((x) => x.active && fmtDate(new Date(x.created_at)) <= dateStr)
          .map((x) => x.id)
      );
      for (const l of logsByDate.get(dateStr) || []) ids.add(l.medication_id);
      return ids.size;
    };
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
        dotCls = dayLogs.length >= expectedCount(dateStr) ? "full" : "partial";
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
    const person = personById(state.personId);
    el.dayModalTitle.textContent = `${fmtDateKorean(dateStr)}${person ? " · " + person.name : ""}`;
    const logByMed = new Map(dayLogs.map((l) => [l.medication_id, l]));
    // 그 날짜에 존재했던 활성 약 + 그날 기록이 있는 약을 함께 표시
    const ids = new Set([
      ...medsOfSelected()
        .filter((m) => fmtDate(new Date(m.created_at)) <= dateStr)
        .map((m) => m.id),
      ...logByMed.keys(),
    ]);
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
    const [persons, meds] = await Promise.all([store.listPersons(), store.listMeds()]);
    state.persons = persons;
    state.meds = meds;
    renderPersonTabs();
    renderManage();
  }

  function renderManage() {
    // 가족 목록
    el.personList.innerHTML = "";
    for (const p of activePersons()) {
      const count = activeMeds().filter((m) => m.person_id === p.id).length;
      const li = document.createElement("li");
      li.className = "med-item";
      li.innerHTML = `
        <span class="med-info">
          <div class="med-name">${esc(p.name)}</div>
          <div class="med-sub">약 ${count}개</div>
        </span>
        <span class="item-actions">
          <button class="ghost-btn" data-act="edit">이름 수정</button>
          <button class="ghost-btn danger" data-act="del">삭제</button>
        </span>`;
      li.querySelector('[data-act="edit"]').addEventListener("click", () => startEditPerson(p));
      li.querySelector('[data-act="del"]').addEventListener("click", () => deletePerson(p));
      el.personList.appendChild(li);
    }

    // 약 등록 폼의 사람 선택
    el.medPerson.innerHTML = "";
    for (const p of activePersons()) {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name;
      el.medPerson.appendChild(opt);
    }
    if (!el.medId.value && state.personId) el.medPerson.value = String(state.personId);

    // 선택된 사람의 약 목록
    const person = personById(state.personId);
    el.medSectionTitle.textContent = person ? `${person.name}의 약` : "약 관리";
    const meds = medsOfSelected();
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

  // --- 가족 구성원 폼 ---
  function startEditPerson(p) {
    el.personId.value = p.id;
    el.personName.value = p.name;
    el.personSave.textContent = "저장";
    el.personCancel.hidden = false;
    el.personName.focus();
  }
  function resetPersonForm() {
    el.personForm.reset();
    el.personId.value = "";
    el.personSave.textContent = "추가";
    el.personCancel.hidden = true;
  }
  async function deletePerson(p) {
    if (activePersons().length <= 1) {
      alert("최소 한 명은 있어야 해요.");
      return;
    }
    const count = activeMeds().filter((m) => m.person_id === p.id).length;
    if (!confirm(`'${p.name}'을(를) 삭제할까요?\n등록된 약 ${count}개도 화면에서 사라져요. (과거 기록은 보존)`)) return;
    try {
      await store.deactivatePerson(p.id);
    } catch (e) {
      console.error(e);
      alert("삭제에 실패했어요.");
    }
    await loadManage();
  }
  el.personForm.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const name = el.personName.value.trim();
    if (!name) return;
    try {
      if (el.personId.value) await store.updatePerson(Number(el.personId.value), name);
      else await store.addPerson(name);
      resetPersonForm();
      await loadManage();
    } catch (e) {
      console.error(e);
      alert("저장에 실패했어요.");
    }
  });
  el.personCancel.addEventListener("click", resetPersonForm);

  // --- 약 폼 ---
  function startEdit(m) {
    el.medId.value = m.id;
    el.medName.value = m.name;
    el.medDosage.value = m.dosage || "";
    el.medMemo.value = m.memo || "";
    el.medPerson.value = String(m.person_id);
    el.medSave.textContent = "수정 저장";
    el.medCancel.hidden = false;
    el.medName.focus();
  }

  function resetForm() {
    el.medForm.reset();
    el.medId.value = "";
    el.medSave.textContent = "약 추가";
    el.medCancel.hidden = true;
    if (state.personId) el.medPerson.value = String(state.personId);
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
      person_id: Number(el.medPerson.value),
    };
    if (!payload.name || !payload.person_id) return;
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
