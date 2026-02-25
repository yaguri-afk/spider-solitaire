import { useEffect, useRef, useState, useCallback } from "react";
import CardView from "./components/CardView";
import "./App.css";
import {
  canPickStack,
  dealFromStock,
  moveStack,
  newGame,
  rankLabel,
  suitLabel,
  undo,
} from "./game/game";
import { canAutoComplete, buildAutoCompleteSequence } from "./game/autoComplete";
import type { GameState, Card, Difficulty } from "./game/types";

const DRAG_THRESHOLD = 6;

// ── AudioContext 싱글턴 ──
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
    const bufferSize = Math.floor(ctx.sampleRate * 0.07);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++)
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 2.5);
    const source = ctx.createBufferSource(); source.buffer = buffer;
    const filter = ctx.createBiquadFilter(); filter.type = "bandpass"; filter.frequency.value = 800; filter.Q.value = 1.2;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.6, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.07);
    source.connect(filter); filter.connect(gain); gain.connect(ctx.destination); source.start();
  } catch (_) {}
}
async function playStackClear() {
  const ctx = await getAudioCtx(); if (!ctx) return;
  try {
    const osc = ctx.createOscillator(); const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(280, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1500, ctx.currentTime + 0.4);
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.32, ctx.currentTime + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.42);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.45);
  } catch (_) {}
}
async function playWinSound() {
  const ctx = await getAudioCtx(); if (!ctx) return;
  try {
    [523, 659, 784, 1047].forEach((freq, i) => {
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = freq; osc.type = "sine";
      const t = ctx.currentTime + i * 0.18;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.35, t + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      osc.start(t); osc.stop(t + 0.5);
    });
  } catch (_) {}
}

// 토토로 대사 목록
const TOTORO_LINES = [
  "다 됐어! 내가 도와줄게~ 🌿",
  "후후, 이건 식은 죽 먹기야! 🍃",
  "걱정 마, 토토로한테 맡겨! 🌳",
  "자동완성 발동! 어라라~ ✨",
  "조금만 기다려, 금방 끝내줄게! 🐾",
];

