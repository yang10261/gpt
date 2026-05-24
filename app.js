const CONFIG_KEY = "dailyQuest.firebaseConfig";
const LOCAL_STATE_KEY = "dailyQuest.localState";
const todayKey = formatDateKey(new Date());
const sampleQuests = ["喝 2000 ml 水", "整理桌面 10 分鐘", "運動或伸展 15 分鐘"];

const els = {
  settingsButton: document.querySelector("#settingsButton"),
  settingsDialog: document.querySelector("#settingsDialog"),
  firebaseConfig: document.querySelector("#firebaseConfig"),
  saveConfigButton: document.querySelector("#saveConfigButton"),
  clearConfigButton: document.querySelector("#clearConfigButton"),
  connectionState: document.querySelector("#connectionState"),
  prevMonthButton: document.querySelector("#prevMonthButton"),
  nextMonthButton: document.querySelector("#nextMonthButton"),
  monthTitle: document.querySelector("#monthTitle"),
  calendarGrid: document.querySelector("#calendarGrid"),
  streakValue: document.querySelector("#streakValue"),
  completedValue: document.querySelector("#completedValue"),
  progressLabel: document.querySelector("#progressLabel"),
  progressBar: document.querySelector("#progressBar"),
  selectedDateLabel: document.querySelector("#selectedDateLabel"),
  checkinButton: document.querySelector("#checkinButton"),
  checkinMessage: document.querySelector("#checkinMessage"),
  questForm: document.querySelector("#questForm"),
  questTitle: document.querySelector("#questTitle"),
  questList: document.querySelector("#questList"),
  emptyState: document.querySelector("#emptyState"),
  seedButton: document.querySelector("#seedButton")
};

let selectedDateKey = todayKey;
let visibleMonth = startOfMonth(new Date());
let store = createLocalStore();
let state = {
  profile: { streak: 0, lastCheckin: "" },
  day: { checkedIn: false, quests: [] }
};
let daySummaries = {};
let unsubscribeDay = null;
let unsubscribeMonth = null;
let unsubscribeProfile = null;
let firebaseSdk = null;

boot();

function boot() {
  wireEvents();
  const savedConfig = localStorage.getItem(CONFIG_KEY);
  if (savedConfig) {
    els.firebaseConfig.value = savedConfig;
    connectFirebase(savedConfig);
    return;
  }
  loadLocalState();
  render();
}

function wireEvents() {
  els.settingsButton.addEventListener("click", () => els.settingsDialog.showModal());
  els.prevMonthButton.addEventListener("click", () => shiftMonth(-1));
  els.nextMonthButton.addEventListener("click", () => shiftMonth(1));
  els.saveConfigButton.addEventListener("click", () => {
    const rawConfig = els.firebaseConfig.value.trim();
    if (!rawConfig) return;
    try {
      JSON.parse(rawConfig);
      localStorage.setItem(CONFIG_KEY, rawConfig);
      els.settingsDialog.close();
      connectFirebase(rawConfig);
    } catch {
      els.connectionState.textContent = "設定格式不是有效的 JSON。";
    }
  });
  els.clearConfigButton.addEventListener("click", () => {
    localStorage.removeItem(CONFIG_KEY);
    els.firebaseConfig.value = "";
    stopFirebaseListeners();
    store = createLocalStore();
    loadLocalState();
    els.connectionState.textContent = "已切換為本機示範模式。";
    render();
  });
  els.checkinButton.addEventListener("click", handleCheckin);
  els.questForm.addEventListener("submit", handleAddQuest);
  els.seedButton.addEventListener("click", addSampleQuests);
}

