import { useEffect, useRef, useState, useCallback } from "react";
import CardView from "./components/CardView";
import "./App.css";
import {
  canPickStack, dealFromStock, moveStack, newGame, rankLabel, suitLabel, undo,
} from "./game/game";
import { buildAutoCompleteSequence, getStateSignature, isAutoCompleteReady, analyzeDanger } from "./game/autoComplete";
import type { DangerLevel } from "./game/autoComplete";
import type { GameState, Card, Difficulty } from "./game/types";

const DRAG_THRESHOLD = 6;

let _audioCtx: AudioContext | null = null;
async function getAudioCtx(): Promise<AudioContext | null> {
  try {
    if (!_audioCtx) _audioCtx = new AudioContext();
    if (_audioCtx.state === "suspended") await _audioCtx.resume();
    return _audioCtx;
  } catch (_) { return null; }
}
async function playCardMove() {
  const ctx = await getAudioCtx(); if (!ctx) return;
  try {
    const sz = Math.floor(ctx.sampleRate * 0.07);
    const buf = ctx.createBuffer(1, sz, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < sz; i++) d[i] = (Math.random()*2-1) * Math.pow(1-i/sz, 2.5);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 800; f.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.6, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.07);
    src.connect(f); f.connect(g); g.connect(ctx.destination); src.start();
  } catch (_) {}
}
async function playStackClear() {
  const ctx = await getAudioCtx(); if (!ctx) return;
  try {
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination); o.type = "sine";
    o.frequency.setValueAtTime(280, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(1500, ctx.currentTime + 0.4);
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(0.32, ctx.currentTime + 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.42);
    o.start(ctx.currentTime); o.stop(ctx.currentTime + 0.45);
  } catch (_) {}
}
async function playWinSound() {
  const ctx = await getAudioCtx(); if (!ctx) return;
  try {
    [523,659,784,1047].forEach((freq,i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value = freq; o.type = "sine";
      const t = ctx.currentTime + i*0.18;
      g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(0.35,t+0.05);
      g.gain.exponentialRampToValueAtTime(0.001,t+0.5);
      o.start(t); o.stop(t+0.5);
    });
  } catch (_) {}
}
async function playLoseSound() {
  const ctx = await getAudioCtx(); if (!ctx) return;
  try {
    [400,350,300,250].forEach((freq,i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value = freq; o.type = "sine";
      const t = ctx.currentTime + i*0.22;
      g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(0.25,t+0.05);
      g.gain.exponentialRampToValueAtTime(0.001,t+0.5);
      o.start(t); o.stop(t+0.5);
    });
  } catch (_) {}
}

const AUTO_LINES = [
  // 후루베 유라유라 시리즈
  "후루베 유라유라… 별수 없으니 내가 마무리해준다.",
  "후루베 유라유라… 네가 못 하니까 어쩔 수 없잖아.",
  "후루베 유라유라… 감사하단 말은 필요없어.",
  "후루베 유라유라… 시간 낭비하지 말고 끝내자.",
  "후루베 유라유라… 딱 이번 한 번만이야.",
  "후루베 유라유라… 이 정도면 나한테 빚진 거야.",
  "후루베 유라유라… 떠들지 마. 집중해야 하니까.",
  // 냉소/무심 시리즈
  "...도구는 쓸 줄 알아야 하는 법이야. 써줄게.",
  "내가 나서는 건 딱히 너를 위해서가 아니야.",
  "효율이 떨어져. 내가 끝낸다.",
  "시간이 아까워. 내가 한다.",
  "말 시키지 마. 그냥 보고 있어.",
  "...이걸 못 끝낸다고? 어쩔 수 없네.",
  "십종영법까지 쓸 필요도 없겠군.",
  "이 정도 패턴, 읽는 데 3초면 충분해.",
  "복잡하게 생각하지 마. 순서대로 하면 돼.",
];
const NOT_READY_LINES = [
  "아직 멀었어. 스스로 해봐.",
  "지금은 안 돼. 더 해봐.",
  "아직이야. 포기하지 마.",
  "이 정도로 도움을 청하는 거야?",
  "좀 더 생각해봐. 아직 수가 있을 거야.",
  "...눈 똑바로 떠. 길이 보일 거야.",
  "포기가 빠르네. 조금만 더.",
  "내가 나설 때가 아니야. 네가 할 수 있어.",
  "아직 덜 됐어. 카드를 다시 봐.",
  "그 수는 아직 남아있어. 잘 봐.",
];
const LOSE_LINES = [
  "졌군. 뭐 그럴 줄 알았어.",
  "이게 한계냐. 딱히 놀랍지도 않아.",
  "더 이상 수가 없어. 포기해.",
  "막혔군. 뭐, 나라도 어쩔 수 없었을 거야.",
  "끝났어. 다음엔 좀 잘해봐.",
  "...죽은 패야. 인정해.",
  "수읽기가 부족했어. 그게 전부야.",
  "영법이 통하지 않을 때도 있어. 이번이 그래.",
  "전략적 후퇴도 실력이야. 새로 시작해.",
  "...할 말 없어. 결과가 다야.",
  "이번 게임은 처음부터 꼬였어. 다시 해.",
  "패배를 인정하는 것도 용기야. 뭐.",
  "나쁘지 않은 싸움이었어. 결과가 문제지.",
  "...적어도 끝까지 뒀잖아. 그걸로 됐어.",
];