// ── 전적 타입 & localStorage 유틸 ──
type Record_ = { plays: number; wins: number; currentStreak: number; bestStreak: number; };
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
  const [showRecord, setShowRecord] = useState(false);
  const [record, setRecord] = useState<Record_>(() => loadRecord());
  const [isBestStreak, setIsBestStreak] = useState(false);
  const hasMovedRef = useRef(false);

  // 자동완성 상태
  const [autoRunning, setAutoRunning] = useState(false);
  const [showTotoro, setShowTotoro] = useState(false);
  const [totoroLine, setTotoroLine] = useState("");
  const [totoroVisible, setTotoroVisible] = useState(false);
  const autoTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const [pick, setPick] = useState<{ fromCol: number; fromIndex: number } | null>(null);
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null);
  const [ghostCards, setGhostCards] = useState<Card[]>([]);

  const pointerDownRef = useRef<{ x: number; y: number; colIdx: number; cardIdx: number; pointerId: number; } | null>(null);
  const isDraggingRef = useRef(false);
  const pickRef = useRef<{ fromCol: number; fromIndex: number } | null>(null);
  const colRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [colHeight, setColHeight] = useState(600);
  const [colWidth, setColWidth] = useState(60);
  const stateRef = useRef(state);
  stateRef.current = state;

  // 열 크기 측정
  useEffect(() => {
    const measure = () => {
      const el = colRefs.current.find(Boolean);
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setColHeight(rect.height);
      setColWidth(Math.max(rect.width - 16, 40));
    };
    measure();
    window.addEventListener("resize", measure);
    const ro = new ResizeObserver(measure);
    colRefs.current.forEach(el => { if (el) ro.observe(el); });
    return () => { window.removeEventListener("resize", measure); ro.disconnect(); };
  }, []);

  // 자동완성 실행
  const runAutoComplete = useCallback((s: GameState) => {
    if (autoRunning) return;
    const moves = buildAutoCompleteSequence(s);
    if (moves.length === 0) return;

    setAutoRunning(true);

    // 1. 토토로 등장
    const line = TOTORO_LINES[Math.floor(Math.random() * TOTORO_LINES.length)];
    setTotoroLine(line);
    setShowTotoro(true);
    setTimeout(() => setTotoroVisible(true), 50);

    // 2. 1.2초 후 카드 자동 이동 시작
    const CARD_DELAY = 320; // 카드 하나당 딜레이(ms)
    const startDelay = 1400;

    let currentState = s;
    moves.forEach((move, i) => {
      const t = setTimeout(() => {
        currentState = moveStack(currentState, { fromCol: move.fromCol, fromIndex: move.fromIndex }, move.toCol);
        setState(currentState);
        // 스택 완성 감지
        if (currentState.foundation.length > (i === 0 ? s.foundation.length : currentState.foundation.length - 1)) {
          playStackClear();
        } else {
          playCardMove();
        }
      }, startDelay + i * CARD_DELAY);
      autoTimersRef.current.push(t);
    });

    // 3. 완성 후 토토로 퇴장 + 승리 화면
    const totalTime = startDelay + moves.length * CARD_DELAY + 600;
    const endTimer = setTimeout(() => {
      setTotoroVisible(false);
      setTimeout(() => {
        setShowTotoro(false);
        setAutoRunning(false);
      }, 500);
    }, totalTime);
    autoTimersRef.current.push(endTimer);
  }, [autoRunning]);

  // 승리 감지 + 전적
  useEffect(() => {
    if (state.status === "won" && !showWin) {
      setShowWin(true);
      playWinSound();
      setRecord(prev => {
        const newStreak = prev.currentStreak + 1;
        const newBest = Math.max(newStreak, prev.bestStreak);
        setIsBestStreak(newStreak > prev.bestStreak);
        const next = { plays: prev.plays + 1, wins: prev.wins + 1, currentStreak: newStreak, bestStreak: newBest };
        saveRecord(next); return next;
      });
    }
  }, [state.status]);

  // 매 이동 후 자동완성 가능 여부 체크
  useEffect(() => {
    if (!autoRunning && state.status === "playing" && canAutoComplete(state)) {
      // 약간의 딜레이 후 자동완성 시작 (사용자가 마지막 이동 직후 보이도록)
      const t = setTimeout(() => runAutoComplete(state), 600);
      return () => clearTimeout(t);
    }
  }, [state, autoRunning]);

  function findClosestColumnIndex(x: number): number | null {
    let bestIdx: number | null = null; let bestDist = Infinity;
    for (let i = 0; i < colRefs.current.length; i++) {
      const el = colRefs.current[i]; if (!el) continue;
      const rect = el.getBoundingClientRect();
      const dist = Math.abs(x - (rect.left + rect.width / 2));
      if (dist < bestDist) { bestDist = dist; bestIdx = i; }
    }
    return bestIdx;
  }

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
        const p = { fromCol: pd.colIdx, fromIndex: pd.cardIdx };
        const targetIdx = findClosestColumnIndex(e.clientX);
        if (targetIdx !== null) {
          setState((s) => {
            const next = moveStack(s, p, targetIdx);
            if (next !== s) {
              hasMovedRef.current = true;
              if (next.foundation.length > s.foundation.length) playStackClear(); else playCardMove();
            }
            return next;
          });
        }
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
            setState((s2) => {
              const next = moveStack(s2, cur, pd.colIdx);
              if (next !== s2) {
                hasMovedRef.current = true;
                if (next.foundation.length > s2.foundation.length) playStackClear(); else playCardMove();
              }
              return next;
            });
            setPick(null); pickRef.current = null;
          }
        } else {
          if (canPickStack(s.columns, pd.colIdx, pd.cardIdx)) {
            setPick({ fromCol: pd.colIdx, fromIndex: pd.cardIdx });
            pickRef.current = { fromCol: pd.colIdx, fromIndex: pd.cardIdx };
          }
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
  }, []);

  const startNewGame = (diff: Difficulty) => {
    // 타이머 정리
    autoTimersRef.current.forEach(clearTimeout);
    autoTimersRef.current = [];
    if (hasMovedRef.current && state.status === "playing") {
      setRecord(prev => {
        const next = { ...prev, plays: prev.plays + 1, currentStreak: 0 };
        saveRecord(next); return next;
      });
    }
    hasMovedRef.current = false;
    setDifficulty(diff); setState(newGame(diff));
    setPick(null); pickRef.current = null;
    pointerDownRef.current = null; isDraggingRef.current = false;
    setGhostPos(null); setGhostCards([]);
    setShowWin(false); setIsBestStreak(false);
    setAutoRunning(false); setShowTotoro(false); setTotoroVisible(false);
    setShowDiffModal(false);
  };

  const onDeal = () => {
    if (autoRunning) return;
    hasMovedRef.current = true;
    setState((s) => dealFromStock(s));
    setPick(null); pickRef.current = null;
  };
  const onUndo = () => {
    if (autoRunning) return;
    setState((s) => undo(s)); setPick(null); pickRef.current = null;
  };
  const resetRecord = () => {
    const e: Record_ = { plays: 0, wins: 0, currentStreak: 0, bestStreak: 0 };
    saveRecord(e); setRecord(e);
  };

  const canDeal = state.stock.length >= 10 && state.status === "playing" && !autoRunning;
  const canUndoAction = state.history.length > 0 && state.undoUsed < 3 && state.status === "playing" && !autoRunning;
  const diffLabel: Record<Difficulty, string> = { 1: "1 Suit", 2: "2 Suits", 4: "4 Suits" };
  const diffDesc: Record<Difficulty, string> = { 1: "초급", 2: "중급", 4: "고급" };
  const stockPiles = Math.ceil(state.stock.length / 10);
  const winRate = record.plays > 0 ? Math.round((record.wins / record.plays) * 100) : 0;

  return (
    <div className="game">
      {/* 승리 오버레이 */}
      {showWin && (
        <div className="win-overlay" onClick={() => setShowWin(false)}>
          <div className="win-confetti">
            {Array.from({ length: 40 }).map((_, i) => (
              <div key={i} className="confetti-piece"
                style={{ left: `${Math.random() * 100}%`, animationDelay: `${Math.random() * 1.5}s`, backgroundColor: ["#FFD700","#FF6B6B","#4ECDC4","#45B7D1","#96CEB4","#FFEAA7"][i % 6] }} />
            ))}
          </div>
          <div className="win-modal">
            <div className="win-trophy">🏆</div>
            <h2 className="win-title">Victory!</h2>
            <p className="win-subtitle">모든 8개 조합을 완성했어요!</p>
            {isBestStreak && <div className="win-best-badge">🎯 베스트 갱신! {record.bestStreak}연속</div>}
            <button className="btn btn-primary win-btn" onClick={(e) => { e.stopPropagation(); setShowDiffModal(true); }}>다시 하기</button>
          </div>
        </div>
      )}

      {/* 토토로 자동완성 이펙트 */}
      {showTotoro && (
        <div className={`totoro-overlay ${totoroVisible ? "visible" : ""}`}>
          <div className="totoro-container">
            <img src="/배경.webp" alt="totoro" className="totoro-img" />
            <div className={`totoro-bubble ${totoroVisible ? "bubble-visible" : ""}`}>
              <span>{totoroLine}</span>
            </div>
          </div>
        </div>
      )}

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
            카드 뽑기{state.stock.length > 0 && <span className="btn-badge">{Math.floor(state.stock.length / 10)}</span>}
          </button>
          <button className="btn" onClick={onUndo} disabled={!canUndoAction}>
            되돌리기{canUndoAction && <span className="btn-badge">{3 - state.undoUsed}</span>}
          </button>
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
              {Array.from({ length: Math.min(stockPiles, 5) }).map((_, i) => (
                <div key={i} className="stock-card" style={{ transform: `translateY(${-i * 3}px) translateX(${i * 2}px)` }} />
              ))}
              <span className="stock-count">{Math.floor(state.stock.length / 10)}</span>
            </div>
          ) : <div className="stock-empty">비었음</div>}
        </div>

        <div className="board">
          {state.columns.map((col, colIdx) => (
            <div className="column" key={colIdx}
              ref={(el) => { colRefs.current[colIdx] = el; }}
              onPointerUp={() => {
                if (!isDraggingRef.current && col.length === 0 && pickRef.current) {
                  const cur = pickRef.current;
                  setState((s) => {
                    const next = moveStack(s, cur, colIdx);
                    if (next !== s) { hasMovedRef.current = true; playCardMove(); }
                    return next;
                  });
                  setPick(null); pickRef.current = null;
                }
              }}
            >
              {col.length === 0 && <div className="empty-col-hint">빈 열</div>}
              {col.map((card, cardIdx) => {
                const isSelected = pick?.fromCol === colIdx && pick?.fromIndex === cardIdx;
                const topPx = (() => {
                  if (col.length <= 1) return 8;
                  const cardH = colHeight * 0.55;
                  const available = colHeight - cardH - 16;
                  const maxStep = available / (col.length - 1);
                  return 8 + Math.max(14, Math.min(maxStep, 30)) * cardIdx;
                })();
                return (
                  <div
                    className={`card ${card.faceUp ? "up" : "down"} ${(card.suit === "H" || card.suit === "D") ? "redCard" : ""} ${isSelected ? "selected" : ""}`}
                    key={card.id}
                    style={{ top: topPx, zIndex: isSelected ? 500 : card.faceUp ? 100 + cardIdx : cardIdx }}
                    onPointerDown={(e) => {
                      if (autoRunning) return;
                      if (!card.faceUp) return;
                      if (!canPickStack(state.columns, colIdx, cardIdx)) return;
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

      {/* 드래그 고스트 */}
      {ghostPos && ghostCards.length > 0 && (
        <div className="ghost-stack" style={{ left: ghostPos.x, top: ghostPos.y, width: colWidth }}>
          {ghostCards.map((card, idx) => (
            <div key={card.id}
              className={`ghost-card card up ${card.suit === "H" || card.suit === "D" ? "redCard" : ""}`}
              style={{ top: idx * Math.min(28, colWidth * 0.32), width: colWidth }}>
              <CardView card={card} />
            </div>
          ))}
        </div>
      )}

      {/* 전적 모달 */}
      {showRecord && (
        <div className="modal-overlay" onClick={() => setShowRecord(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
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

      {/* 난이도 모달 */}
      {showDiffModal && (
        <div className="modal-overlay" onClick={() => setShowDiffModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>난이도 선택</h2>
            <p>새 게임을 시작할 난이도를 선택하세요</p>
            <div className="diff-options">
              {([1, 2, 4] as Difficulty[]).map((d) => (
                <button key={d} className={`diff-btn ${difficulty === d ? "active" : ""}`} onClick={() => startNewGame(d)}>
                  <span className="diff-suits">{d === 1 ? "♠" : d === 2 ? "♠♥" : "♠♥♦♣"}</span>
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
