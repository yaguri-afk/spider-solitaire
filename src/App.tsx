import { useEffect, useRef, useState } from "react";
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

function App() {
  const [state, setState] = useState<GameState>(() => newGame(2));

  // 선택된 카드(또는 스택)의 시작 위치
  const [pick, setPick] = useState<{ fromCol: number; fromIndex: number } | null>(null);

  // 드래그 상태
  const [dragging, setDragging] = useState(false);
  const dragPosRef = useRef<{ x: number; y: number } | null>(null);

  // 유령 카드 위치(화면에 그리기용)
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null);

  // 각 column DOM 저장 (가장 가까운 열 계산용)
  const colRefs = useRef<(HTMLDivElement | null)[]>([]);

  const onNewGame = () => {
    setState(newGame(2));
    setPick(null);
    setDragging(false);
    dragPosRef.current = null;
    setGhostPos(null);
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
  const canUndo =
    state.history.length > 0 && state.undoUsed < 3 && state.status === "playing";

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

// 전역 드래그 추적: 어디로 마우스를 옮겨도 추적 가능
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

    // pick을 읽고 이동 시도 후 선택 해제
    setPick((p) => {
      if (!p) return null;

      const targetIdx = findClosestColumnIndex(e.clientX);
      if (targetIdx !== null) {
        setState((s) => moveStack(s, p, targetIdx));
      }
      return null;
    });
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
}, [dragging]);

  return (
    <div className="game">
      <header className="topbar">
        <h1>🕷 Spider Solitaire</h1>

        <div className="meta">
          <span>Difficulty: 2 Suits (Default)</span>
          <span>Undo used: {state.undoUsed}/3</span>
          <span>Foundation: {state.foundation.length}</span>
          <span>Stock: {state.stock.length}</span>
          <span>Status: {state.status}</span>
        </div>

        <div className="buttons">
          <button className="btn" onClick={onNewGame}>
            New Game
          </button>
          <button className="btn" onClick={onDeal} disabled={!canDeal}>
            Deal
          </button>
          <button className="btn" onClick={onUndo} disabled={!canUndo}>
            Undo
          </button>
        </div>

        {state.status === "won" && (
          <div className="win">🎉 You won! (All 8 runs completed)</div>
        )}
      </header>

      {/* 유령 카드(드래그 프리뷰) */}
      {dragging && pick && ghostPos && (
        <div
          className="ghost"
          style={{
            left: ghostPos.x + 10,
            top: ghostPos.y + 10,
          }}
        >
          {(() => {
            const c = state.columns[pick.fromCol][pick.fromIndex];
            const isRed = c.suit === "H" || c.suit === "D";
            return (
              <div className={`ghostCard ${isRed ? "red" : "black"}`}>
                <div className="ghostCorner">
                  <span className="rank">{rankLabel(c.rank)}</span>
                  <span className="suit">{suitLabel(c.suit)}</span>
                </div>
                <div className="ghostCenter">{suitLabel(c.suit)}</div>
              </div>
            );
          })()}
        </div>
      )}

      <div className="board">
        {state.columns.map((col, i) => (
          <div
            className="column"
            key={i}
            ref={(el) => {
  colRefs.current[i] = el;
}}
            onClick={() => {
              // 클릭 이동(기존 기능 유지)
              if (!pick) return;
              setState((s) => moveStack(s, pick, i));
              setPick(null);
            }}
          >
            {col.map((card, j) => {
              const isSelected = pick?.fromCol === i && pick?.fromIndex === j;

              return (
                <div
className={`card ${card.faceUp ? "up" : "down"} ${
  card.suit === "H" || card.suit === "D" ? "redCard" : ""
} ${isSelected ? "selected" : ""} ${
  dragging && isSelected ? "dragging" : ""
}`}
                  key={card.id}
                  style={{ top: j * 26 }}
                  onPointerDown={(e) => {
  e.stopPropagation();
  e.preventDefault(); // ✅ iOS에서 중요
  if (!card.faceUp) return;

  // ✅ 포인터를 이 요소가 끝까지 잡고 있게
  (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);

  if (canPickStack(state.columns, i, j)) {
    setPick({ fromCol: i, fromIndex: j });
    setDragging(true);
    dragPosRef.current = { x: e.clientX, y: e.clientY };
    setGhostPos({ x: e.clientX, y: e.clientY });
                    }
                  }}
                  onClick={(e) => {
                    // 클릭 선택/해제(기존 기능 유지)
                    e.stopPropagation();
                    if (!card.faceUp) return;

                    if (isSelected) {
                      setPick(null);
                      return;
                    }

                    if (canPickStack(state.columns, i, j)) {
                      setPick({ fromCol: i, fromIndex: j });
                    }
                  }}
                  title={`${suitLabel(card.suit)} ${rankLabel(card.rank)}`}
                >
                  {card.faceUp ? (
                    <div
                      className={`face ${
                        card.suit === "H" || card.suit === "D" ? "red" : "black"
                      }`}
                    >
                      <div className="corner">
                        <span className="rank">{rankLabel(card.rank)}</span>
                        <span className="suit">{suitLabel(card.suit)}</span>
                      </div>

                      <div className="center">{suitLabel(card.suit)}</div>

                      <div className="corner bottom">
                        <span className="rank">{rankLabel(card.rank)}</span>
                        <span className="suit">{suitLabel(card.suit)}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="back" />
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;