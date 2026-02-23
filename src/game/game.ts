import type { Card, Difficulty, GameSnapshot, GameState, Suit } from './types'

function uid() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function suitsForDifficulty(d: Difficulty): Suit[] {
  if (d === 1) return ['S']
  if (d === 2) return ['S', 'H']
  return ['S', 'H', 'D', 'C']
}

export function makeDeck(difficulty: Difficulty): Card[] {
  const suits = suitsForDifficulty(difficulty)
  const deck: Card[] = []

  const setsPerSuit = 8 / suits.length // 1무늬=8, 2무늬=4, 4무늬=2

  for (const suit of suits) {
    for (let set = 0; set < setsPerSuit; set++) {
      for (let rank = 1; rank <= 13; rank++) {
        deck.push({
          id: uid(),
          suit,
          rank,
          faceUp: false,
        })
      }
    }
  }

  return shuffle(deck)
}

function deepCloneSnapshot(s: GameSnapshot): GameSnapshot {
  // 카드/배열이 참조 공유되면 undo가 망가져서, 깊은 복사로 안전하게 스냅샷 저장
  return {
    difficulty: s.difficulty,
    undoUsed: s.undoUsed,
    status: s.status,
    stock: s.stock.map(c => ({ ...c })),
    columns: s.columns.map(col => col.map(c => ({ ...c }))),
    foundation: s.foundation.map(pile => pile.map(c => ({ ...c }))),
  }
}

function toSnapshot(state: GameState): GameSnapshot {
  const { history, ...snap } = state
  return snap
}

function pushHistory(state: GameState): GameState {
  const snap = deepCloneSnapshot(toSnapshot(state))
  return { ...state, history: [...state.history, snap] }
}

function dealInitial(deck: Card[]): { columns: Card[][]; stock: Card[] } {
  const columns: Card[][] = Array.from({ length: 10 }, () => [])

  let idx = 0
  for (let col = 0; col < 10; col++) {
    const size = col < 4 ? 6 : 5 // 총 54장
    for (let k = 0; k < size; k++) {
      const card = deck[idx++]
      columns[col].push(card)
    }
    const top = columns[col][columns[col].length - 1]
    top.faceUp = true
  }

  const stock = deck.slice(idx) // 50장
  return { columns, stock }
}

export function newGame(difficulty: Difficulty = 2): GameState {
  const deck = makeDeck(difficulty)
  const { columns, stock } = dealInitial(deck)

  const snapshot: GameSnapshot = {
    difficulty,
    columns,
    stock,
    foundation: [],
    undoUsed: 0,
    status: 'playing',
  }

  return {
    ...snapshot,
    history: [],
  }
}

/**
 * 자동 완성 제거:
 * - 어떤 열의 맨 위 13장이 K..A(13..1)이고
 * - 모두 faceUp이고
 * - 모두 같은 suit이면
 * -> 그 13장을 foundation으로 옮김
 *
 * 한 번 제거하고 나면 또 완성될 수 있으므로 반복.
 */
export function autoClearCompleted(state: GameState): GameState {
  let changed = true
  let s = state

  while (changed) {
    changed = false

    for (let colIdx = 0; colIdx < 10; colIdx++) {
      const col = s.columns[colIdx]
      if (col.length < 13) continue

      const top13 = col.slice(col.length - 13)

      // 전부 faceUp?
      if (!top13.every(c => c.faceUp)) continue

      // 같은 suit?
      const suit = top13[0].suit
      if (!top13.every(c => c.suit === suit)) continue

      // K..A 내림차순?
      // top13[0]가 가장 아래(13장 중 첫 번째), top13[12]가 맨 위
      // 우리가 원하는 건: 아래쪽부터 13,12,...,1
      let ok = true
      for (let i = 0; i < 13; i++) {
        const expectedRank = 13 - i
        if (top13[i].rank !== expectedRank) {
          ok = false
          break
        }
      }
      if (!ok) continue

      // 제거 실행
      const newColumns = s.columns.map((c, i) =>
        i === colIdx ? c.slice(0, c.length - 13) : c
      )

      // 제거 후, 남은 카드가 있으면 맨 위 카드 뒤집기
      const afterCol = newColumns[colIdx]
      if (afterCol.length > 0) {
        const last = afterCol[afterCol.length - 1]
        last.faceUp = true
      }

      const newFoundation = [...s.foundation, top13.map(c => ({ ...c }))]

      s = {
        ...s,
        columns: newColumns,
        foundation: newFoundation,
      }

      changed = true
      break
    }
  }

  // 승리 체크: foundation에 8묶음이면 104장 전부 완성
  if (s.foundation.length === 8) {
    s = { ...s, status: 'won' }
  }

  return s
}