const WARNING_LINES = [
  "잠깐… 이거 좀 위험한 거 아니야? 뭐, 네 선택이지만.",
  "이 상태… 솔직히 좋지 않아. 그래도 계속할 거야?",
  "음… 수가 별로 없는데. 뭐, 포기하면 편하지.",
  "이대로 가면 막힐 것 같은데. 내가 틀릴 수도 있지만.",
  "...슬슬 경계해야 할 것 같은데.",
  "패턴이 좋지 않아. 주의해.",
  "이 방향으로 계속 가면… 음. 네 선택이야.",
  "수가 좁아지고 있어. 느끼고 있지?",
];
const DANGER_LINES = [
  "이거 거의 끝난 거 아니야? 뭐… 기적이 일어날 수도 있지.",
  "솔직히 말할게. 이건 많이 위험해. 각오해.",
  "이 상태에서 뒤집는 건… 나도 자신 없어.",
  "포기하는 게 나을 것 같은데. 그래도 계속할 거라면 말리진 않아.",
  "...거의 막다른 곳이야. 기적을 믿어봐.",
  "영역전개도 이 패는 못 뒤집어. 각오해.",
  "최악의 경우를 생각해둬. 지금 그 상황이야.",
  "탈출구가 보이지 않아. 그래도 해볼 거야?",
];

type Record_ = { plays: number; wins: number; currentStreak: number; bestStreak: number };
const RECORD_KEY = "spider_record";
function loadRecord(): Record_ {
  try { const r = localStorage.getItem(RECORD_KEY); if (r) return JSON.parse(r); } catch (_) {}
  return { plays: 0, wins: 0, currentStreak: 0, bestStreak: 0 };
}
function saveRecord(r: Record_) { try { localStorage.setItem(RECORD_KEY, JSON.stringify(r)); } catch (_) {} }

