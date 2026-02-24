import type { Card } from "../game/types";
import { rankLabel, suitLabel } from "../game/game";
import "./card.css";

function isRedSuit(suit: Card["suit"]) {
  return suit === "H" || suit === "D";
}

// 숫자 카드 핍 레이아웃 (실제 카드처럼)
const PIP_LAYOUTS: Record<number, number[][]> = {
  2:  [[0.5, 0.27], [0.5, 0.73]],
  3:  [[0.5, 0.22], [0.5, 0.5], [0.5, 0.78]],
  4:  [[0.28, 0.25], [0.72, 0.25], [0.28, 0.75], [0.72, 0.75]],
  5:  [[0.28, 0.22], [0.72, 0.22], [0.5, 0.5], [0.28, 0.78], [0.72, 0.78]],
  6:  [[0.28, 0.22], [0.72, 0.22], [0.28, 0.5], [0.72, 0.5], [0.28, 0.78], [0.72, 0.78]],
  7:  [[0.28, 0.20], [0.72, 0.20], [0.5, 0.35], [0.28, 0.50], [0.72, 0.50], [0.28, 0.78], [0.72, 0.78]],
  8:  [[0.28, 0.20], [0.72, 0.20], [0.5, 0.34], [0.28, 0.48], [0.72, 0.48], [0.5, 0.62], [0.28, 0.78], [0.72, 0.78]],
  9:  [[0.28, 0.18], [0.72, 0.18], [0.28, 0.36], [0.72, 0.36], [0.5, 0.5], [0.28, 0.64], [0.72, 0.64], [0.28, 0.82], [0.72, 0.82]],
  10: [[0.28, 0.18], [0.72, 0.18], [0.5, 0.30], [0.28, 0.38], [0.72, 0.38], [0.28, 0.62], [0.72, 0.62], [0.5, 0.70], [0.28, 0.82], [0.72, 0.82]],
};

function PipLayout({ rank, suit }: { rank: number; suit: string }) {
  const positions = PIP_LAYOUTS[rank];
  if (!positions) return <div className="pip-text">{rank}{suit}</div>;
  return (
    <div className="pip-field">
      {positions.map(([x, y], i) => (
        <span
          key={i}
          className="pip"
          style={{
            left: `${x * 100}%`,
            top: `${y * 100}%`,
          }}
        >
          {suit}
        </span>
      ))}
    </div>
  );
}

export default function CardView({
  card,
  selected,
  mini,
}: {
  card: Card;
  selected?: boolean;
  mini?: boolean;
}) {
  // 뒷면
  if (!card.faceUp) {
    return (
      <div className={["cv-card", "cv-back", selected ? "cv-selected" : "", mini ? "cv-mini" : ""].filter(Boolean).join(" ")}>
        <div className="cv-back-pattern" />
        <div className="cv-back-inner" />
      </div>
    );
  }

  const rank = rankLabel(card.rank);
  const suit = suitLabel(card.suit);
  const red = isRedSuit(card.suit);
  const isFace = rank === "J" || rank === "Q" || rank === "K";
  const isAce = rank === "A";

  return (
    <div
      className={[
        "cv-card",
        "cv-front",
        red ? "cv-red" : "cv-black",
        selected ? "cv-selected" : "",
        mini ? "cv-mini" : "",
      ].filter(Boolean).join(" ")}
    >
      {/* 좌상단 코너 */}
      <div className="cv-corner cv-tl">
        <span className="cv-rank">{rank}</span>
        <span className="cv-suit">{suit}</span>
      </div>

      {/* 우하단 코너 (180도 회전) */}
      <div className="cv-corner cv-br">
        <span className="cv-rank">{rank}</span>
        <span className="cv-suit">{suit}</span>
      </div>

      {/* 중앙 영역 */}
      <div className="cv-center">
        {isAce ? (
          <span className="cv-ace-suit">{suit}</span>
        ) : isFace ? (
          <div className="cv-face">
            <div className="cv-face-top">{rank === "K" ? "👑" : rank === "Q" ? "🌸" : "🎩"}</div>
            <div className="cv-face-letter">{rank}</div>
            <div className="cv-face-suit">{suit}</div>
          </div>
        ) : (
          <PipLayout rank={card.rank} suit={suit} />
        )}
      </div>
    </div>
  );
}
