import { useEffect, useRef, useState } from "react";
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
import type { GameState } from "./game/types";
import type { Difficulty } from "./game/types";

const DRAG_THRESHOLD = 6;

// ── AudioContext 싱글턴 — 한 번만 만들고 재사용 ──
// 매번 new AudioContext()를 하면 브라우저가 suspended 상태로 차단함
let _audioCtx: AudioContext | null = null;

async function getAudioCtx(): Promise<AudioContext | null> {
  try {
    if (!_audioCtx) {
      _audioCtx = new AudioContext();
    }
    // suspended 상태면 resume (브라우저 autoplay 정책 해제)
    if (_audioCtx.state === "suspended") {
      await _audioCtx.resume();
    }
    return _audioCtx;
  } catch (_) {
    return null;
  }
}

// 카드 이동: 착! 하는 짧은 타격음
async function playCardMove() {
  const ctx = await getAudioCtx();
  if (!ctx) return;
  try {
    const bufferSize = Math.floor(ctx.sampleRate * 0.07);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 2.5);
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 800;
    filter.Q.value = 1.2;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.6, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.07);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    source.start();
  } catch (_) {}
}

// 완성 스택 제거: 쉬리릭~ 상승 효과음
async function playStackClear() {
  const ctx = await getAudioCtx();
  if (!ctx) return;
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = "sine";
    osc.frequency.setValueAtTime(280, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1500, ctx.currentTime + 0.4);

    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.32, ctx.currentTime + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.42);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.45);
  } catch (_) {}
}

// 승리: C-E-G-C 팡파레
async function playWinSound() {
  const ctx = await getAudioCtx();
  if (!ctx) return;
  try {
    const notes = [523, 659, 784, 1047];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = "sine";
      const t = ctx.currentTime + i * 0.18;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.35, t + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      osc.start(t);
      osc.stop(t + 0.5);
    });
  } catch (_) {}
}