function App() {
  const [difficulty, setDifficulty] = useState<Difficulty>(2);
  const [state, setState] = useState<GameState>(() => newGame(2));
  const [showDiffModal, setShowDiffModal] = useState(false);
  const [showWin, setShowWin] = useState(false);
  const [showLose, setShowLose] = useState(false);
  const [dangerInfo, setDangerInfo] = useState<{ level: DangerLevel; reasons: string[] } | null>(null);
  const [showDangerModal, setShowDangerModal] = useState(false);
  const showDangerModalRef = useRef(false);  // 클로저 문제 방지용 ref
  const [showRecord, setShowRecord] = useState(false);
  const [record, setRecord] = useState<Record_>(() => loadRecord());
  const [isBestStreak, setIsBestStreak] = useState(false);
  const hasMovedRef = useRef(false);

  const autoRunningRef = useRef(false);
  const [autoRunning, setAutoRunning] = useState(false);
  const [animCardIds, setAnimCardIds] = useState<Set<string>>(new Set());

  // 캐릭터 이펙트
  const [charVisible, setCharVisible] = useState(false);
  const [charLine, setCharLine] = useState("");
  const [charImg, setCharImg] = useState("");
  const [charBubbleVisible, setCharBubbleVisible] = useState(false);

  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const loseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recentSigsRef = useRef<string[]>([]);
  const noProgressRef = useRef<number>(0);  // 진전 없는 이동 횟수

  const [pick, setPick] = useState<{ fromCol: number; fromIndex: number } | null>(null);
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null);
  const [ghostCards, setGhostCards] = useState<Card[]>([]);

  const pointerDownRef = useRef<{ x: number; y: number; colIdx: number; cardIdx: number; pointerId: number } | null>(null);
  const isDraggingRef = useRef(false);
  const pickRef = useRef<{ fromCol: number; fromIndex: number } | null>(null);
  const colRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [colHeight, setColHeight] = useState(() => Math.max(window.innerHeight - 180, 380));
  const [colWidth, setColWidth] = useState(60);
  const stateRef = useRef(state);
  stateRef.current = state;

  // 열 크기: resize 때만 업데이트 (초기값은 useState에서 계산)
  useEffect(() => {
    const measure = () => {
      const el = colRefs.current.find(Boolean);
      if (!el) return;
      const r = el.getBoundingClientRect();
      setColHeight(r.height);
      setColWidth(Math.max(r.width - 16, 40));
    };
    window.addEventListener("resize", measure);
    return () => { window.removeEventListener("resize", measure); };
  }, []);

  // 캐릭터 등장
  const showChar = useCallback((img: string, line: string) => {
    setCharImg(img); setCharLine(line); setCharVisible(true);
    const t = setTimeout(() => setCharBubbleVisible(true), 300);
    timersRef.current.push(t);
  }, []);

  // 캐릭터 퇴장
  const hideChar = useCallback((delay: number) => {
    const t1 = setTimeout(() => {
      setCharBubbleVisible(false);
      const t2 = setTimeout(() => setCharVisible(false), 500);
      timersRef.current.push(t2);
    }, delay);
    timersRef.current.push(t1);
  }, []);

  // ── 자동완성 실행 ──
  const runAutoComplete = useCallback((s: GameState) => {
    if (autoRunningRef.current) return;
    const moves = buildAutoCompleteSequence(s);
    if (moves.length === 0) return;

    // 최종 상태 미리 계산 (게임 로직은 여기서만)
    let finalState = s;
    for (const move of moves) {
      const next = moveStack(finalState, { fromCol: move.fromCol, fromIndex: move.fromIndex }, move.toCol);
      if (next === finalState) break;
      finalState = next;
    }

    autoRunningRef.current = true;
    setAutoRunning(true);

    showChar("/megumi.jpeg", AUTO_LINES[Math.floor(Math.random() * AUTO_LINES.length)]);

    // 애니메이션: 각 열의 카드들을 순서대로 플래시만 표시
    const INTERVAL = 60;
    const START = 1400;

    // 모든 앞면 카드를 순서대로 플래시
    const allCards: { id: string; fromCol: number; cardIdx: number }[] = [];
    s.columns.forEach((col, fromCol) => {
      col.forEach((card, cardIdx) => {
        if (card.faceUp) allCards.push({ id: card.id, fromCol, cardIdx });
      });
    });

    allCards.forEach((item, i) => {
      const t = setTimeout(() => {
        setAnimCardIds(prev => { const n = new Set(prev); n.add(item.id); return n; });
        setTimeout(() => setAnimCardIds(prev => { const n = new Set(prev); n.delete(item.id); return n; }), 80);
        playCardMove();
      }, START + i * INTERVAL);
      timersRef.current.push(t);
    });

    const totalMs = START + allCards.length * INTERVAL + 100;

    // 애니메이션 완료 후 최종 상태 한 번에 적용
    const t2 = setTimeout(() => {
      // finalState.status가 won이 아닌 경우 대비:
      // foundation 8개 완성이면 강제로 won 처리
      const appliedState = finalState.foundation.length >= 8
        ? { ...finalState, status: 'won' as const }
        : finalState;
      setState(appliedState);
      playStackClear();
      setTimeout(() => playStackClear(), 180);
      setTimeout(() => playStackClear(), 360);
    }, totalMs);
    timersRef.current.push(t2);

    // 잠금 해제
    const t3 = setTimeout(() => {
      autoRunningRef.current = false;
      setAutoRunning(false);
      setAnimCardIds(new Set());
    }, totalMs + 600);
    timersRef.current.push(t3);

    // 캐릭터 퇴장
    hideChar(totalMs + 200);
  }, [showChar, hideChar]);

  // ── 자동완성 버튼 클릭 ──
  const onAutoComplete = useCallback(() => {
    const s = stateRef.current;
    if (isAutoCompleteReady(s)) {
      runAutoComplete(s);
    } else {
      // 승리 확정 아닐 때: "아직 멀었어" 멘트만, 빠르게 퇴장
      showChar("/megumi.jpeg", NOT_READY_LINES[Math.floor(Math.random() * NOT_READY_LINES.length)]);
      hideChar(1500);
    }
  }, [runAutoComplete, showChar, hideChar]);

  // ── 패배 선언 ──
  const declareLose = useCallback(() => {
    if (autoRunningRef.current) return;
    if (stateRef.current.status !== "playing") return;
    if (stateRef.current.stock.length > 0) return;  // 스톡 남아있으면 패배 아님
    setShowLose(true);
    playLoseSound();
    showChar("/lost.webp", LOSE_LINES[Math.floor(Math.random() * LOSE_LINES.length)]);
    hideChar(3000);
    setRecord(prev => {
      const next = { ...prev, plays: prev.plays + 1, currentStreak: 0 };
      saveRecord(next); return next;
    });
    hasMovedRef.current = false;
  }, [showChar, hideChar]);

  // ── 이동 후 패배/위험 체크 ──
  const checkAfterMove = useCallback((nextState: GameState) => {
    if (autoRunningRef.current) return;
    if (nextState.status !== "playing") return;

    if (loseTimerRef.current) { clearTimeout(loseTimerRef.current); loseTimerRef.current = null; }

    const danger = analyzeDanger(nextState, noProgressRef.current);

    // 패배 확정
    if (danger.level === 'deadlock' && hasMovedRef.current) {
      loseTimerRef.current = setTimeout(() => declareLose(), 2500);
      return;
    }

    // 무한루프 감지
    if (nextState.stock.length === 0 && hasMovedRef.current) {
      const sig = getStateSignature(nextState);
      const recent = recentSigsRef.current;
      if (recent.filter(s => s === sig).length >= 3) {
        loseTimerRef.current = setTimeout(() => declareLose(), 2500);
        return;
      }
      recentSigsRef.current = [...recent.slice(-29), sig];
    }

    // 위험 경고 (스톡 없을 때만, 이미 경고 중이면 스킵)
    if (!showDangerModalRef.current && hasMovedRef.current && nextState.stock.length === 0) {
      if (danger.level === 'danger') {
        const line = DANGER_LINES[Math.floor(Math.random() * DANGER_LINES.length)];
        setDangerInfo({ level: danger.level, reasons: danger.reasons });
        showChar("/megumi.jpeg", line);
        hideChar(2000);
        showDangerModalRef.current = true;
        loseTimerRef.current = setTimeout(() => setShowDangerModal(true), 800);
      } else if (danger.level === 'warning') {
        const line = WARNING_LINES[Math.floor(Math.random() * WARNING_LINES.length)];
        showChar("/megumi.jpeg", line);
        hideChar(2200);
      }
    }
  }, [declareLose, showChar, hideChar]);

  // 승리 감지
  useEffect(() => {
    if (state.status === "won" && !showWin) {
      setShowWin(true);
      playWinSound();
      setRecord(prev => {
        const ns = prev.currentStreak + 1;
        const nb = Math.max(ns, prev.bestStreak);
        setIsBestStreak(ns > prev.bestStreak);
        const next = { plays: prev.plays + 1, wins: prev.wins + 1, currentStreak: ns, bestStreak: nb };
        saveRecord(next); return next;
      });
    }
  }, [state.status]);

  function findClosestCol(x: number): number | null {
    let best: number | null = null; let bestD = Infinity;
    colRefs.current.forEach((el, i) => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      const d = Math.abs(x - (r.left + r.width / 2));
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }

  const doMove = useCallback((s: GameState, from: { fromCol: number; fromIndex: number }, toCol: number): GameState => {
    const next = moveStack(s, from, toCol);
    if (next !== s) {
      hasMovedRef.current = true;
      // 진전 판단: foundation 증가 or 뒷면 카드 감소 or 같은 무늬 합치기
      const foundationProgress = next.foundation.length > s.foundation.length;
      const faceDownBefore = s.columns.reduce((a, c) => a + c.filter(x => !x.faceUp).length, 0);
      const faceDownAfter = next.columns.reduce((a, c) => a + c.filter(x => !x.faceUp).length, 0);
      const faceDownProgress = faceDownAfter < faceDownBefore;
      if (foundationProgress || faceDownProgress) {
        noProgressRef.current = 0;  // 진전 있으면 리셋
      } else {
        noProgressRef.current += 1;
      }
      if (foundationProgress) playStackClear(); else playCardMove();
      checkAfterMove(next);
    }
    return next;
  }, [checkAfterMove]);

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const pd = pointerDownRef.current;
      if (!pd || e.pointerId !== pd.pointerId) return;
      if (!isDraggingRef.current && Math.hypot(e.clientX - pd.x, e.clientY - pd.y) > DRAG_THRESHOLD) {
        isDraggingRef.current = true;
        const cards = stateRef.current.columns[pd.colIdx]?.slice(pd.cardIdx) ?? [];
        setGhostCards(cards.map((c): Card => ({ ...c })));
      }
      if (isDraggingRef.current) setGhostPos({ x: e.clientX, y: e.clientY });
    }
    function onUp(e: PointerEvent) {
      const pd = pointerDownRef.current;
      if (!pd || e.pointerId !== pd.pointerId) return;
      const wasDragging = isDraggingRef.current;
      pointerDownRef.current = null; isDraggingRef.current = false;
      setGhostPos(null); setGhostCards([]);
      if (wasDragging) {
        const from = { fromCol: pd.colIdx, fromIndex: pd.cardIdx };
        const toCol = findClosestCol(e.clientX);
        if (toCol !== null) setState(s => doMove(s, from, toCol));
        setPick(null); pickRef.current = null;
      } else {
        const s = stateRef.current;
        const card = s.columns[pd.colIdx]?.[pd.cardIdx];
        if (!card?.faceUp) return;
        const cur = pickRef.current;
        if (cur) {
          if (cur.fromCol === pd.colIdx && cur.fromIndex === pd.cardIdx) {
            setPick(null); pickRef.current = null;
          } else {
            setState(s2 => doMove(s2, cur, pd.colIdx));
            setPick(null); pickRef.current = null;
          }
        } else if (canPickStack(s.columns, pd.colIdx, pd.cardIdx)) {
          setPick({ fromCol: pd.colIdx, fromIndex: pd.cardIdx });
          pickRef.current = { fromCol: pd.colIdx, fromIndex: pd.cardIdx };
        }
      }
    }
    function onCancel(e: PointerEvent) {
      const pd = pointerDownRef.current;
      if (!pd || e.pointerId !== pd.pointerId) return;
      pointerDownRef.current = null; isDraggingRef.current = false;
      setGhostPos(null); setGhostCards([]);
    }
    const opts = { capture: true } as const;
    window.addEventListener("pointermove", onMove, opts);
    window.addEventListener("pointerup", onUp, opts);
    window.addEventListener("pointercancel", onCancel, opts);
    return () => {
      window.removeEventListener("pointermove", onMove, opts);
      window.removeEventListener("pointerup", onUp, opts);
      window.removeEventListener("pointercancel", onCancel, opts);
    };
  }, [doMove]);

  const startNewGame = (diff: Difficulty) => {
    timersRef.current.forEach(clearTimeout); timersRef.current = [];
    if (loseTimerRef.current) { clearTimeout(loseTimerRef.current); loseTimerRef.current = null; }
    if (hasMovedRef.current && state.status === "playing" && !showLose) {
      setRecord(prev => { const n = { ...prev, plays: prev.plays+1, currentStreak: 0 }; saveRecord(n); return n; });
    }
    hasMovedRef.current = false; recentSigsRef.current = []; noProgressRef.current = 0;
    autoRunningRef.current = false; setAutoRunning(false); setAnimCardIds(new Set());
    setCharVisible(false); setCharBubbleVisible(false);
    setDifficulty(diff); setState(newGame(diff));
    setPick(null); pickRef.current = null;
    pointerDownRef.current = null; isDraggingRef.current = false;
    setGhostPos(null); setGhostCards([]);
    setShowWin(false); setShowLose(false); setShowDangerModal(false); showDangerModalRef.current = false; setDangerInfo(null); setIsBestStreak(false);
    setShowDiffModal(false);
  };

  const onDeal = () => {
    if (autoRunning) return;
    if (loseTimerRef.current) { clearTimeout(loseTimerRef.current); loseTimerRef.current = null; }
    hasMovedRef.current = true;
    setState(s => { const next = dealFromStock(s); checkAfterMove(next); return next; });
    setPick(null); pickRef.current = null;
  };
  const onUndo = () => {
    if (autoRunning) return;
    if (loseTimerRef.current) { clearTimeout(loseTimerRef.current); loseTimerRef.current = null; }
    setState(s => undo(s)); setPick(null); pickRef.current = null;
    setShowLose(false); setShowDangerModal(false); setDangerInfo(null);
    noProgressRef.current = 0;
  };
  const resetRecord = () => {
    const e: Record_ = { plays: 0, wins: 0, currentStreak: 0, bestStreak: 0 };
    saveRecord(e); setRecord(e);
  };

  const canDeal = state.stock.length >= 10 && state.status === "playing" && !autoRunning;
  const canUndoAction = state.history.length > 0 && state.undoUsed < 3 && state.status === "playing" && !autoRunning;
  const diffLabel: Record<Difficulty, string> = { 1: "1 Suit", 2: "2 Suits", 4: "4 Suits" };
  const diffDesc: Record<Difficulty, string> = { 1: "초급", 2: "중급", 4: "고급" };
  const winRate = record.plays > 0 ? Math.round((record.wins / record.plays) * 100) : 0;
  // 자동완성 버튼: 스톡 없고 게임 중일 때 항상 표시 (승리 확정 여부는 내부에서 판단)
  const showAutoBtn = state.stock.length === 0 && state.status === "playing" && !autoRunning && !showLose;

  return (
    <div className="game">
      {/* 승리 오버레이 */}
      {showWin && (
        <div className="win-overlay" onClick={() => setShowWin(false)}>
          <div className="win-confetti">
            {Array.from({ length: 40 }).map((_, i) => (
              <div key={i} className="confetti-piece" style={{
                left: `${Math.random()*100}%`, animationDelay: `${Math.random()*1.5}s`,
                backgroundColor: ["#FFD700","#FF6B6B","#4ECDC4","#45B7D1","#96CEB4","#FFEAA7"][i%6]
              }} />
            ))}
          </div>
          <div className="win-modal">
            <div className="win-trophy">🏆</div>
            <h2 className="win-title">Victory!</h2>
            <p className="win-subtitle">모든 8개 조합을 완성했어요!</p>
            {isBestStreak && <div className="win-best-badge">🎯 베스트 갱신! {record.bestStreak}연속</div>}
            <button className="btn btn-primary win-btn" onClick={e => { e.stopPropagation(); setShowDiffModal(true); }}>다시 하기</button>
          </div>
        </div>
      )}

      {/* 패배 오버레이 */}
      {showLose && (
        <div className="lose-overlay">
          <div className="lose-modal">
            <div className="lose-icon">💀</div>
            <h2 className="lose-title">Game Over</h2>
            <p className="lose-subtitle">더 이상 유효한 이동이 없어요</p>
            <div className="lose-buttons">
              <button className="btn btn-primary" onClick={() => setShowDiffModal(true)}>새 게임</button>
              {canUndoAction && (
                <button className="btn" onClick={() => { setShowLose(false); onUndo(); }}>
                  되돌리기 ({3 - state.undoUsed}회 남음)
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 위험 경고 모달 */}
      {showDangerModal && dangerInfo && (
        <div className="modal-overlay">
          <div className="modal danger-modal">
            <div className="danger-icon">{dangerInfo.level === 'danger' ? '⚠️' : '🚨'}</div>
            <h2 className="danger-title">위험 신호</h2>
            <ul className="danger-reasons">
              {dangerInfo.reasons.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
            <p className="danger-desc">계속 진행하겠어?</p>
            <div className="lose-buttons">
              <button className="btn btn-primary" onClick={() => {
                setShowDangerModal(false); showDangerModalRef.current = false;
                setDangerInfo(null);
              }}>계속하기</button>
              <button className="btn" onClick={() => {
                setShowDangerModal(false); showDangerModalRef.current = false;
                setDangerInfo(null);
                setShowDiffModal(true);
              }}>새 게임</button>
              {canUndoAction && (
                <button className="btn" onClick={() => {
                  setShowDangerModal(false);
                  setDangerInfo(null);
                  onUndo();
                }}>되돌리기 ({3 - state.undoUsed}회 남음)</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 캐릭터 이펙트 — 화면 가운데 */}
      <div className={`char-overlay ${charVisible ? "char-visible" : ""}`}>
        <div className="char-container">
          <img src={charImg} alt="char" className="char-img" />
          <div className={`char-bubble ${charBubbleVisible ? "bubble-visible" : ""}`}>{charLine}</div>
        </div>
      </div>

      <header className="topbar">
        <div className="topbar-left">
          <h1>🕷 Spider</h1>
          <span className="diff-badge">{diffLabel[difficulty]} · {diffDesc[difficulty]}</span>
        </div>
        <div className="topbar-stats">
          <div className="stat"><span className="stat-label">완성</span><span className="stat-value">{state.foundation.length}/8</span></div>
          <div className="stat"><span className="stat-label">Undo</span><span className="stat-value">{state.undoUsed}/3</span></div>
          <button className="btn stat-record-btn" onClick={() => setShowRecord(true)}>📊 {winRate}%</button>
        </div>
        <div className="buttons">
          <button className="btn btn-primary" onClick={() => setShowDiffModal(true)}>새 게임</button>
          <button className="btn" onClick={onDeal} disabled={!canDeal}>
            카드 뽑기{state.stock.length > 0 && <span className="btn-badge">{Math.floor(state.stock.length/10)}</span>}
          </button>
          <button className="btn" onClick={onUndo} disabled={!canUndoAction}>
            되돌리기{canUndoAction && <span className="btn-badge">{3 - state.undoUsed}</span>}
          </button>
          {showAutoBtn && (
            <button className="btn btn-auto" onClick={onAutoComplete}>✨ 자동완성</button>
          )}
        </div>
      </header>

      <div className="board-wrapper">
        <div className="foundation-area">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className={`foundation-slot ${i < state.foundation.length ? "filled" : ""}`}>
              {i < state.foundation.length ? "♠" : ""}
            </div>
          ))}
        </div>
        <div className="stock-area" onClick={canDeal ? onDeal : undefined}>
          {state.stock.length > 0 ? (
            <div className="stock-stack">
              {Array.from({ length: Math.min(Math.ceil(state.stock.length/10), 5) }).map((_, i) => (
                <div key={i} className="stock-card" style={{ transform: `translateY(${-i*3}px) translateX(${i*2}px)` }} />
              ))}
              <span className="stock-count">{Math.floor(state.stock.length/10)}</span>
            </div>
          ) : <div className="stock-empty">비었음</div>}
        </div>

        <div className={`board ${autoRunning ? "auto-running" : ""}`}>
          {state.columns.map((col, colIdx) => (
            <div className="column" key={colIdx}
              ref={el => { colRefs.current[colIdx] = el; }}
              onPointerUp={() => {
                if (!isDraggingRef.current && col.length === 0 && pickRef.current) {
                  const cur = pickRef.current;
                  setState(s => doMove(s, cur, colIdx));
                  setPick(null); pickRef.current = null;
                }
              }}
            >
              {col.length === 0 && <div className="empty-col-hint">빈 열</div>}
              {col.map((card, cardIdx) => {
                const isSelected = pick?.fromCol === colIdx && pick?.fromIndex === cardIdx;
                const isFlashing = animCardIds.has(card.id);
                const topPx = (() => {
                  if (col.length <= 1) return 8;
                  const cardH = colHeight * 0.55;
                  const avail = colHeight - cardH - 16;
                  const naturalStep = avail / (col.length - 1);

                  // 뒷면 카드: 작게 접기 (8px)
                  // 앞면 카드: 숫자가 보일 만큼 (최소 20px)
                  // 단, 전체 avail을 넘지 않도록 동적 조정
                  const faceDownCount = col.slice(0, cardIdx).filter(c => !c.faceUp).length;
                  const faceUpCount = col.slice(0, cardIdx).filter(c => c.faceUp).length;

                  const downStep = Math.min(8, naturalStep);
                  const totalDown = col.filter(c => !c.faceUp).length;
                  const totalUp = col.filter(c => c.faceUp).length;
                  const remainAvail = avail - downStep * totalDown;
                  const upStep = totalUp > 0
                    ? Math.max(20, Math.min(remainAvail / Math.max(totalUp, 1), 30))
                    : 20;

                  return 8 + downStep * faceDownCount + upStep * faceUpCount;
                })();
                return (
                  <div
                    className={`card ${card.faceUp ? "up" : "down"} ${(card.suit==="H"||card.suit==="D") ? "redCard" : ""} ${isSelected ? "selected" : ""} ${isFlashing ? "card-autocomplete-flash" : ""}`}
                    key={card.id}
                    style={{ top: topPx, zIndex: isSelected ? 500 : card.faceUp ? 100+cardIdx : cardIdx }}
                    onPointerDown={e => {
                      if (autoRunning || showLose) return;
                      if (!card.faceUp || !canPickStack(state.columns, colIdx, cardIdx)) return;
                      e.preventDefault(); e.stopPropagation();
                      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
                      pointerDownRef.current = { x: e.clientX, y: e.clientY, colIdx, cardIdx, pointerId: e.pointerId };
                      isDraggingRef.current = false;
                      getAudioCtx();
                    }}
                    title={card.faceUp ? `${rankLabel(card.rank)}${suitLabel(card.suit)}` : ""}
                  >
                    <CardView card={card} selected={isSelected} />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {ghostPos && ghostCards.length > 0 && (
        <div className="ghost-stack" style={{ left: ghostPos.x, top: ghostPos.y, width: colWidth }}>
          {ghostCards.map((card, idx) => (
            <div key={card.id}
              className={`ghost-card card up ${(card.suit==="H"||card.suit==="D") ? "redCard" : ""}`}
              style={{ top: idx * Math.min(28, colWidth*0.32), width: colWidth }}>
              <CardView card={card} />
            </div>
          ))}
        </div>
      )}

      {showRecord && (
        <div className="modal-overlay" onClick={() => setShowRecord(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>📊 전적</h2>
            <div className="record-grid">
              <div className="record-item"><span className="record-label">플레이</span><span className="record-value">{record.plays}</span></div>
              <div className="record-item"><span className="record-label">성공</span><span className="record-value">{record.wins}</span></div>
              <div className="record-item"><span className="record-label">성공률</span><span className="record-value">{winRate}%</span></div>
              <div className="record-item"><span className="record-label">연속 성공</span><span className="record-value">{record.currentStreak}</span></div>
              <div className="record-item record-item-wide">
                <span className="record-label">최고 연속</span>
                <span className="record-value record-best">{record.bestStreak}
                  {record.currentStreak > 0 && record.currentStreak === record.bestStreak && record.bestStreak > 0 &&
                    <span className="best-tag">🎯 베스트</span>}
                </span>
              </div>
            </div>
            <div className="record-actions">
              <button className="btn btn-danger" onClick={resetRecord}>전적 초기화</button>
              <button className="btn" onClick={() => setShowRecord(false)}>닫기</button>
            </div>
          </div>
        </div>
      )}

      {showDiffModal && (
        <div className="modal-overlay" onClick={() => setShowDiffModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>난이도 선택</h2>
            <p>새 게임을 시작할 난이도를 선택하세요</p>
            <div className="diff-options">
              {([1,2,4] as Difficulty[]).map(d => (
                <button key={d} className={`diff-btn ${difficulty===d ? "active" : ""}`} onClick={() => startNewGame(d)}>
                  <span className="diff-suits">{d===1 ? "♠" : d===2 ? "♠♥" : "♠♥♦♣"}</span>
                  <span className="diff-name">{diffLabel[d]}</span>
                  <span className="diff-sub">{diffDesc[d]}</span>
                </button>
              ))}
            </div>
            <button className="btn" onClick={() => setShowDiffModal(false)}>취소</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