async function connectFirebase(rawConfig) {
  try {
    const config = JSON.parse(rawConfig);
    firebaseSdk = await loadFirebaseSdk();
    const { initializeApp, getApps, getAuth, getFirestore, onAuthStateChanged, signInAnonymously } = firebaseSdk;
    const app = getApps().length ? getApps()[0] : initializeApp(config);
    const auth = getAuth(app);
    const db = getFirestore(app);
    els.connectionState.textContent = "正在連線 Firebase...";

    onAuthStateChanged(auth, async user => {
      if (!user) return;
      store = createFirebaseStore(db, user.uid);
      await store.ensureReady();
      subscribeFirebaseState();
    });

    await signInAnonymously(auth);
  } catch (error) {
    els.connectionState.textContent = `Firebase 連線失敗：${error.message}`;
    loadLocalState();
    render();
  }
}

function subscribeFirebaseState() {
  const { onSnapshot } = firebaseSdk;
  stopFirebaseListeners();
  els.connectionState.textContent = "已連線 Firebase Firestore。";
  unsubscribeProfile = onSnapshot(store.profileRef, snapshot => {
    state.profile = normalizeProfile(snapshot.exists() ? snapshot.data() : state.profile);
    render();
  });
  unsubscribeMonth = onSnapshot(store.daysRef, snapshot => {
    daySummaries = {};
    snapshot.forEach(dayDoc => {
      daySummaries[dayDoc.id] = summarizeDay(normalizeDay(dayDoc.data()));
    });
    renderCalendar();
  });
  subscribeSelectedDay();
}

function subscribeSelectedDay() {
  const { onSnapshot } = firebaseSdk;
  if (unsubscribeDay) unsubscribeDay();
  store.setSelectedDate(selectedDateKey);
  unsubscribeDay = onSnapshot(store.dayRef, snapshot => {
    state.day = normalizeDay(snapshot.exists() ? snapshot.data() : { checkedIn: false, quests: [] });
    render();
  });
}

function stopFirebaseListeners() {
  if (unsubscribeDay) unsubscribeDay();
  if (unsubscribeMonth) unsubscribeMonth();
  if (unsubscribeProfile) unsubscribeProfile();
  unsubscribeDay = null;
  unsubscribeMonth = null;
  unsubscribeProfile = null;
}

function createFirebaseStore(db, uid) {
  const { collection, doc, getDoc, setDoc } = firebaseSdk;
  const profileRef = doc(db, "users", uid);
  const daysRef = collection(db, "users", uid, "days");
  let dayRef = doc(daysRef, selectedDateKey);

  return {
    profileRef,
    daysRef,
    get dayRef() {
      return dayRef;
    },
    setSelectedDate(dateKey) {
      dayRef = doc(daysRef, dateKey);
    },
    async ensureReady() {
      const profileSnap = await getDoc(profileRef);
      if (!profileSnap.exists()) {
        await setDoc(profileRef, { streak: 0, lastCheckin: "" });
      }
    },
    async setProfile(profile) {
      await setDoc(profileRef, profile, { merge: true });
    },
    async setDay(day) {
      await setDoc(dayRef, day, { merge: true });
    }
  };
}

async function loadFirebaseSdk() {
  if (firebaseSdk) return firebaseSdk;
  const [appModule, authModule, firestoreModule] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js"),
    import("https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js")
  ]);
  return { ...appModule, ...authModule, ...firestoreModule };
}

function createLocalStore() {
  return {
    setSelectedDate() {},
    async setProfile(profile) {
      state.profile = normalizeProfile(profile);
      saveLocalState();
    },
    async setDay(day) {
      state.day = normalizeDay(day);
      saveLocalState();
      loadDaySummaries();
    }
  };
}

function loadLocalState() {
  const saved = readLocalState();
  state = {
    profile: normalizeProfile(saved.profile),
    day: normalizeDay(saved[selectedDateKey]?.day)
  };
  loadDaySummaries();
  els.connectionState.textContent = "本機示範模式";
}

function saveLocalState() {
  const saved = readLocalState();
  saved.profile = state.profile;
  saved[selectedDateKey] = { day: state.day };
  localStorage.setItem(LOCAL_STATE_KEY, JSON.stringify(saved));
}

