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
  // ?„ë£¨ë²?? ë¼? ë¼ ?œë¦¬ì¦?  "?„ë£¨ë²?? ë¼? ë¼??ë³„ìˆ˜ ?†ìœ¼???´ê? ë§ˆë¬´ë¦¬í•´ì¤€??",
  "?„ë£¨ë²?? ë¼? ë¼???¤ê? ëª??˜ë‹ˆê¹??´ì©” ???†ì–??",
  "?„ë£¨ë²?? ë¼? ë¼??ê°ì‚¬?˜ë‹¨ ë§ì? ?„ìš”?†ì–´.",
  "?„ë£¨ë²?? ë¼? ë¼???œê°„ ??¹„?˜ì? ë§ê³  ?ë‚´??",
  "?„ë£¨ë²?? ë¼? ë¼?????´ë²ˆ ??ë²ˆë§Œ?´ì•¼.",
  "?„ë£¨ë²?? ë¼? ë¼?????•ë„ë©??˜í•œ??ë¹šì§„ ê±°ì•¼.",
  "?„ë£¨ë²?? ë¼? ë¼??? ë“¤ì§€ ë§? ì§‘ì¤‘?´ì•¼ ?˜ë‹ˆê¹?",
  // ?‰ì†Œ/ë¬´ì‹¬ ?œë¦¬ì¦?  "...?„êµ¬????ì¤??Œì•„???˜ëŠ” ë²•ì´?? ?¨ì¤„ê²?",
  "?´ê? ?˜ì„œ??ê±??±íˆ ?ˆë? ?„í•´?œê? ?„ë‹ˆ??",
  "?¨ìœ¨???¨ì–´?? ?´ê? ?ë‚¸??",
  "?œê°„???„ê¹Œ?? ?´ê? ?œë‹¤.",
  "ë§??œí‚¤ì§€ ë§? ê·¸ëƒ¥ ë³´ê³  ?ˆì–´.",
  "...?´ê±¸ ëª??ë‚¸?¤ê³ ? ?´ì©” ???†ë„¤.",
  "??¢…?ë²•ê¹Œì? ???„ìš”???†ê² êµ?",
  "???•ë„ ?¨í„´, ?½ëŠ” ??3ì´ˆë©´ ì¶©ë¶„??",
  "ë³µì¡?˜ê²Œ ?ê°?˜ì? ë§? ?œì„œ?€ë¡??˜ë©´ ??",
];
const NOT_READY_LINES = [
  "?„ì§ ë©€?ˆì–´. ?¤ìŠ¤ë¡??´ë´.",
  "ì§€ê¸ˆì? ???? ???´ë´.",
  "?„ì§?´ì•¼. ?¬ê¸°?˜ì? ë§?",
  "???•ë„ë¡??„ì???ì²?•˜??ê±°ì•¼?",
  "ì¢€ ???ê°?´ë´. ?„ì§ ?˜ê? ?ˆì„ ê±°ì•¼.",
  "...???‘ë°”ë¡??? ê¸¸ì´ ë³´ì¼ ê±°ì•¼.",
  "?¬ê¸°ê°€ ë¹ ë¥´?? ì¡°ê¸ˆë§???",
  "?´ê? ?˜ì„¤ ?Œê? ?„ë‹ˆ?? ?¤ê? ?????ˆì–´.",
  "?„ì§ ???ì–´. ì¹´ë“œë¥??¤ì‹œ ë´?",
  "ê·??˜ëŠ” ?„ì§ ?¨ì•„?ˆì–´. ??ë´?",
];
const LOSE_LINES = [
  "ì¡Œêµ°. ë­?ê·¸ëŸ´ ì¤??Œì•˜??",
  "?´ê²Œ ?œê³„?? ?±íˆ ?€?ì????Šì•„.",
  "???´ìƒ ?˜ê? ?†ì–´. ?¬ê¸°??",
  "ë§‰í˜”êµ? ë­? ?˜ë¼???´ì©” ???†ì—ˆ??ê±°ì•¼.",
  "?ë‚¬?? ?¤ìŒ??ì¢€ ?˜í•´ë´?",
  "...ì£½ì? ?¨ì•¼. ?¸ì •??",
  "?˜ì½ê¸°ê? ë¶€ì¡±í–ˆ?? ê·¸ê²Œ ?„ë???",
  "?ë²•???µí•˜ì§€ ?Šì„ ?Œë„ ?ˆì–´. ?´ë²ˆ??ê·¸ë˜.",
  "?„ëµ???„í‡´???¤ë ¥?´ì•¼. ?ˆë¡œ ?œì‘??",
  "...??ë§??†ì–´. ê²°ê³¼ê°€ ?¤ì•¼.",
  "?´ë²ˆ ê²Œì„?€ ì²˜ìŒë¶€??ê¼¬ì??? ?¤ì‹œ ??",
  "?¨ë°°ë¥??¸ì •?˜ëŠ” ê²ƒë„ ?©ê¸°?? ë­?",
  "?˜ì˜ì§€ ?Šì? ?¸ì??´ì—ˆ?? ê²°ê³¼ê°€ ë¬¸ì œì§€.",
  "...?ì–´???ê¹Œì§€ ?€?–ì•„. ê·¸ê±¸ë¡??ì–´.",
];

