import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Home, Calendar as CalendarIcon, BarChart3, ListChecks, Settings as SettingsIcon,
  Plus, ChevronLeft, ChevronRight, Check, Trash2, Pencil, Flame, Trophy, Clock,
  X, ArrowUp, ArrowDown, Moon, Sun, Download, RotateCcw, Sparkles
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid, Cell } from 'recharts';
import { auth, db, googleProvider } from './firebase';
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { doc, setDoc, onSnapshot } from 'firebase/firestore';

const STORAGE_KEY = 'arc_data_v1';
const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const CATEGORIES = ['Health', 'Growth', 'Mindfulness', 'Other'];
const CATEGORY_COLORS = { Health: '#2FA875', Growth: '#4C6FE8', Mindfulness: '#8B5FE0', Other: '#B08B3D' };

function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }
function pad(n) { return n < 10 ? '0' + n : '' + n; }
function dateKey(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function todayKey() { return dateKey(new Date()); }
function parseKey(key) { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function isScheduled(routine, date) {
  if (!routine.recurrence || routine.recurrence === 'daily') return true;
  if (Array.isArray(routine.recurrence)) return routine.recurrence.length === 0 ? true : routine.recurrence.includes(date.getDay());
  return true;
}
function fmtTime12(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  const hh = ((h + 11) % 12) + 1;
  return `${hh}:${pad(m)} ${ap}`;
}
function monthLabel(d) { return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }); }
function dayLabel(d) { return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }); }

const DEFAULT_ROUTINES = [
  { id: uid(), name: 'Wake up early', icon: '⏰', category: 'Health', time: '06:30', notes: '', recurrence: 'daily', order: 0, createdAt: todayKey() },
  { id: uid(), name: 'Meditation', icon: '🧘', category: 'Mindfulness', time: '07:00', notes: '', recurrence: 'daily', order: 1, createdAt: todayKey() },
  { id: uid(), name: 'Exercise', icon: '💪', category: 'Health', time: '07:15', notes: '', recurrence: 'daily', order: 2, createdAt: todayKey() },
  { id: uid(), name: 'Drink water', icon: '💧', category: 'Health', time: '', notes: '', recurrence: 'daily', order: 3, createdAt: todayKey() },
  { id: uid(), name: 'Study', icon: '📚', category: 'Growth', time: '09:30', notes: '', recurrence: 'daily', order: 4, createdAt: todayKey() },
  { id: uid(), name: 'Coding', icon: '💻', category: 'Growth', time: '14:00', notes: '', recurrence: 'daily', order: 5, createdAt: todayKey() },
  { id: uid(), name: 'Read', icon: '📖', category: 'Growth', time: '20:00', notes: '', recurrence: 'daily', order: 6, createdAt: todayKey() },
  { id: uid(), name: 'Sleep on time', icon: '🌙', category: 'Health', time: '22:30', notes: '', recurrence: 'daily', order: 7, createdAt: todayKey() },
];

function ArcRing({ percent, size = 120, stroke = 10, color = 'var(--accent)', track = 'var(--accent-soft)', children }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.min(100, Math.max(0, percent));
  const offset = c - (p / 100) * c;
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none"
          strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.7s cubic-bezier(.4,0,.2,1)' }} />
      </svg>
      {children && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
          {children}
        </div>
      )}
    </div>
  );
}

function MiniArc({ percent, color, size = 26, stroke = 3 }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (Math.min(100, Math.max(0, percent)) / 100) * c;
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--border)" strokeWidth={stroke} fill="none" />
      <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none"
        strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round" />
    </svg>
  );
}

function computeDayStats(dateStr, routines, logs) {
  const date = parseKey(dateStr);
  const scheduled = routines.filter(r => r.createdAt <= dateStr && isScheduled(r, date));
  const completed = scheduled.filter(r => logs[dateStr]?.[r.id]?.completed);
  const percent = scheduled.length ? Math.round((completed.length / scheduled.length) * 100) : -1;
  return { scheduled, completed, percent, missed: scheduled.filter(r => !logs[dateStr]?.[r.id]?.completed) };
}

function currentStreak(predicate) {
  let streak = 0, d = new Date(), first = true;
  for (let i = 0; i < 3650; i++) {
    const key = dateKey(d);
    const status = predicate(key, d);
    if (status === 'done') streak++;
    else if (status === 'notdone') {
      if (first && key === todayKey()) { /* today not over yet */ } else break;
    }
    first = false;
    d = addDays(d, -1);
  }
  return streak;
}