function readLocalState() {
  return JSON.parse(localStorage.getItem(LOCAL_STATE_KEY) || "{}");
}

function loadDaySummaries() {
  const saved = readLocalState();
  daySummaries = {};
  Object.keys(saved).forEach(key => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(key)) {
      daySummaries[key] = summarizeDay(normalizeDay(saved[key]?.day));
    }
  });
}

async function handleCheckin() {
  if (selectedDateKey !== todayKey || state.day.checkedIn) return;
  const yesterday = dateOffset(-1);
  const nextStreak = state.profile.lastCheckin === yesterday ? Number(state.profile.streak || 0) + 1 : 1;
  const profile = {
    ...state.profile,
    streak: nextStreak,
    lastCheckin: todayKey
  };
  const day = { ...state.day, checkedIn: true };
  await store.setProfile(profile);
  await store.setDay(day);
  state.profile = profile;
  state.day = day;
  render();
}

async function handleAddQuest(event) {
  event.preventDefault();
  const title = els.questTitle.value.trim();
  if (!title) return;
  const quest = {
    id: crypto.randomUUID(),
    title,
    completed: false
  };
  const day = { ...state.day, quests: [...(state.day.quests || []), quest] };
  await store.setDay(day);
  state.day = day;
  els.questForm.reset();
  render();
}

async function addSampleQuests() {
  const existingTitles = new Set((state.day.quests || []).map(quest => quest.title));
  const quests = sampleQuests
    .filter(title => !existingTitles.has(title))
    .map(title => ({ id: crypto.randomUUID(), title, completed: false }));
  if (!quests.length) return;
  const day = { ...state.day, quests: [...(state.day.quests || []), ...quests] };
  await store.setDay(day);
  state.day = day;
  render();
}

async function toggleQuest(id) {
  if (selectedDateKey !== todayKey) return;
  const quests = state.day.quests || [];
  const quest = quests.find(item => item.id === id);
  if (!quest || quest.completed) return;
  const day = {
    ...state.day,
    quests: quests.map(item => (item.id === id ? { ...item, completed: true } : item))
  };
  await store.setDay(day);
  state.day = day;
  render();
}

async function deleteQuest(id) {
  const day = { ...state.day, quests: (state.day.quests || []).filter(quest => quest.id !== id) };
  await store.setDay(day);
  state.day = day;
  render();
}

function shiftMonth(delta) {
  visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + delta, 1);
  renderCalendar();
}

function selectDate(dateKey) {
  selectedDateKey = dateKey;
  visibleMonth = startOfMonth(parseDateKey(dateKey));
  if (firebaseSdk && store.dayRef) {
    subscribeSelectedDay();
  } else {
    loadLocalState();
    render();
  }
}

function render() {
  renderCalendar();
  renderDayPanel();
}

function renderDayPanel() {
  const quests = state.day.quests || [];
  const completed = quests.filter(quest => quest.completed).length;
  const percent = quests.length ? Math.round((completed / quests.length) * 100) : 0;
  const isToday = selectedDateKey === todayKey;

  els.streakValue.textContent = Number(state.profile.streak || 0);
  els.completedValue.textContent = `${completed} / ${quests.length}`;
  els.selectedDateLabel.textContent = formatDisplayDate(parseDateKey(selectedDateKey));
  els.progressLabel.textContent = `${completed} / ${quests.length} 任務完成`;
  els.progressBar.style.width = `${percent}%`;
  els.checkinButton.disabled = !isToday || Boolean(state.day.checkedIn);
  els.checkinButton.textContent = state.day.checkedIn ? "已簽到" : "簽到";
  els.checkinMessage.textContent = getCheckinMessage(isToday);

  els.questList.innerHTML = "";
  els.emptyState.classList.toggle("visible", quests.length === 0);

  quests.forEach(quest => {
    const card = document.createElement("article");
    const canComplete = selectedDateKey === todayKey && !quest.completed;
    card.className = `quest-card${quest.completed ? " completed" : ""}`;
    card.innerHTML = `
      <button class="quest-toggle" type="button" aria-label="完成 ${escapeHtml(quest.title)}" ${canComplete ? "" : "disabled"}>${quest.completed ? "✓" : "+"}</button>
      <div>
        <div class="quest-title">${escapeHtml(quest.title)}</div>
      </div>
      <button class="danger-button" type="button" aria-label="刪除 ${escapeHtml(quest.title)}">×</button>
    `;
    card.querySelector(".quest-toggle").addEventListener("click", () => toggleQuest(quest.id));
    card.querySelector(".danger-button").addEventListener("click", () => deleteQuest(quest.id));
    els.questList.append(card);
  });
}