function App() {
  const [difficulty, setDifficulty] = useState<Difficulty>(2);
  const [state, setState] = useState<GameState>(() => newGame(2));
  const [showDiffModal, setShowDiffModal] = useState(false);
  const [showWin, setShowWin] = useState(false);

  // 클릭 선택
  const [pick, setPick] = useState<{ fromCol: number; fromIndex: number } | null>(null);

  // 고스트: 위치 + 드래그 중인 카드 스냅샷 (렌더링용 state)
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null);
  const [ghostCards, setGhostCards] = useState<Array<{ id: string; suit: string; rank: number; faceUp: boolean }>>([]);

  // 포인터 추적 — 전부 ref (동기)
  const pointerDownRef = useRef<{
    x: number; y: number;
    colIdx: number; cardIdx: number;
    pointerId: number;
  } | null>(null);
  const isDraggingRef = useRef(false);
  const pickRef = useRef<{ fromCol: number; fromIndex: number } | null>(null);

  const colRefs = useRef<(HTMLDivElement | null)[]>([]);
  const colHeightRef = useRef<number>(600);
  const stateRef = useRef(state);
  stateRef.current = state;

  // 승리 감지
  useEffect(() => {
    if (state.status === "won" && !showWin) {
      setShowWin(true);
      playWinSound();
    }
  }, [state.status]);

  useEffect(() => {
    const updateHeight = () => {
      const el = colRefs.current.find(Boolean);
      if (el) colHeightRef.current = el.getBoundingClientRect().height;
    };
    updateHeight();
    window.addEventListener("resize", updateHeight);
    return () => window.removeEventListener("resize", updateHeight);
  }, []);

  function findClosestColumnIndex(x: number): number | null {
    let bestIdx: number | null = null;
    let bestDist = Infinity;
    for (let i = 0; i < colRefs.current.length; i++) {
      const el = colRefs.current[i];
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const dist = Math.abs(x - centerX);
      if (dist < bestDist) { bestDist = dist; bestIdx = i; }
    }
    return bestIdx;
  }

  // 전역 pointer 이벤트 — 한 번만 등록
  useEffect(() => {
    function onMove(e: PointerEvent) {
      const pd = pointerDownRef.current;
      if (!pd || e.pointerId !== pd.pointerId) return;

      const dx = e.clientX - pd.x;
      const dy = e.clientY - pd.y;

      if (!isDraggingRef.current && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
        // 드래그 시작 — 카드 스냅샷 저장
        isDraggingRef.current = true;
        const s = stateRef.current;
        const cards = s.columns[pd.colIdx]?.slice(pd.cardIdx) ?? [];
        setGhostCards(cards.map(c => ({ ...c })));
      }

      if (isDraggingRef.current) {
        setGhostPos({ x: e.clientX, y: e.clientY });
      }
    }

    function onUp(e: PointerEvent) {
      const pd = pointerDownRef.current;
      if (!pd || e.pointerId !== pd.pointerId) return;

      const wasDragging = isDraggingRef.current;
      pointerDownRef.current = null;
      isDraggingRef.current = false;
      setGhostPos(null);
      setGhostCards([]);

      if (wasDragging) {
        // 드래그 이동
        const p = { fromCol: pd.colIdx, fromIndex: pd.cardIdx };
        const targetIdx = findClosestColumnIndex(e.clientX);
        if (targetIdx !== null) {
          setState((s) => {
            const next = moveStack(s, p, targetIdx);
            if (next !== s) {
              // 완성된 스택이 생겼으면 쉬리릭, 아니면 착
              if (next.foundation.length > s.foundation.length) {
                playStackClear();
              } else {
                playCardMove();
              }
            }
            return next;
          });
        }
        setPick(null);
        pickRef.current = null;
      } else {
        // 클릭
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
                if (next.foundation.length > s2.foundation.length) {
                  playStackClear();
                } else {
                  playCardMove();
                }
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
      pointerDownRef.current = null;
      isDraggingRef.current = false;
      setGhostPos(null);
      setGhostCards([]);
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
    setDifficulty(diff);
    setState(newGame(diff));
    setPick(null); pickRef.current = null;
    pointerDownRef.current = null; isDraggingRef.current = false;
    setGhostPos(null); setGhostCards([]);
    setShowWin(false);
    setShowDiffModal(false);
  };

  const onDeal = () => { setState((s) => dealFromStock(s)); setPick(null); pickRef.current = null; };
  const onUndo = () => { setState((s) => undo(s)); setPick(null); pickRef.current = null; };

  const canDeal = state.stock.length >= 10 && state.status === "playing";
  const canUndoAction = state.history.length > 0 && state.undoUsed < 3 && state.status === "playing";
  const diffLabel: Record<Difficulty, string> = { 1: "1 Suit", 2: "2 Suits", 4: "4 Suits" };
  const diffDesc: Record<Difficulty, string> = { 1: "초급", 2: "중급", 4: "고급" };
  const stockPiles = Math.ceil(state.stock.length / 10);

  // 고스트 카드 너비: 열 너비 기준
  const ghostCardW = (() => {
    const el = colRefs.current.find(Boolean);
    return el ? el.getBoundingClientRect().width - 16 : 60;
  })();

  return (
    <div className="game">
      {/* 승리 오버레이 */}
      {showWin && (
        <div className="win-overlay" onClick={() => setShowWin(false)}>
          <div className="win-confetti">
            {Array.from({ length: 40 }).map((_, i) => (
              <div key={i} className="confetti-piece"
                style={{
                  left: `${Math.random() * 100}%`,
                  animationDelay: `${Math.random() * 1.5}s`,
                  backgroundColor: ["#FFD700","#FF6B6B","#4ECDC4","#45B7D1","#96CEB4","#FFEAA7"][i % 6],
                }} />
            ))}
          </div>
          <div className="win-modal">
            <div className="win-trophy">🏆</div>
            <h2 className="win-title">Victory!</h2>
            <p className="win-subtitle">모든 8개 조합을 완성했어요!</p>
            <button className="btn btn-primary win-btn" onClick={() => setShowDiffModal(true)}>
              다시 하기
            </button>
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
        </div>
        <div className="buttons">
          <button className="btn btn-primary" onClick={() => setShowDiffModal(true)}>새 게임</button>
          <button className="btn" onClick={onDeal} disabled={!canDeal}>
            카드 뽑기
            {state.stock.length > 0 && <span className="btn-badge">{Math.floor(state.stock.length / 10)}</span>}
          </button>
          <button className="btn" onClick={onUndo} disabled={!canUndoAction}>
            되돌리기
            {canUndoAction && <span className="btn-badge">{3 - state.undoUsed}</span>}
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
                <div key={i} className="stock-card"
                  style={{ transform: `translateY(${-i * 3}px) translateX(${i * 2}px)` }} />
              ))}
              <span className="stock-count">{Math.floor(state.stock.length / 10)}</span>
            </div>
          ) : <div className="stock-empty">비었음</div>}
        </div>

        <div className="board">
          {state.columns.map((col, colIdx) => (
            <div
              className="column"
              key={colIdx}
              ref={(el) => { colRefs.current[colIdx] = el; }}
              onPointerUp={() => {
                if (!isDraggingRef.current && col.length === 0 && pickRef.current) {
                  const cur = pickRef.current;
                  setState((s) => moveStack(s, cur, colIdx));
                  setPick(null); pickRef.current = null;
                }
              }}
            >
              {col.length === 0 && <div className="empty-col-hint">빈 열</div>}
              {col.map((card, cardIdx) => {
                const isSelected = pick?.fromCol === colIdx && pick?.fromIndex === cardIdx;
                const isDraggingThis = isDraggingRef.current &&
                  pointerDownRef.current?.colIdx === colIdx &&
                  cardIdx >= (pointerDownRef.current?.cardIdx ?? 999);
                const colH = colHeightRef.current;
                const topPx = (() => {
                  if (col.length <= 1) return 8;
                  const cardH = colH * 0.55;
                  const available = colH - cardH - 16;
                  const maxStep = available / (col.length - 1);
                  return 8 + Math.max(14, Math.min(maxStep, 30)) * cardIdx;
                })();

                return (
                  <div
                    className={`card ${card.faceUp ? "up" : "down"} ${
                      (card.suit === "H" || card.suit === "D") ? "redCard" : ""
                    } ${isSelected ? "selected" : ""} ${isDraggingThis ? "dragging-src" : ""}`}
                    key={card.id}
                    style={{
                      top: topPx,
                      zIndex: isSelected ? 500 : card.faceUp ? 100 + cardIdx : cardIdx,
                    }}
                    onPointerDown={(e) => {
                      if (!card.faceUp) return;
                      if (!canPickStack(state.columns, colIdx, cardIdx)) return;
                      e.preventDefault();
                      e.stopPropagation();
                      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
                      pointerDownRef.current = { x: e.clientX, y: e.clientY, colIdx, cardIdx, pointerId: e.pointerId };
                      isDraggingRef.current = false;
                      // 첫 터치에서 AudioContext를 미리 resume — 이후 사운드가 즉시 재생되게
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

      {/* 드래그 고스트 — 실제 카드 크기로 스택 표시 */}
      {ghostPos && ghostCards.length > 0 && (
        <div
          className="ghost-stack"
          style={{
            left: ghostPos.x,
            top: ghostPos.y,
            width: ghostCardW,
          }}
        >
          {ghostCards.map((card, idx) => (
            <div
              key={card.id}
              className={`ghost-card card up ${card.suit === "H" || card.suit === "D" ? "redCard" : ""}`}
              style={{
                top: idx * Math.min(28, ghostCardW * 0.32),
                width: ghostCardW,
              }}
            >
              <CardView card={card} />
            </div>
          ))}
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
                <button key={d} className={`diff-btn ${difficulty === d ? "active" : ""}`}
                  onClick={() => startNewGame(d)}>
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