function longestStreak(predicate, fromKey, toKey) {
  let d = parseKey(fromKey), max = 0, run = 0;
  const end = parseKey(toKey);
  for (let i = 0; i < 3650 && d <= end; i++) {
    const key = dateKey(d);
    const status = predicate(key, d);
    if (status === 'done') { run++; max = Math.max(max, run); }
    else if (status === 'notdone') { run = 0; }
    d = addDays(d, 1);
  }
  return max;
}

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(typeof window !== 'undefined' ? window.innerWidth >= 860 : true);
  useEffect(() => {
    const onResize = () => setIsDesktop(window.innerWidth >= 860);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return isDesktop;
}

const NAV_ITEMS = [
  { key: 'home', label: 'Home', icon: Home },
  { key: 'calendar', label: 'Calendar', icon: CalendarIcon },
  { key: 'stats', label: 'Statistics', icon: BarChart3 },
  { key: 'routines', label: 'Routines', icon: ListChecks },
  { key: 'settings', label: 'Settings', icon: SettingsIcon },
];

export default function ArcTracker() {
  const [loaded, setLoaded] = useState(false);
  const [routines, setRoutines] = useState(DEFAULT_ROUTINES);
  const [logs, setLogs] = useState({});
  const [darkMode, setDarkMode] = useState(false);
  const [view, setView] = useState('home');
  const [selectedDate, setSelectedDate] = useState(todayKey());
  const [calendarMonth, setCalendarMonth] = useState(new Date());
  const [modalRoutine, setModalRoutine] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const isDesktop = useIsDesktop();
  const saveTimer = useRef(null);
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Track sign-in state. Signing in with the same Google account on your
  // iPhone and desktop is what ties them to the same data.
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
    });
    return () => unsub();
  }, []);

  // Subscribe in realtime to this user's document in Firestore.
  // Any change made on one device is pushed to every other device
  // signed into the same account within moments — no refresh needed.
  useEffect(() => {
    if (!user) { setLoaded(false); return; }
    const ref = doc(db, 'users', user.uid);
    const unsub = onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        if (data.routines?.length) setRoutines(data.routines);
        if (data.logs) setLogs(data.logs);
        if (typeof data.darkMode === 'boolean') setDarkMode(data.darkMode);
      }
      setLoaded(true);
    }, (err) => { console.error('Sync error', err); setLoaded(true); });
    return () => unsub();
  }, [user]);

  // Debounced write to Firestore. Firestore's own offline cache keeps this
  // working without a connection and syncs automatically once back online.
  useEffect(() => {
    if (!loaded || !user) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      setDoc(doc(db, 'users', user.uid), { routines, logs, darkMode }, { merge: true })
        .catch((e) => console.error('Save failed', e));
    }, 500);
    return () => clearTimeout(saveTimer.current);
  }, [routines, logs, darkMode, loaded, user]);

  const toggleRoutine = useCallback((dateStr, routineId) => {
    setLogs(prev => {
      const day = { ...(prev[dateStr] || {}) };
      const cur = day[routineId];
      if (cur?.completed) day[routineId] = { completed: false };
      else day[routineId] = { completed: true, time: new Date().toTimeString().slice(0, 5) };
      return { ...prev, [dateStr]: day };
    });
  }, []);

  const sortedRoutines = useMemo(() => [...routines].sort((a, b) => a.order - b.order), [routines]);
  const earliestKey = useMemo(() => routines.reduce((min, r) => r.createdAt < min ? r.createdAt : min, todayKey()), [routines]);

  const todayStats = useMemo(() => computeDayStats(todayKey(), routines, logs), [routines, logs]);
  const selectedStats = useMemo(() => computeDayStats(selectedDate, routines, logs), [selectedDate, routines, logs]);

  const overallCurrentStreak = useMemo(() => currentStreak((key) => {
    const s = computeDayStats(key, routines, logs);
    if (s.percent === -1) return 'skip';
    return s.percent === 100 ? 'done' : 'notdone';
  }), [routines, logs]);

  const overallLongestStreak = useMemo(() => longestStreak((key) => {
    const s = computeDayStats(key, routines, logs);
    if (s.percent === -1) return 'skip';
    return s.percent === 100 ? 'done' : 'notdone';
  }, earliestKey, todayKey()), [routines, logs, earliestKey]);

  const routineStats = useMemo(() => {
    return sortedRoutines.map(r => {
      const cs = currentStreak((key, date) => {
        if (key < r.createdAt) return 'skip';
        if (!isScheduled(r, date)) return 'skip';
        return logs[key]?.[r.id]?.completed ? 'done' : 'notdone';
      });
      const ls = longestStreak((key, date) => {
        if (!isScheduled(r, date)) return 'skip';
        return logs[key]?.[r.id]?.completed ? 'done' : 'notdone';
      }, r.createdAt, todayKey());
      let scheduled = 0, completed = 0;
      let d = parseKey(r.createdAt);
      const end = new Date();
      for (let i = 0; i < 3650 && d <= end; i++) {
        if (isScheduled(r, d)) {
          scheduled++;
          if (logs[dateKey(d)]?.[r.id]?.completed) completed++;
        }
        d = addDays(d, 1);
      }
      const rate = scheduled ? Math.round((completed / scheduled) * 100) : 0;
      return { ...r, currentStreak: cs, longestStreak: ls, rate, scheduled, completed };
    });
  }, [sortedRoutines, logs]);

  const weekPercent = useMemo(() => {
    let sum = 0, count = 0;
    for (let i = 6; i >= 0; i--) {
      const s = computeDayStats(dateKey(addDays(new Date(), -i)), routines, logs);
      if (s.percent >= 0) { sum += s.percent; count++; }
    }
    return count ? Math.round(sum / count) : 0;
  }, [routines, logs]);

  const monthPercent = useMemo(() => {
    const now = new Date();
    let sum = 0, count = 0;
    for (let day = 1; day <= now.getDate(); day++) {
      const d = new Date(now.getFullYear(), now.getMonth(), day);
      const s = computeDayStats(dateKey(d), routines, logs);
      if (s.percent >= 0) { sum += s.percent; count++; }
    }
    return count ? Math.round(sum / count) : 0;
  }, [routines, logs]);

  const totals = useMemo(() => {
    let completed = 0, missed = 0;
    let d = parseKey(earliestKey);
    const end = new Date();
    for (let i = 0; i < 3650 && d <= end; i++) {
      const s = computeDayStats(dateKey(d), routines, logs);
      completed += s.completed.length;
      missed += s.missed.length;
      d = addDays(d, 1);
    }
    return { completed, missed };
  }, [routines, logs, earliestKey]);

  const bestDay = useMemo(() => {
    const sums = [0, 0, 0, 0, 0, 0, 0], counts = [0, 0, 0, 0, 0, 0, 0];
    let d = parseKey(earliestKey);
    const end = new Date();
    for (let i = 0; i < 3650 && d <= end; i++) {
      const s = computeDayStats(dateKey(d), routines, logs);
      if (s.percent >= 0) { sums[d.getDay()] += s.percent; counts[d.getDay()]++; }
      d = addDays(d, 1);
    }
    let bestIdx = 0, bestAvg = -1;
    for (let i = 0; i < 7; i++) {
      const avg = counts[i] ? sums[i] / counts[i] : -1;
      if (avg > bestAvg) { bestAvg = avg; bestIdx = i; }
    }
    const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return { name: names[bestIdx], avg: bestAvg >= 0 ? Math.round(bestAvg) : 0 };
  }, [routines, logs, earliestKey]);

  const mostConsistent = useMemo(() => {
    const withData = routineStats.filter(r => r.scheduled > 0);
    if (!withData.length) return null;
    return withData.reduce((a, b) => (b.rate > a.rate ? b : a));
  }, [routineStats]);
  const leastConsistent = useMemo(() => {
    const withData = routineStats.filter(r => r.scheduled > 0);
    if (!withData.length) return null;
    return withData.reduce((a, b) => (b.rate < a.rate ? b : a));
  }, [routineStats]);

  const last7 = useMemo(() => {
    const arr = [];
    for (let i = 6; i >= 0; i--) {
      const d = addDays(new Date(), -i);
      const key = dateKey(d);
      const s = computeDayStats(key, routines, logs);
      arr.push({ label: d.toLocaleDateString(undefined, { weekday: 'short' }), percent: Math.max(0, s.percent) });
    }
    return arr;
  }, [routines, logs]);

  function saveRoutine(data) {
    if (data.id) {
      setRoutines(prev => prev.map(r => r.id === data.id ? { ...r, ...data } : r));
    } else {
      const maxOrder = routines.reduce((m, r) => Math.max(m, r.order), -1);
      setRoutines(prev => [...prev, { ...data, id: uid(), order: maxOrder + 1, createdAt: todayKey() }]);
    }
    setShowModal(false);
    setModalRoutine(null);
  }
  function deleteRoutine(id) {
    setRoutines(prev => prev.filter(r => r.id !== id));
  }
  function moveRoutine(id, dir) {
    setRoutines(prev => {
      const list = [...prev].sort((a, b) => a.order - b.order);
      const idx = list.findIndex(r => r.id === id);
      const swapIdx = idx + dir;
      if (swapIdx < 0 || swapIdx >= list.length) return prev;
      const a = list[idx], b = list[swapIdx];
      const tmp = a.order; a.order = b.order; b.order = tmp;
      return list.map(r => ({ ...r }));
    });
  }
  function exportData() {
    const blob = new Blob([JSON.stringify({ routines, logs }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `arc-tracker-export-${todayKey()}.json`; a.click();
    URL.revokeObjectURL(url);
  }
  function resetData() {
    setRoutines(DEFAULT_ROUTINES);
    setLogs({});
    setConfirmReset(false);
  }

  const theme = darkMode ? {
    bg: '#141320', surface: '#1D1B2E', surfaceAlt: '#242238', border: '#332F4A',
    text: '#F3F2FA', textMuted: '#A7A3C4', accent: '#7C74F0', accentSoft: '#2C2850',
  } : {
    bg: '#FAFAF9', surface: '#FFFFFF', surfaceAlt: '#F3F2FA', border: '#E7E5F0',
    text: '#1D1B2E', textMuted: '#716D8A', accent: '#5B4FE8', accentSoft: '#EDEBFC',
  };

  const cssVars = {
    '--bg': theme.bg, '--surface': theme.surface, '--surface-alt': theme.surfaceAlt,
    '--border': theme.border, '--text': theme.text, '--text-muted': theme.textMuted,
    '--accent': theme.accent, '--accent-soft': theme.accentSoft,
    '--success': '#2FA875', '--warning': '#E4A63A', '--danger': '#E2645C',
  };

  if (authLoading) {
    return (
      <div style={{ ...cssVars, background: 'var(--bg)', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: 'var(--text-muted)', fontFamily: 'Inter, sans-serif' }}>Loading Arc Tracker…</div>
      </div>
    );
  }

  if (!user) {
    return (
      <SignInScreen
        cssVars={cssVars}
        onSignIn={() => signInWithPopup(auth, googleProvider).catch((e) => console.error('Sign-in failed', e))}
      />
    );
  }

  if (!loaded) {
    return (
      <div style={{ ...cssVars, background: 'var(--bg)', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: 'var(--text-muted)', fontFamily: 'Inter, sans-serif' }}>Syncing your routines…</div>
      </div>
    );
  }

  return (
    <div style={{ ...cssVars, background: 'var(--bg)', minHeight: '100vh', fontFamily: "'Inter', sans-serif", color: 'var(--text)' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap');
        * { box-sizing: border-box; }
        .num-font { font-family: 'Space Grotesk', sans-serif; }
        .arc-scroll::-webkit-scrollbar { display: none; }
        .arc-scroll { -ms-overflow-style: none; scrollbar-width: none; }
        button { font-family: inherit; cursor: pointer; }
        .arc-fade-in { animation: arcFadeIn .35s ease; }
        @keyframes arcFadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        .arc-checkbox { transition: all .18s cubic-bezier(.4,0,.2,1); }
        .arc-checkbox:active { transform: scale(0.88); }
        @media (prefers-reduced-motion: reduce) { .arc-checkbox, .arc-fade-in, * { animation: none !important; transition: none !important; } }
      `}</style>

      <div style={{ display: 'flex', minHeight: '100vh' }}>
        {isDesktop && (
          <aside style={{
            width: 240, flexShrink: 0, borderRight: '1px solid var(--border)',
            background: 'var(--surface)', padding: '28px 16px', display: 'flex', flexDirection: 'column',
            position: 'sticky', top: 0, height: '100vh',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 10px', marginBottom: 36 }}>
              <div style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Sparkles size={18} color="#fff" />
              </div>
              <span className="num-font" style={{ fontSize: 19, fontWeight: 700, letterSpacing: '-0.02em' }}>Arc Tracker</span>
            </div>
            <nav style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {NAV_ITEMS.map(item => (
                <button key={item.key} onClick={() => setView(item.key)} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', borderRadius: 12,
                  border: 'none', background: view === item.key ? 'var(--accent-soft)' : 'transparent',
                  color: view === item.key ? 'var(--accent)' : 'var(--text-muted)',
                  fontWeight: 600, fontSize: 14.5, textAlign: 'left',
                }}>
                  <item.icon size={18} strokeWidth={2.2} />
                  {item.label}
                </button>
              ))}
            </nav>
            <div style={{ marginTop: 'auto', padding: '14px', borderRadius: 14, background: 'var(--surface-alt)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <Flame size={16} color="var(--accent)" />
                <span className="num-font" style={{ fontWeight: 700, fontSize: 15 }}>{overallCurrentStreak} day streak</span>
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Keep it going today</div>
            </div>
          </aside>
        )}

        <main style={{ flex: 1, minWidth: 0, paddingBottom: isDesktop ? 40 : 100 }}>
          {view === 'home' && (
            <HomeView
              routines={sortedRoutines} logs={logs} stats={todayStats}
              onToggle={(rid) => toggleRoutine(todayKey(), rid)}
              isDesktop={isDesktop}
              overallCurrentStreak={overallCurrentStreak}
              onAdd={() => { setModalRoutine(null); setShowModal(true); }}
            />
          )}
          {view === 'calendar' && (
            <CalendarView
              routines={routines} logs={logs}
              calendarMonth={calendarMonth} setCalendarMonth={setCalendarMonth}
              selectedDate={selectedDate} setSelectedDate={setSelectedDate}
              selectedStats={selectedStats}
              onToggle={(rid) => toggleRoutine(selectedDate, rid)}
              isDesktop={isDesktop}
            />
          )}
          {view === 'stats' && (
            <StatsView
              weekPercent={weekPercent} monthPercent={monthPercent} todayPercent={Math.max(0, todayStats.percent)}
              totals={totals} overallCurrentStreak={overallCurrentStreak} overallLongestStreak={overallLongestStreak}
              bestDay={bestDay} mostConsistent={mostConsistent} leastConsistent={leastConsistent}
              last7={last7} routineStats={routineStats} isDesktop={isDesktop}
            />
          )}
          {view === 'routines' && (
            <RoutinesView
              routines={sortedRoutines}
              onEdit={(r) => { setModalRoutine(r); setShowModal(true); }}
              onDelete={deleteRoutine}
              onMove={moveRoutine}
              onAdd={() => { setModalRoutine(null); setShowModal(true); }}
              isDesktop={isDesktop}
            />
          )}
          {view === 'settings' && (
            <SettingsView
              darkMode={darkMode} setDarkMode={setDarkMode}
              onExport={exportData}
              confirmReset={confirmReset} setConfirmReset={setConfirmReset}
              onReset={resetData}
              isDesktop={isDesktop}
              routineCount={routines.length}
              user={user}
              onSignOut={() => signOut(auth)}
            />
          )}
        </main>
      </div>

      {!isDesktop && (
        <nav style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, background: 'var(--surface)',
          borderTop: '1px solid var(--border)', display: 'flex', paddingBottom: 'env(safe-area-inset-bottom)',
          zIndex: 40,
        }}>
          {NAV_ITEMS.map(item => (
            <button key={item.key} onClick={() => setView(item.key)} style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
              padding: '10px 0 8px', border: 'none', background: 'transparent',
              color: view === item.key ? 'var(--accent)' : 'var(--text-muted)',
            }}>
              <item.icon size={21} strokeWidth={2.2} />
              <span style={{ fontSize: 10.5, fontWeight: 600 }}>{item.label}</span>
            </button>
          ))}
        </nav>
      )}

      {showModal && (
        <RoutineModal
          initial={modalRoutine}
          onSave={saveRoutine}
          onClose={() => { setShowModal(false); setModalRoutine(null); }}
        />
      )}
    </div>
  );
}

function StatusChip({ percent }) {
  let color = 'var(--text-muted)', label = 'No routines';
  if (percent >= 80) { color = 'var(--success)'; label = 'Excellent'; }
  else if (percent >= 1) { color = 'var(--warning)'; label = 'Partial'; }
  else if (percent === 0) { color = 'var(--danger)'; label = 'Missed'; }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color }}>
      <span style={{ width: 7, height: 7, borderRadius: 99, background: color }} />
      {label}
    </span>
  );
}

function RoutineRow({ routine, done, onToggle, time }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px',
      background: 'var(--surface)', borderRadius: 16, border: '1px solid var(--border)', marginBottom: 10,
    }}>
      <button className="arc-checkbox" onClick={onToggle} style={{
        width: 32, height: 32, borderRadius: 10, flexShrink: 0, border: `2px solid ${done ? 'var(--accent)' : 'var(--border)'}`,
        background: done ? 'var(--accent)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {done && <Check size={18} color="#fff" strokeWidth={3} />}
      </button>
      <div style={{ fontSize: 22, flexShrink: 0 }}>{routine.icon || '•'}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 15, textDecoration: done ? 'line-through' : 'none', opacity: done ? 0.6 : 1 }}>
          {routine.name}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 2 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{routine.category}</span>
          {routine.time && <><span style={{ color: 'var(--border)' }}>·</span><span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{fmtTime12(routine.time)}</span></>}
        </div>
      </div>
      {done && time && <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }} className="num-font">{fmtTime12(time)}</span>}
    </div>
  );
}

function PageWrap({ children, isDesktop }) {
  return (
    <div className="arc-scroll arc-fade-in" style={{ maxWidth: 640, margin: isDesktop ? '0' : '0 auto', padding: isDesktop ? '32px 40px' : '20px 16px 24px' }}>
      {children}
    </div>
  );
}

function HomeView({ routines, logs, stats, onToggle, isDesktop, overallCurrentStreak, onAdd }) {
  const dayStr = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning, S D' : hour < 18 ? 'Good afternoon, S D' : 'Good evening, S D';
  const pct = Math.max(0, stats.percent);
  const color = pct >= 80 ? 'var(--success)' : pct >= 1 ? 'var(--warning)' : 'var(--accent)';
  return (
    <PageWrap isDesktop={isDesktop}>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 600 }}>{dayStr}</div>
      <h1 className="num-font" style={{ fontSize: 26, fontWeight: 700, margin: '2px 0 24px', letterSpacing: '-0.01em' }}>{greeting}</h1>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 24, background: 'var(--surface)',
        border: '1px solid var(--border)', borderRadius: 20, padding: '22px 24px', marginBottom: 24,
      }}>
        <ArcRing percent={pct} size={104} stroke={9} color={color}>
          <span className="num-font" style={{ fontSize: 24, fontWeight: 700 }}>{pct}%</span>
        </ArcRing>
        <div>
          <div className="num-font" style={{ fontSize: 17, fontWeight: 700 }}>{stats.completed.length} of {stats.scheduled.length} completed</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 3 }}>
            {stats.scheduled.length === 0 ? 'No routines scheduled today' : pct === 100 ? 'Perfect day — every routine done' : 'Keep going, you\u2019ve got this'}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10 }}>
            <Flame size={15} color="var(--accent)" />
            <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)' }}>{overallCurrentStreak}-day streak</span>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Today's routines</span>
        <button onClick={onAdd} style={{ display: 'flex', alignItems: 'center', gap: 4, border: 'none', background: 'transparent', color: 'var(--accent)', fontWeight: 600, fontSize: 13 }}>
          <Plus size={15} /> Add
        </button>
      </div>

      {stats.scheduled.length === 0 ? (
        <EmptyState onAdd={onAdd} text="Nothing scheduled for today yet. Add your first routine to get started." />
      ) : (
        stats.scheduled.map(r => (
          <RoutineRow key={r.id} routine={r} done={!!logs[todayKey()]?.[r.id]?.completed} time={logs[todayKey()]?.[r.id]?.time} onToggle={() => onToggle(r.id)} />
        ))
      )}
    </PageWrap>
  );
}

function EmptyState({ onAdd, text }) {
  return (
    <div style={{ textAlign: 'center', padding: '36px 20px', border: '1px dashed var(--border)', borderRadius: 18 }}>
      <div style={{ fontSize: 13.5, color: 'var(--text-muted)', marginBottom: 14, lineHeight: 1.5 }}>{text}</div>
      {onAdd && (
        <button onClick={onAdd} style={{ border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 600, fontSize: 13.5, padding: '10px 18px', borderRadius: 12 }}>
          Add a routine
        </button>
      )}
    </div>
  );
}

function CalendarView({ routines, logs, calendarMonth, setCalendarMonth, selectedDate, setSelectedDate, selectedStats, onToggle, isDesktop }) {
  const year = calendarMonth.getFullYear(), month = calendarMonth.getMonth();
  const firstDay = new Date(year, month, 1);
  const startOffset = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));

  const selDate = parseKey(selectedDate);

  return (
    <PageWrap isDesktop={isDesktop}>
      <h1 className="num-font" style={{ fontSize: 22, fontWeight: 700, marginBottom: 20 }}>Calendar</h1>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: 18, marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <button onClick={() => setCalendarMonth(new Date(year, month - 1, 1))} style={{ border: 'none', background: 'var(--surface-alt)', borderRadius: 10, padding: 8 }}>
            <ChevronLeft size={16} />
          </button>
          <span className="num-font" style={{ fontWeight: 700, fontSize: 15 }}>{monthLabel(calendarMonth)}</span>
          <button onClick={() => setCalendarMonth(new Date(year, month + 1, 1))} style={{ border: 'none', background: 'var(--surface-alt)', borderRadius: 10, padding: 8 }}>
            <ChevronRight size={16} />
          </button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4, marginBottom: 6 }}>
          {WEEKDAY_LABELS.map((w, i) => (
            <div key={i} style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>{w}</div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4 }}>
          {cells.map((d, i) => {
            if (!d) return <div key={i} />;
            const key = dateKey(d);
            const isFuture = d > new Date();
            const s = computeDayStats(key, routines, logs);
            const isSelected = key === selectedDate;
            const isToday = key === todayKey();
            let color = 'var(--border)';
            if (!isFuture && s.percent >= 80) color = 'var(--success)';
            else if (!isFuture && s.percent >= 1) color = 'var(--warning)';
            else if (!isFuture && s.percent === 0) color = 'var(--danger)';
            return (
              <button key={i} onClick={() => setSelectedDate(key)} style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '4px 0 6px',
                border: 'none', background: isSelected ? 'var(--accent-soft)' : 'transparent', borderRadius: 12,
              }}>
                <div style={{ position: 'relative', width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {!isFuture && s.percent >= 0 && (
                    <div style={{ position: 'absolute', inset: 0 }}><MiniArc percent={Math.max(8, s.percent)} color={color} /></div>
                  )}
                  <span className="num-font" style={{
                    fontSize: 12, fontWeight: isToday ? 800 : 600,
                    color: isToday ? 'var(--accent)' : 'var(--text)',
                  }}>{d.getDate()}</span>
                </div>
              </button>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 14, marginTop: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
          <LegendDot color="var(--success)" label="Excellent" />
          <LegendDot color="var(--warning)" label="Partial" />
          <LegendDot color="var(--danger)" label="Missed" />
        </div>
      </div>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <span className="num-font" style={{ fontWeight: 700, fontSize: 15 }}>{dayLabel(selDate)}</span>
          {selectedStats.percent >= 0 && <StatusChip percent={selectedStats.percent} />}
        </div>
        {selectedStats.scheduled.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 14 }}>No routines were scheduled this day.</div>
        ) : (
          <>
            <div className="num-font" style={{ fontSize: 13, color: 'var(--text-muted)', margin: '4px 0 14px' }}>
              {selectedStats.completed.length} of {selectedStats.scheduled.length} completed · {Math.max(0, selectedStats.percent)}%
            </div>
            {selDate <= new Date() && selectedStats.scheduled.map(r => (
              <RoutineRow key={r.id} routine={r} done={!!logs[selectedDate]?.[r.id]?.completed} time={logs[selectedDate]?.[r.id]?.time} onToggle={() => onToggle(r.id)} />
            ))}
            {selDate > new Date() && selectedStats.scheduled.map(r => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 4px', color: 'var(--text-muted)', fontSize: 14 }}>
                <span style={{ fontSize: 18 }}>{r.icon}</span> {r.name}
              </div>
            ))}
          </>
        )}
      </div>
    </PageWrap>
  );
}

function LegendDot({ color, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 8, height: 8, borderRadius: 99, background: color }} />
      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{label}</span>
    </div>
  );
}

function StatCard({ label, value, sub }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: '16px 18px' }}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 6 }}>{label}</div>
      <div className="num-font" style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function StatsView({ weekPercent, monthPercent, todayPercent, totals, overallCurrentStreak, overallLongestStreak, bestDay, mostConsistent, leastConsistent, last7, routineStats, isDesktop }) {
  return (
    <PageWrap isDesktop={isDesktop}>
      <h1 className="num-font" style={{ fontSize: 22, fontWeight: 700, marginBottom: 20 }}>Statistics</h1>

      <div style={{ display: 'flex', gap: 16, marginBottom: 20, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: '18px 20px', justifyContent: 'space-around', flexWrap: 'wrap' }}>
        <RingStat percent={todayPercent} label="Today" />
        <RingStat percent={weekPercent} label="This week" />
        <RingStat percent={monthPercent} label="This month" />
      </div>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: '18px 20px', marginBottom: 20 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Last 7 days</div>
        <div style={{ height: 140 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={last7} barCategoryGap="28%">
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
              <YAxis hide domain={[0, 100]} />
              <Tooltip cursor={{ fill: 'var(--surface-alt)' }} formatter={(v) => [`${v}%`, 'Completion']} contentStyle={{ fontSize: 12, borderRadius: 10, border: '1px solid var(--border)' }} />
              <Bar dataKey="percent" radius={[6, 6, 6, 6]}>
                {last7.map((e, i) => (
                  <Cell key={i} fill={e.percent >= 80 ? '#2FA875' : e.percent >= 1 ? '#E4A63A' : '#E2645C'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isDesktop ? 'repeat(2,1fr)' : 'repeat(2,1fr)', gap: 12, marginBottom: 20 }}>
        <StatCard label="Current streak" value={`${overallCurrentStreak}d`} sub="Consecutive full days" />
        <StatCard label="Longest streak" value={`${overallLongestStreak}d`} sub="Personal best" />
        <StatCard label="Total completed" value={totals.completed} />
        <StatCard label="Total missed" value={totals.missed} />
        <StatCard label="Best day" value={bestDay.name} sub={`${bestDay.avg}% avg completion`} />
        <StatCard label="Most consistent" value={mostConsistent ? `${mostConsistent.icon} ${mostConsistent.name}` : '—'} sub={mostConsistent ? `${mostConsistent.rate}% completion` : ''} />
      </div>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: '18px 20px' }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>Routine consistency</div>
        {routineStats.map(r => (
          <div key={r.id} style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
                <span>{r.icon}</span> {r.name}
                {leastConsistent?.id === r.id && r.rate < 100 && <span style={{ fontSize: 10.5, color: 'var(--danger)', fontWeight: 700 }}>NEEDS FOCUS</span>}
              </span>
              <span className="num-font" style={{ color: 'var(--text-muted)' }}>{r.rate}%</span>
            </div>
            <div style={{ height: 7, background: 'var(--surface-alt)', borderRadius: 99, overflow: 'hidden' }}>
              <div style={{ width: `${r.rate}%`, height: '100%', background: CATEGORY_COLORS[r.category] || 'var(--accent)', borderRadius: 99, transition: 'width .5s ease' }} />
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 5, fontSize: 11, color: 'var(--text-muted)' }}>
              <span>🔥 {r.currentStreak}d current</span>
              <span>🏆 {r.longestStreak}d longest</span>
            </div>
          </div>
        ))}
      </div>
    </PageWrap>
  );
}

function RingStat({ percent, label }) {
  const color = percent >= 80 ? 'var(--success)' : percent >= 1 ? 'var(--warning)' : 'var(--accent)';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <ArcRing percent={percent} size={72} stroke={7} color={color}>
        <span className="num-font" style={{ fontSize: 15, fontWeight: 700 }}>{percent}%</span>
      </ArcRing>
      <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>{label}</span>
    </div>
  );
}

function RoutinesView({ routines, onEdit, onDelete, onMove, onAdd, isDesktop }) {
  return (
    <PageWrap isDesktop={isDesktop}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h1 className="num-font" style={{ fontSize: 22, fontWeight: 700 }}>Routines</h1>
        <button onClick={onAdd} style={{ display: 'flex', alignItems: 'center', gap: 6, border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 600, fontSize: 13, padding: '9px 14px', borderRadius: 12 }}>
          <Plus size={15} /> Add routine
        </button>
      </div>
      {routines.length === 0 && <EmptyState onAdd={onAdd} text="You haven't added any routines yet." />}
      {routines.map((r, i) => (
        <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: '12px 14px', marginBottom: 10 }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <button onClick={() => onMove(r.id, -1)} disabled={i === 0} style={{ border: 'none', background: 'transparent', color: i === 0 ? 'var(--border)' : 'var(--text-muted)', padding: 2 }}><ArrowUp size={13} /></button>
            <button onClick={() => onMove(r.id, 1)} disabled={i === routines.length - 1} style={{ border: 'none', background: 'transparent', color: i === routines.length - 1 ? 'var(--border)' : 'var(--text-muted)', padding: 2 }}><ArrowDown size={13} /></button>
          </div>
          <div style={{ fontSize: 22 }}>{r.icon}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 14.5 }}>{r.name}</div>
            <div style={{ display: 'flex', gap: 6, fontSize: 12, color: 'var(--text-muted)', marginTop: 2, flexWrap: 'wrap' }}>
              <span style={{ color: CATEGORY_COLORS[r.category], fontWeight: 600 }}>{r.category}</span>
              {r.time && <><span>·</span><span>{fmtTime12(r.time)}</span></>}
              {Array.isArray(r.recurrence) && <><span>·</span><span>{r.recurrence.map(d => WEEKDAY_LABELS[d]).join(' ')}</span></>}
            </div>
          </div>
          <button onClick={() => onEdit(r)} style={{ border: 'none', background: 'var(--surface-alt)', borderRadius: 10, padding: 8 }}><Pencil size={14} /></button>
          <button onClick={() => onDelete(r.id)} style={{ border: 'none', background: 'var(--surface-alt)', borderRadius: 10, padding: 8, color: 'var(--danger)' }}><Trash2 size={14} /></button>
        </div>
      ))}
    </PageWrap>
  );
}

function RoutineModal({ initial, onSave, onClose }) {
  const [name, setName] = useState(initial?.name || '');
  const [icon, setIcon] = useState(initial?.icon || '✅');
  const [category, setCategory] = useState(initial?.category || 'Health');
  const [time, setTime] = useState(initial?.time || '');
  const [notes, setNotes] = useState(initial?.notes || '');
  const [customDays, setCustomDays] = useState(Array.isArray(initial?.recurrence));
  const [days, setDays] = useState(Array.isArray(initial?.recurrence) ? initial.recurrence : []);

  function toggleDay(d) {
    setDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort());
  }
  function handleSave() {
    if (!name.trim()) return;
    onSave({
      id: initial?.id, name: name.trim(), icon: icon || '✅', category, time, notes,
      recurrence: customDays ? days : 'daily', order: initial?.order, createdAt: initial?.createdAt,
    });
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(20,19,32,0.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 60 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: 'var(--surface)', width: '100%', maxWidth: 480, borderRadius: '24px 24px 0 0',
        padding: '20px 20px calc(20px + env(safe-area-inset-bottom))', maxHeight: '86vh', overflowY: 'auto',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <span className="num-font" style={{ fontWeight: 700, fontSize: 17 }}>{initial ? 'Edit routine' : 'New routine'}</span>
          <button onClick={onClose} style={{ border: 'none', background: 'var(--surface-alt)', borderRadius: 10, padding: 7 }}><X size={16} /></button>
        </div>

        <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
          <input value={icon} onChange={e => setIcon(e.target.value.slice(0, 2))} placeholder="🎯" style={{ width: 56, textAlign: 'center', fontSize: 22, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--bg)', color: 'var(--text)' }} />
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Routine name" style={{ flex: 1, fontSize: 15, fontWeight: 600, padding: '0 14px', border: '1px solid var(--border)', borderRadius: 12, background: 'var(--bg)', color: 'var(--text)', height: 48 }} />
        </div>

        <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>Category</label>
        <div style={{ display: 'flex', gap: 8, margin: '8px 0 14px', flexWrap: 'wrap' }}>
          {CATEGORIES.map(c => (
            <button key={c} onClick={() => setCategory(c)} style={{
              border: `1.5px solid ${category === c ? CATEGORY_COLORS[c] : 'var(--border)'}`,
              background: category === c ? CATEGORY_COLORS[c] + '22' : 'transparent',
              color: category === c ? CATEGORY_COLORS[c] : 'var(--text-muted)',
              borderRadius: 99, padding: '7px 14px', fontSize: 12.5, fontWeight: 600,
            }}>{c}</button>
          ))}
        </div>

        <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>Time (optional)</label>
        <input type="time" value={time} onChange={e => setTime(e.target.value)} style={{ display: 'block', margin: '8px 0 14px', fontSize: 14, padding: '0 12px', border: '1px solid var(--border)', borderRadius: 12, background: 'var(--bg)', color: 'var(--text)', height: 44, width: '100%' }} />

        <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>Repeats</label>
        <div style={{ display: 'flex', gap: 8, margin: '8px 0 10px' }}>
          <button onClick={() => setCustomDays(false)} style={{ flex: 1, border: `1.5px solid ${!customDays ? 'var(--accent)' : 'var(--border)'}`, background: !customDays ? 'var(--accent-soft)' : 'transparent', color: !customDays ? 'var(--accent)' : 'var(--text-muted)', borderRadius: 12, padding: '9px 0', fontSize: 13, fontWeight: 600 }}>Every day</button>
          <button onClick={() => setCustomDays(true)} style={{ flex: 1, border: `1.5px solid ${customDays ? 'var(--accent)' : 'var(--border)'}`, background: customDays ? 'var(--accent-soft)' : 'transparent', color: customDays ? 'var(--accent)' : 'var(--text-muted)', borderRadius: 12, padding: '9px 0', fontSize: 13, fontWeight: 600 }}>Custom days</button>
        </div>
        {customDays && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
            {WEEKDAY_LABELS.map((w, i) => (
              <button key={i} onClick={() => toggleDay(i)} style={{
                width: 36, height: 36, borderRadius: 10, border: `1.5px solid ${days.includes(i) ? 'var(--accent)' : 'var(--border)'}`,
                background: days.includes(i) ? 'var(--accent)' : 'transparent', color: days.includes(i) ? '#fff' : 'var(--text-muted)', fontSize: 12.5, fontWeight: 700,
              }}>{w}</button>
            ))}
          </div>
        )}

        <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>Notes</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Any extra detail…" style={{ width: '100%', marginTop: 8, marginBottom: 18, fontSize: 13.5, padding: 12, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--bg)', color: 'var(--text)', resize: 'none', fontFamily: 'inherit' }} />

        <button onClick={handleSave} disabled={!name.trim()} style={{
          width: '100%', border: 'none', background: name.trim() ? 'var(--accent)' : 'var(--border)', color: '#fff',
          fontWeight: 700, fontSize: 14.5, padding: '14px 0', borderRadius: 14,
        }}>{initial ? 'Save changes' : 'Add routine'}</button>
      </div>
    </div>
  );
}

function SettingsView({ darkMode, setDarkMode, onExport, confirmReset, setConfirmReset, onReset, isDesktop, routineCount, user, onSignOut }) {
  return (
    <PageWrap isDesktop={isDesktop}>
      <h1 className="num-font" style={{ fontSize: 22, fontWeight: 700, marginBottom: 20 }}>Settings</h1>

      <SettingsRow icon={Sparkles} title={user?.displayName || 'Account'} desc={user?.email || 'Signed in'}>
        <button onClick={onSignOut} style={{ border: '1px solid var(--border)', background: 'var(--surface-alt)', borderRadius: 10, padding: '8px 14px', fontSize: 12.5, fontWeight: 600 }}>Sign out</button>
      </SettingsRow>

      <SettingsRow icon={darkMode ? Moon : Sun} title="Appearance" desc={darkMode ? 'Dark mode is on' : 'Light mode is on'}>
        <button onClick={() => setDarkMode(!darkMode)} style={{
          width: 46, height: 27, borderRadius: 99, border: 'none', background: darkMode ? 'var(--accent)' : 'var(--border)',
          position: 'relative', flexShrink: 0,
        }}>
          <span style={{ position: 'absolute', top: 3, left: darkMode ? 22 : 3, width: 21, height: 21, borderRadius: 99, background: '#fff', transition: 'left .18s ease' }} />
        </button>
      </SettingsRow>

      <SettingsRow icon={Download} title="Export your data" desc="Download all routines and history as JSON">
        <button onClick={onExport} style={{ border: '1px solid var(--border)', background: 'var(--surface-alt)', borderRadius: 10, padding: '8px 14px', fontSize: 12.5, fontWeight: 600 }}>Export</button>
      </SettingsRow>

      <SettingsRow icon={RotateCcw} title="Reset all data" desc="Erase routines and history, start fresh">
        {!confirmReset ? (
          <button onClick={() => setConfirmReset(true)} style={{ border: '1px solid var(--danger)', color: 'var(--danger)', background: 'transparent', borderRadius: 10, padding: '8px 14px', fontSize: 12.5, fontWeight: 600 }}>Reset</button>
        ) : (
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={onReset} style={{ border: 'none', background: 'var(--danger)', color: '#fff', borderRadius: 10, padding: '8px 12px', fontSize: 12.5, fontWeight: 600 }}>Confirm</button>
            <button onClick={() => setConfirmReset(false)} style={{ border: '1px solid var(--border)', background: 'transparent', borderRadius: 10, padding: '8px 12px', fontSize: 12.5, fontWeight: 600 }}>Cancel</button>
          </div>
        )}
      </SettingsRow>

      <div style={{ marginTop: 28, padding: '18px 20px', background: 'var(--surface-alt)', borderRadius: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 6 }}>Install Arc Tracker</div>
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          On iPhone, open this app in Safari, tap the Share icon, then "Add to Home Screen" to use Arc Tracker like a native app.
          You're tracking {routineCount} routine{routineCount === 1 ? '' : 's'}. Sign in with the same Google account on any device to keep your data in sync.
        </div>
      </div>
    </PageWrap>
  );
}

function SettingsRow({ icon: Icon, title, desc, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: '14px 16px', marginBottom: 10 }}>
      <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--surface-alt)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon size={17} color="var(--accent)" />
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{title}</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 1 }}>{desc}</div>
      </div>
      {children}
    </div>
  );
}

function SignInScreen({ cssVars, onSignIn }) {
  return (
    <div style={{ ...cssVars, background: 'var(--bg)', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Inter', sans-serif", padding: 20 }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap');`}</style>
      <div style={{ textAlign: 'center', maxWidth: 320 }}>
        <div style={{ width: 56, height: 56, borderRadius: 16, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
          <Sparkles size={26} color="#fff" />
        </div>
        <h1 className="num-font" style={{ fontSize: 22, fontWeight: 700, marginBottom: 8, color: 'var(--text)' }}>Arc Tracker</h1>
        <p style={{ fontSize: 13.5, color: 'var(--text-muted)', marginBottom: 24, lineHeight: 1.5 }}>
          Sign in to keep your routines synced between your phone and computer.
        </p>
        <button onClick={onSignIn} style={{
          display: 'inline-flex', alignItems: 'center', gap: 10, border: '1px solid var(--border)',
          background: 'var(--surface)', borderRadius: 12, padding: '12px 22px', fontWeight: 600, fontSize: 14, color: 'var(--text)',
        }}>
          Continue with Google
        </button>
      </div>
    </div>
  );
}