const WARNING_LINES = [
  "? ê¹???´ê±° ì¢€ ?„í—˜??ê±??„ë‹ˆ?? ë­? ??? íƒ?´ì?ë§?",
  "???íƒœ???”ì§??ì¢‹ì? ?Šì•„. ê·¸ë˜??ê³„ì†??ê±°ì•¼?",
  "?Œâ€??˜ê? ë³„ë¡œ ?†ëŠ”?? ë­? ?¬ê¸°?˜ë©´ ?¸í•˜ì§€.",
  "?´ë?ë¡?ê°€ë©?ë§‰í ê²?ê°™ì??? ?´ê? ?€ë¦??˜ë„ ?ˆì?ë§?",
  "...?¬ìŠ¬ ê²½ê³„?´ì•¼ ??ê²?ê°™ì???",
  "?¨í„´??ì¢‹ì? ?Šì•„. ì£¼ì˜??",
  "??ë°©í–¥?¼ë¡œ ê³„ì† ê°€ë©´â€??? ??? íƒ?´ì•¼.",
  "?˜ê? ì¢ì•„ì§€ê³??ˆì–´. ?ë¼ê³??ˆì??",
];
const DANGER_LINES = [
  "?´ê±° ê±°ì˜ ?ë‚œ ê±??„ë‹ˆ?? ë­â€?ê¸°ì ???¼ì–´???˜ë„ ?ˆì?.",
  "?”ì§??ë§í• ê²? ?´ê±´ ë§ì´ ?„í—˜?? ê°ì˜¤??",
  "???íƒœ?ì„œ ?¤ì§‘??ê±´â€??˜ë„ ?ì‹  ?†ì–´.",
  "?¬ê¸°?˜ëŠ” ê²??˜ì„ ê²?ê°™ì??? ê·¸ë˜??ê³„ì†??ê±°ë¼ë©?ë§ë¦¬ì§??Šì•„.",
  "...ê±°ì˜ ë§‰ë‹¤ë¥?ê³³ì´?? ê¸°ì ??ë¯¿ì–´ë´?",
  "?ì—­?„ê°œ?????¨ëŠ” ëª??¤ì§‘?? ê°ì˜¤??",
  "ìµœì•…??ê²½ìš°ë¥??ê°?´ë‘¬. ì§€ê¸?ê·??í™©?´ì•¼.",
  "?ˆì¶œêµ¬ê? ë³´ì´ì§€ ?Šì•„. ê·¸ë˜???´ë³¼ ê±°ì•¼?",
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
  const showDangerModalRef = useRef(false);  // ?´ë¡œ?€ ë¬¸ì œ ë°©ì???ref
  const [showRecord, setShowRecord] = useState(false);
  const [record, setRecord] = useState<Record_>(() => loadRecord());
  const [isBestStreak, setIsBestStreak] = useState(false);
  const hasMovedRef = useRef(false);

  const autoRunningRef = useRef(false);
  const [autoRunning, setAutoRunning] = useState(false);
  const [animCardIds, setAnimCardIds] = useState<Set<string>>(new Set());

  // ìºë¦­???´í™??  const [charVisible, setCharVisible] = useState(false);
  const [charLine, setCharLine] = useState("");
  const [charImg, setCharImg] = useState("");
  const [charBubbleVisible, setCharBubbleVisible] = useState(false);

  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const loseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recentSigsRef = useRef<string[]>([]);
  const noProgressRef = useRef<number>(0);  // ì§„ì „ ?†ëŠ” ?´ë™ ?Ÿìˆ˜

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

  // ???¬ê¸°: resize ?Œë§Œ ?…ë°?´íŠ¸ (ì´ˆê¸°ê°’ì? useState?ì„œ ê³„ì‚°)
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

  // ìºë¦­???±ì¥
  const showChar = useCallback((img: string, line: string) => {
    setCharImg(img); setCharLine(line); setCharVisible(true);
    const t = setTimeout(() => setCharBubbleVisible(true), 300);
    timersRef.current.push(t);
  }, []);

  // ìºë¦­???´ì¥
  const hideChar = useCallback((delay: number) => {
    const t1 = setTimeout(() => {
      setCharBubbleVisible(false);
      const t2 = setTimeout(() => setCharVisible(false), 500);
      timersRef.current.push(t2);
    }, delay);
    timersRef.current.push(t1);
  }, []);

  // ?€?€ ?ë™?„ì„± ?¤í–‰ ?€?€
  const runAutoComplete = useCallback((s: GameState) => {
    if (autoRunningRef.current) return;
    const moves = buildAutoCompleteSequence(s);
    if (moves.length === 0) return;

    // ìµœì¢… ?íƒœ ë¯¸ë¦¬ ê³„ì‚° (ê²Œì„ ë¡œì§?€ ?¬ê¸°?œë§Œ)
    let finalState = s;
    for (const move of moves) {
      const next = moveStack(finalState, { fromCol: move.fromCol, fromIndex: move.fromIndex }, move.toCol);
      if (next === finalState) break;
      finalState = next;
    }

    autoRunningRef.current = true;
    setAutoRunning(true);

    showChar("/megumi.jpeg", AUTO_LINES[Math.floor(Math.random() * AUTO_LINES.length)]);

    // ? ë‹ˆë©”ì´?? ê°??´ì˜ ì¹´ë“œ?¤ì„ ?œì„œ?€ë¡??Œë˜?œë§Œ ?œì‹œ
    const INTERVAL = 60;
    const START = 1400;

    // ëª¨ë“  ?ë©´ ì¹´ë“œë¥??œì„œ?€ë¡??Œë˜??    const allCards: { id: string; fromCol: number; cardIdx: number }[] = [];
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

    // ? ë‹ˆë©”ì´???„ë£Œ ??ìµœì¢… ?íƒœ ??ë²ˆì— ?ìš©
    const t2 = setTimeout(() => {
      // finalState.statusê°€ won???„ë‹Œ ê²½ìš° ?€ë¹?
      // foundation 8ê°??„ì„±?´ë©´ ê°•ì œë¡?won ì²˜ë¦¬
      const appliedState = finalState.foundation.length >= 8
        ? { ...finalState, status: 'won' as const }
        : finalState;
      setState(appliedState);
      playStackClear();
      setTimeout(() => playStackClear(), 180);
      setTimeout(() => playStackClear(), 360);
    }, totalMs);
    timersRef.current.push(t2);

    // ? ê¸ˆ ?´ì œ
    const t3 = setTimeout(() => {
      autoRunningRef.current = false;
      setAutoRunning(false);
      setAnimCardIds(new Set());
    }, totalMs + 600);
    timersRef.current.push(t3);

    // ìºë¦­???´ì¥
    hideChar(totalMs + 200);
  }, [showChar, hideChar]);

  // ?€?€ ?ë™?„ì„± ë²„íŠ¼ ?´ë¦­ ?€?€
  const onAutoComplete = useCallback(() => {
    const s = stateRef.current;
    if (isAutoCompleteReady(s)) {
      runAutoComplete(s);
    } else {
      // ?¹ë¦¬ ?•ì • ?„ë‹ ?? "?„ì§ ë©€?ˆì–´" ë©˜íŠ¸ë§? ë¹ ë¥´ê²??´ì¥
      showChar("/megumi.jpeg", NOT_READY_LINES[Math.floor(Math.random() * NOT_READY_LINES.length)]);
      hideChar(1500);
    }
  }, [runAutoComplete, showChar, hideChar]);

  // ?€?€ ?¨ë°° ? ì–¸ ?€?€
  const declareLose = useCallback(() => {
    if (autoRunningRef.current) return;
    if (stateRef.current.status !== "playing") return;
    if (stateRef.current.stock.length > 0) return;  // ?¤í†¡ ?¨ì•„?ˆìœ¼ë©??¨ë°° ?„ë‹˜
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

  // ?€?€ ?´ë™ ???¨ë°°/?„í—˜ ì²´í¬ ?€?€
  const checkAfterMove = useCallback((nextState: GameState) => {
    if (autoRunningRef.current) return;
    if (nextState.status !== "playing") return;

    if (loseTimerRef.current) { clearTimeout(loseTimerRef.current); loseTimerRef.current = null; }

    const danger = analyzeDanger(nextState, noProgressRef.current);

    // ?¨ë°° ?•ì •
    if (danger.level === 'deadlock' && hasMovedRef.current) {
      loseTimerRef.current = setTimeout(() => declareLose(), 2500);
      return;
    }

    // ë¬´í•œë£¨í”„ ê°ì?
    if (nextState.stock.length === 0 && hasMovedRef.current) {
      const sig = getStateSignature(nextState);
      const recent = recentSigsRef.current;
      if (recent.filter(s => s === sig).length >= 3) {
        loseTimerRef.current = setTimeout(() => declareLose(), 2500);
        return;
      }
      recentSigsRef.current = [...recent.slice(-29), sig];
    }

    // ?„í—˜ ê²½ê³  (?¤í†¡ ?†ì„ ?Œë§Œ, ?´ë? ê²½ê³  ì¤‘ì´ë©??¤í‚µ)
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

  // ?¹ë¦¬ ê°ì?
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
      // ì§„ì „ ?ë‹¨: foundation ì¦ê? or ?·ë©´ ì¹´ë“œ ê°ì†Œ or ê°™ì? ë¬´ëŠ¬ ?©ì¹˜ê¸?      const foundationProgress = next.foundation.length > s.foundation.length;
      const faceDownBefore = s.columns.reduce((a, c) => a + c.filter(x => !x.faceUp).length, 0);
      const faceDownAfter = next.columns.reduce((a, c) => a + c.filter(x => !x.faceUp).length, 0);
      const faceDownProgress = faceDownAfter < faceDownBefore;
      if (foundationProgress || faceDownProgress) {
        noProgressRef.current = 0;  // ì§„ì „ ?ˆìœ¼ë©?ë¦¬ì…‹
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
  const diffDesc: Record<Difficulty, string> = { 1: "ì´ˆê¸‰", 2: "ì¤‘ê¸‰", 4: "ê³ ê¸‰" };
  const winRate = record.plays > 0 ? Math.round((record.wins / record.plays) * 100) : 0;
  // ?ë™?„ì„± ë²„íŠ¼: ?¤í†¡ ?†ê³  ê²Œì„ ì¤‘ì¼ ????ƒ ?œì‹œ (?¹ë¦¬ ?•ì • ?¬ë????´ë??ì„œ ?ë‹¨)
  const showAutoBtn = state.stock.length === 0 && state.status === "playing" && !autoRunning && !showLose;

  return (
    <div className="game">
      {/* ?¹ë¦¬ ?¤ë²„?ˆì´ */}
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
            <div className="win-trophy">?†</div>
            <h2 className="win-title">Victory!</h2>
            <p className="win-subtitle">ëª¨ë“  8ê°?ì¡°í•©???„ì„±?ˆì–´??</p>
            {isBestStreak && <div className="win-best-badge">?¯ ë² ìŠ¤??ê°±ì‹ ! {record.bestStreak}?°ì†</div>}
            <button className="btn btn-primary win-btn" onClick={e => { e.stopPropagation(); setShowDiffModal(true); }}>?¤ì‹œ ?˜ê¸°</button>
          </div>
        </div>
      )}

      {/* ?¨ë°° ?¤ë²„?ˆì´ */}
      {showLose && (
        <div className="lose-overlay">
          <div className="lose-modal">
            <div className="lose-icon">??</div>
            <h2 className="lose-title">Game Over</h2>
            <p className="lose-subtitle">???´ìƒ ? íš¨???´ë™???†ì–´??/p>
            <div className="lose-buttons">
              <button className="btn btn-primary" onClick={() => setShowDiffModal(true)}>??ê²Œì„</button>
              {canUndoAction && (
                <button className="btn" onClick={() => { setShowLose(false); onUndo(); }}>
                  ?˜ëŒë¦¬ê¸° ({3 - state.undoUsed}???¨ìŒ)
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ?„í—˜ ê²½ê³  ëª¨ë‹¬ */}
      {showDangerModal && dangerInfo && (
        <div className="modal-overlay">
          <div className="modal danger-modal">
            <div className="danger-icon">{dangerInfo.level === 'danger' ? '? ï¸' : '?š¨'}</div>
            <h2 className="danger-title">?„í—˜ ? í˜¸</h2>
            <ul className="danger-reasons">
              {dangerInfo.reasons.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
            <p className="danger-desc">ê³„ì† ì§„í–‰?˜ê² ??</p>
            <div className="lose-buttons">
              <button className="btn btn-primary" onClick={() => {
                setShowDangerModal(false); showDangerModalRef.current = false;
                setDangerInfo(null);
              }}>ê³„ì†?˜ê¸°</button>
              <button className="btn" onClick={() => {
                setShowDangerModal(false); showDangerModalRef.current = false;
                setDangerInfo(null);
                setShowDiffModal(true);
              }}>??ê²Œì„</button>
              {canUndoAction && (
                <button className="btn" onClick={() => {
                  setShowDangerModal(false);
                  setDangerInfo(null);
                  onUndo();
                }}>?˜ëŒë¦¬ê¸° ({3 - state.undoUsed}???¨ìŒ)</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ìºë¦­???´í™?????”ë©´ ê°€?´ë° */}
      {charVisible && (
        <div className="char-overlay">
          <div className="char-container">
            <img src={charImg} alt="char" className="char-img" />
            <div className={`char-bubble ${charBubbleVisible ? "bubble-visible" : ""}`}>{charLine}</div>
          </div>
        </div>
      )}

      <header className="topbar">
        <div className="topbar-left">
          <h1>?•· Spider</h1>
          <span className="diff-badge">{diffLabel[difficulty]} Â· {diffDesc[difficulty]}</span>
        </div>
        <div className="topbar-stats">
          <div className="stat"><span className="stat-label">?„ì„±</span><span className="stat-value">{state.foundation.length}/8</span></div>
          <div className="stat"><span className="stat-label">Undo</span><span className="stat-value">{state.undoUsed}/3</span></div>
          <button className="btn stat-record-btn" onClick={() => setShowRecord(true)}>?“Š {winRate}%</button>
        </div>
        <div className="buttons">
          <button className="btn btn-primary" onClick={() => setShowDiffModal(true)}>??ê²Œì„</button>
          <button className="btn" onClick={onDeal} disabled={!canDeal}>
            ì¹´ë“œ ë½‘ê¸°{state.stock.length > 0 && <span className="btn-badge">{Math.floor(state.stock.length/10)}</span>}
          </button>
          <button className="btn" onClick={onUndo} disabled={!canUndoAction}>
            ?˜ëŒë¦¬ê¸°{canUndoAction && <span className="btn-badge">{3 - state.undoUsed}</span>}
          </button>
          {showAutoBtn && (
            <button className="btn btn-auto" onClick={onAutoComplete}>???ë™?„ì„±</button>
          )}
        </div>
      </header>

      <div className="board-wrapper">
        <div className="foundation-area">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className={`foundation-slot ${i < state.foundation.length ? "filled" : ""}`}>
              {i < state.foundation.length ? "?? : ""}
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
          ) : <div className="stock-empty">ë¹„ì—ˆ??/div>}
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
              {col.length === 0 && <div className="empty-col-hint">ë¹???/div>}
              {col.map((card, cardIdx) => {
                const isSelected = pick?.fromCol === colIdx && pick?.fromIndex === cardIdx;
                const isFlashing = animCardIds.has(card.id);
                const topPx = (() => {
                  if (col.length <= 1) return 8;
                  const cardH = colHeight * 0.55;
                  const avail = colHeight - cardH - 16;
                  const naturalStep = avail / (col.length - 1);

                  // ?·ë©´ ì¹´ë“œ: ?‘ê²Œ ?‘ê¸° (8px)
                  // ?ë©´ ì¹´ë“œ: ?«ìê°€ ë³´ì¼ ë§Œí¼ (ìµœì†Œ 20px)
                  // ?? ?„ì²´ avail???˜ì? ?Šë„ë¡??™ì  ì¡°ì •
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
            <h2>?“Š ?„ì </h2>
            <div className="record-grid">
              <div className="record-item"><span className="record-label">?Œë ˆ??/span><span className="record-value">{record.plays}</span></div>
              <div className="record-item"><span className="record-label">?±ê³µ</span><span className="record-value">{record.wins}</span></div>
              <div className="record-item"><span className="record-label">?±ê³µë¥?/span><span className="record-value">{winRate}%</span></div>
              <div className="record-item"><span className="record-label">?°ì† ?±ê³µ</span><span className="record-value">{record.currentStreak}</span></div>
              <div className="record-item record-item-wide">
                <span className="record-label">ìµœê³  ?°ì†</span>
                <span className="record-value record-best">{record.bestStreak}
                  {record.currentStreak > 0 && record.currentStreak === record.bestStreak && record.bestStreak > 0 &&
                    <span className="best-tag">?¯ ë² ìŠ¤??/span>}
                </span>
              </div>
            </div>
            <div className="record-actions">
              <button className="btn btn-danger" onClick={resetRecord}>?„ì  ì´ˆê¸°??/button>
              <button className="btn" onClick={() => setShowRecord(false)}>?«ê¸°</button>
            </div>
          </div>
        </div>
      )}

      {showDiffModal && (
        <div className="modal-overlay" onClick={() => setShowDiffModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>?œì´??? íƒ</h2>
            <p>??ê²Œì„???œì‘???œì´?„ë? ? íƒ?˜ì„¸??/p>
            <div className="diff-options">
              {([1,2,4] as Difficulty[]).map(d => (
                <button key={d} className={`diff-btn ${difficulty===d ? "active" : ""}`} onClick={() => startNewGame(d)}>
                  <span className="diff-suits">{d===1 ? "?? : d===2 ? "? â™¥" : "? â™¥?¦â™£"}</span>
                  <span className="diff-name">{diffLabel[d]}</span>
                  <span className="diff-sub">{diffDesc[d]}</span>
                </button>
              ))}
            </div>
            <button className="btn" onClick={() => setShowDiffModal(false)}>ì·¨ì†Œ</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
