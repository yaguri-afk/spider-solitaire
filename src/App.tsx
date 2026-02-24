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
import type { GameState } from "./game/types";
import type { Difficulty } from "./game/types";

function App() {
  const [difficulty, setDifficulty] = useState<Difficulty>(2);
  const [state, setState] = useState<GameState>(() => newGame(2));
  const [moves, setMoves] = useState(0);
  const [showDiffModal, setShowDiffModal] = useState(false);

  // 선택된 카드 스택
  const [pick, setPick] = useState<{ fromCol: number; fromIndex: number } | null>(null);

  // 드래그 상태
  const [dragging, setDragging] = useState(false);
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null);
  const dragPosRef = useRef<{ x: number; y: number } | null>(null);

  // 드래그 후 click 이벤트 무시용 (타임스탬프 방식 — 선언 누락 버그 수정)
  const ignoreClickUntilRef = useRef<number>(0);

  // 각 column DOM 참조
  const colRefs = useRef<(HTMLDivElement | null)[]>([]);

  // 카드 열 높이 계산: 열에 카드가 많을수록 간격을 좁힘
  const getCardOffset = useCallback((colLength: number, cardIndex: number, colHeight: number): number => {
    if (colLength <= 1) return 0;
    // 카드 하나 높이는 col 높이의 약 55% (aspect-ratio 5:7)
    const cardH = colHeight * 0.55;
    const available = colHeight - cardH - 16; // 패딩 제외
    const maxOffset = available / (colLength - 1);
    // 최소 14px(뒤집힌 카드 구분), 최대 32px(앞면 카드 읽기 가능)
    const minOffset = cardIndex < colLength - 1 && !true ? 14 : 14;
    const offset = Math.min(maxOffset, 32);
    return Math.max(minOffset, offset) * cardIndex;
  }, []);

  const colHeightRef = useRef<number>(600);
  useEffect(() => {
    const updateHeight = () => {
      const el = colRefs.current.find(Boolean);
      if (el) colHeightRef.current = el.getBoundingClientRect().height;
    };
    updateHeight();
    window.addEventListener("resize", updateHeight);
    return () => window.removeEventListener("resize", updateHeight);
  }, []);

  const startNewGame = (diff: Difficulty) => {
    setDifficulty(diff);
    setState(newGame(diff));
    setMoves(0);
    setPick(null);
    setDragging(false);
    dragPosRef.current = null;
    setGhostPos(null);
    setShowDiffModal(false);
    ignoreClickUntilRef.current = Date.now() + 400;
  };

  const onDeal = () => {
    setState((s) => dealFromStock(s));
    setPick(null);
    setDragging(false);
    dragPosRef.current = null;
    setGhostPos(null);
  };

  const onUndo = () => {
    setState((s) => undo(s));
    setPick(null);
    setDragging(false);
    dragPosRef.current = null;
    setGhostPos(null);
  };

  const canDeal = state.stock.length >= 10 && state.status === "playing";
  const canUndoAction = state.history.length > 0 && state.undoUsed < 3 && state.status === "playing";

  function findClosestColumnIndex(x: number): number | null {
    let bestIdx: number | null = null;
    let bestDist = Infinity;
    for (let i = 0; i < colRefs.current.length; i++) {
      const el = colRefs.current[i];
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const dist = Math.abs(x - centerX);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  // 전역 포인터 이벤트
  useEffect(() => {
    function onMove(e: PointerEvent) {
      if (!dragging) return;
      dragPosRef.current = { x: e.clientX, y: e.clientY };
      setGhostPos({ x: e.clientX, y: e.clientY });
    }

    function onUp(e: PointerEvent) {
      if (!dragging) return;

      setDragging(false);
      dragPosRef.current = null;
      setGhostPos(null);

      // 드래그 직후 발생하는 click 무시
      ignoreClickUntilRef.current = Date.now() + 300;

      if (!pick) {
        setPick(null);
        return;
      }

      const p = pick;
      const targetIdx = findClosestColumnIndex(e.clientX);

      if (targetIdx !== null) {
        setState((s) => {
          const next = moveStack(s, p, targetIdx);
          if (next !== s) setMoves((m) => m + 1);
          return next;
        });
      }

      setPick(null);
    }

    function onCancel() {
      if (!dragging) return;
      setDragging(false);
      dragPosRef.current = null;
      setGhostPos(null);
      setPick(null);
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
  }, [dragging, pick]);

  const diffLabel: Record<Difficulty, string> = { 1: "1 Suit", 2: "2 Suits", 4: "4 Suits" };
  const diffDesc: Record<Difficulty, string> = { 1: "초급", 2: "중급", 4: "고급" };

  // stock 덱 표시 (최대 5장 겹쳐 보이기)
  const stockPiles = Math.ceil(state.stock.length / 10);

  return (
    <div className="game">
      {/* ── 헤더 ── */}
      <header className="topbar">
        <div className="topbar-left">
          <h1>🕷 Spider</h1>
          <span className="diff-badge">{diffLabel[difficulty]} · {diffDesc[difficulty]}</span>
        </div>
        <div className="topbar-stats">
          <div className="stat">
            <span className="stat-label">이동</span>
            <span className="stat-value">{moves}</span>
          </div>
          <div className="stat">
            <span className="stat-label">완성</span>
            <span className="stat-value">{state.foundation.length}/8</span>
          </div>
          <div className="stat">
            <span className="stat-label">Undo</span>
            <span className="stat-value">{state.undoUsed}/3</span>
          </div>
        </div>
        <div className="buttons">
          <button className="btn btn-primary" onClick={() => setShowDiffModal(true)}>
            새 게임
          </button>
          <button className="btn" onClick={onDeal} disabled={!canDeal}>
            카드 뽑기
            {state.stock.length > 0 && (
              <span className="btn-badge">{Math.floor(state.stock.length / 10)}</span>
            )}
          </button>
          <button className="btn" onClick={onUndo} disabled={!canUndoAction}>
            되돌리기
            {canUndoAction && <span className="btn-badge">{3 - state.undoUsed}</span>}
          </button>
        </div>
      </header>

      {/* ── 승리 배너 ── */}
      {state.status === "won" && (
        <div className="win-banner">
          <span className="win-icon">🎉</span>
          <span>축하해요! 모든 조합을 완성했어요!</span>
          <button className="btn btn-primary" onClick={() => setShowDiffModal(true)}>
            다시 하기
          </button>
        </div>
      )}

      {/* ── 게임 보드 ── */}
      <div className="board-wrapper">
        {/* Foundation 영역 (완성된 덱) */}
        <div className="foundation-area">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className={`foundation-slot ${i < state.foundation.length ? "filled" : ""}`}>
              {i < state.foundation.length ? "♠" : ""}
            </div>
          ))}
        </div>

        {/* Stock 덱 */}
        <div className="stock-area" onClick={canDeal ? onDeal : undefined} title="클릭해서 카드 뽑기">
          {state.stock.length > 0 ? (
            <div className="stock-stack">
              {Array.from({ length: Math.min(stockPiles, 5) }).map((_, i) => (
                <div
                  key={i}
                  className="stock-card"
                  style={{ transform: `translateY(${-i * 3}px) translateX(${i * 2}px)` }}
                />
              ))}
              <span className="stock-count">{Math.floor(state.stock.length / 10)}</span>
            </div>
          ) : (
            <div className="stock-empty">비었음</div>
          )}
        </div>

        {/* 메인 보드 */}
        <div className="board">
          {state.columns.map((col, i) => {
            const isDropTarget = dragging && pick && pick.fromCol !== i;
            return (
              <div
                className={`column ${isDropTarget ? "droppable" : ""}`}
                key={i}
                ref={(el) => { colRefs.current[i] = el; }}
                onClick={() => {
                  if (Date.now() < ignoreClickUntilRef.current) return;
                  if (!pick) return;
                  setState((s) => {
                    const next = moveStack(s, pick, i);
                    if (next !== s) setMoves((m) => m + 1);
                    return next;
                  });
                  setPick(null);
                }}
              >
                {col.length === 0 && <div className="empty-col-hint">빈 열</div>}
                {col.map((card, j) => {
                  const isSelected = pick?.fromCol === i && pick?.fromIndex === j;
                  const colH = colHeightRef.current;
                  const topPx = (() => {
                    if (col.length <= 1) return 8;
                    const cardH = colH * 0.55;
                    const available = colH - cardH - 16;
                    const maxStep = available / (col.length - 1);
                    const step = Math.min(maxStep, 30);
                    const minStep = 14;
                    return 8 + Math.max(minStep, step) * j;
                  })();

                  return (
                    <div
                      className={`card ${card.faceUp ? "up" : "down"} ${
                        (card.suit === "H" || card.suit === "D") ? "redCard" : ""
                      } ${isSelected ? "selected" : ""} ${
                        dragging && pick?.fromCol === i && j >= pick.fromIndex ? "dragging" : ""
                      }`}
                      key={card.id}
                      style={{ top: topPx }}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        if (!card.faceUp) return;
                        (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
                        if (canPickStack(state.columns, i, j)) {
                          setPick({ fromCol: i, fromIndex: j });
                          setDragging(true);
                          dragPosRef.current = { x: e.clientX, y: e.clientY };
                          setGhostPos({ x: e.clientX, y: e.clientY });
                        }
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (Date.now() < ignoreClickUntilRef.current) return;
                        if (!card.faceUp) return;
                        if (isSelected) {
                          setPick(null);
                          return;
                        }
                        if (pick) {
                          // 다른 카드 위로 클릭 → 이동 시도
                          setState((s) => {
                            const next = moveStack(s, pick, i);
                            if (next !== s) setMoves((m) => m + 1);
                            return next;
                          });
                          setPick(null);
                        } else {
                          if (canPickStack(state.columns, i, j)) {
                            setPick({ fromCol: i, fromIndex: j });
                          }
                        }
                      }}
                      title={card.faceUp ? `${rankLabel(card.rank)}${suitLabel(card.suit)}` : ""}
                    >
                      <CardView card={card} selected={isSelected} />
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── 드래그 고스트 ── */}
      {dragging && pick && ghostPos && (
        <div
          className="ghost"
          style={{
            left: ghostPos.x,
            top: ghostPos.y,
            transform: "translate(-50%, -60%)",
          }}
        >
          {state.columns[pick.fromCol].slice(pick.fromIndex).map((card, idx) => (
            <div key={card.id} style={{ position: idx === 0 ? "relative" : "absolute", top: idx * 22 }}>
              <CardView card={card} mini />
            </div>
          ))}
        </div>
      )}

      {/* ── 난이도 선택 모달 ── */}
      {showDiffModal && (
        <div className="modal-overlay" onClick={() => setShowDiffModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>난이도 선택</h2>
            <p>새 게임을 시작할 난이도를 선택하세요</p>
            <div className="diff-options">
              {([1, 2, 4] as Difficulty[]).map((d) => (
                <button
                  key={d}
                  className={`diff-btn ${difficulty === d ? "active" : ""}`}
                  onClick={() => startNewGame(d)}
                >
                  <span className="diff-suits">
                    {d === 1 ? "♠" : d === 2 ? "♠♥" : "♠♥♦♣"}
                  </span>
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