/**
 * Deal:
 * - stock이 최소 10장 있어야 함
 * - 10열 각각에 1장씩 뿌림 (모두 faceUp = true)
 */
export function dealFromStock(state: GameState): GameState {
  if (state.status !== 'playing') return state
  if (state.stock.length < 10) return state

  // 히스토리 저장 (Undo 용)
  let s = pushHistory(state)

  const dealCards = s.stock.slice(0, 10)
  const remaining = s.stock.slice(10)

  const newColumns = s.columns.map((col, i) => {
    const c = { ...dealCards[i], faceUp: true }
    return [...col.map(x => ({ ...x })), c]
  })

  s = {
    ...s,
    stock: remaining.map(c => ({ ...c })),
    columns: newColumns,
  }

  // 자동 완성 제거
  s = autoClearCompleted(s)
  return s
}

/**
 * Undo (3회 제한):
 * - undoUsed가 3 이상이면 안됨
 * - history가 비어 있으면 안됨
 */
export function undo(state: GameState): GameState {
  if (state.undoUsed >= 3) return state
  if (state.history.length === 0) return state

  const prev = state.history[state.history.length - 1]
  const remainingHistory = state.history.slice(0, -1)

  return {
    ...deepCloneSnapshot(prev),
    history: remainingHistory,
    undoUsed: state.undoUsed + 1,
  }
}

export function rankLabel(rank: number): string {
  if (rank === 1) return 'A'
  if (rank === 11) return 'J'
  if (rank === 12) return 'Q'
  if (rank === 13) return 'K'
  return String(rank)
}

export function suitLabel(suit: Suit): string {
  if (suit === 'S') return '♠'
  if (suit === 'H') return '♥'
  if (suit === 'D') return '♦'
  return '♣'
}

export type Pick = {
  fromCol: number
  fromIndex: number // 그 열에서 몇 번째 카드부터 들었는지
}

/**
 * 주어진 열에서 fromIndex부터 끝까지가 "연속 내림차순"인지 확인.
 * (faceUp이 아닌 카드가 포함되면 실패)
 */
export function canPickStack(columns: Card[][], fromCol: number, fromIndex: number): boolean {
  const col = columns[fromCol]
  if (!col) return false
  const stack = col.slice(fromIndex)
  if (stack.length === 0) return false
  if (!stack.every(c => c.faceUp)) return false

  for (let i = 0; i < stack.length - 1; i++) {
    if (stack[i].rank !== stack[i + 1].rank + 1) return false
  }
  return true
}

/**
 * targetCol로 stack을 놓을 수 있는지 확인.
 */
export function canDropStack(columns: Card[][], targetCol: number, stack: Card[]): boolean {
  const col = columns[targetCol]
  if (!col) return false
  if (stack.length === 0) return false

  if (col.length === 0) return true
  const top = col[col.length - 1]
  return top.rank === stack[0].rank + 1
}

/**
 * 실제 이동 적용 (Undo + 자동완성제거 포함)
 */
export function moveStack(state: GameState, pick: Pick, targetCol: number): GameState {
  if (state.status !== 'playing') return state
  if (pick.fromCol === targetCol) return state

  const from = state.columns[pick.fromCol]
  if (!from) return state
  if (pick.fromIndex < 0 || pick.fromIndex >= from.length) return state

  // 집을 수 있나?
  if (!canPickStack(state.columns, pick.fromCol, pick.fromIndex)) return state

  const moving = from.slice(pick.fromIndex).map(c => ({ ...c }))

  // 놓을 수 있나?
  if (!canDropStack(state.columns, targetCol, moving)) return state

  // 히스토리 저장 (Undo 가능)
  let s = pushHistory(state)

  const newColumns = s.columns.map((col, idx) => {
    if (idx === pick.fromCol) {
      const remain = col.slice(0, pick.fromIndex).map(c => ({ ...c }))
      // 이동 후, 남은 카드가 있으면 맨 위 카드 뒤집기
      if (remain.length > 0) {
        remain[remain.length - 1].faceUp = true
      }
      return remain
    }
    if (idx === targetCol) {
      const base = col.map(c => ({ ...c }))
      return [...base, ...moving]
    }
    return col.map(c => ({ ...c }))
  })

  s = { ...s, columns: newColumns }

  // 자동 완성 제거
  s = autoClearCompleted(s)
  return s
}