function renderCalendar() {
  const monthStart = startOfMonth(visibleMonth);
  const gridStart = new Date(monthStart);
  gridStart.setDate(monthStart.getDate() - monthStart.getDay());
  const monthFormatter = new Intl.DateTimeFormat("zh-Hant-TW", { year: "numeric", month: "long" });

  els.monthTitle.textContent = monthFormatter.format(monthStart);
  els.calendarGrid.innerHTML = "";

  for (let index = 0; index < 42; index += 1) {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    const dateKey = formatDateKey(date);
    const summary = daySummaries[dateKey] || { total: 0, completed: 0 };
    const canShowStatusColor = dateKey <= todayKey;
    const button = document.createElement("button");
    button.className = "calendar-day";
    button.type = "button";
    button.dataset.date = dateKey;
    button.setAttribute("aria-label", `選擇 ${formatDisplayDate(date)}`);
    button.classList.toggle("outside-month", date.getMonth() !== monthStart.getMonth());
    button.classList.toggle("today", dateKey === todayKey);
    button.classList.toggle("selected", dateKey === selectedDateKey);
    button.classList.toggle("all-complete", canShowStatusColor && summary.total > 0 && summary.completed === summary.total);
    button.classList.toggle("none-complete", canShowStatusColor && summary.total > 0 && summary.completed === 0);
    button.classList.toggle("part-complete", canShowStatusColor && summary.completed > 0 && summary.completed < summary.total);
    button.innerHTML = `
      <span class="day-number">${date.getDate()}</span>
      <span class="day-note">${dateKey === todayKey ? "今天" : ""}</span>
      <span class="task-mark ${summary.total ? "has-tasks" : ""}" aria-hidden="true">${summary.total ? `${summary.completed}/${summary.total}` : ""}</span>
    `;
    button.addEventListener("click", () => selectDate(dateKey));
    els.calendarGrid.append(button);
  }
}

function getCheckinMessage(isToday) {
  if (!isToday) return "簽到只適用於今天。這天仍可先規畫任務。";
  return state.day.checkedIn ? "今天已簽到。明天繼續累積連勝。" : "今天還沒有簽到。完成簽到可累積連勝。";
}

function normalizeProfile(profile = {}) {
  return {
    streak: Number(profile.streak || 0),
    lastCheckin: profile.lastCheckin || ""
  };
}

function normalizeDay(day = {}) {
  return {
    checkedIn: Boolean(day.checkedIn),
    quests: Array.isArray(day.quests)
      ? day.quests.map(quest => ({
          id: quest.id || crypto.randomUUID(),
          title: quest.title || "未命名任務",
          completed: Boolean(quest.completed)
        }))
      : []
  };
}

function summarizeDay(day) {
  const quests = day.quests || [];
  return {
    total: quests.length,
    completed: quests.filter(quest => quest.completed).length
  };
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function parseDateKey(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDisplayDate(date) {
  return new Intl.DateTimeFormat("zh-Hant-TW", {
    month: "long",
    day: "numeric",
    weekday: "long"
  }).format(date);
}

function dateOffset(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return formatDateKey(date);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
