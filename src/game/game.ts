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
    const size = col < 4 ? 6 : 5
    for (let k = 0; k < size; k++) {
      const card = deck[idx++]
      columns[col].push(card)
    }
    const top = columns[col][columns[col].length - 1]
    top.faceUp = true
  }

  const stock = deck.slice(idx)
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

export function autoClearCompleted(state: GameState): GameState {
  let changed = true
  let s = state

  while (changed) {
    changed = false

    for (let colIdx = 0; colIdx < 10; colIdx++) {
      const col = s.columns[colIdx]
      if (col.length < 13) continue

      const top13 = col.slice(col.length - 13)

      if (!top13.every(c => c.faceUp)) continue

      const suit = top13[0].suit
      if (!top13.every(c => c.suit === suit)) continue

      let ok = true
      for (let i = 0; i < 13; i++) {
        const expectedRank = 13 - i
        if (top13[i].rank !== expectedRank) {
          ok = false
          break
        }
      }
      if (!ok) continue

      const newColumns = s.columns.map((c, i) =>
        i === colIdx ? c.slice(0, c.length - 13) : c
      )

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

  if (s.foundation.length === 8) {
    s = { ...s, status: 'won' }
  }

  return s
}

export function dealFromStock(state: GameState): GameState {
  if (state.status !== 'playing') return state
  if (state.stock.length < 10) return state

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

  s = autoClearCompleted(s)
  return s
}

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
  fromIndex: number
}

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

export function canDropStack(columns: Card[][], targetCol: number, stack: Card[]): boolean {
  const col = columns[targetCol]
  if (!col) return false
  if (stack.length === 0) return false

  if (col.length === 0) return true
  const top = col[col.length - 1]
  return top.rank === stack[0].rank + 1
}

export function moveStack(state: GameState, pick: Pick, targetCol: number): GameState {
  if (state.status !== 'playing') return state
  if (pick.fromCol === targetCol) return state

  const from = state.columns[pick.fromCol]
  if (!from) return state
  if (pick.fromIndex < 0 || pick.fromIndex >= from.length) return state

  if (!canPickStack(state.columns, pick.fromCol, pick.fromIndex)) return state

  const moving = from.slice(pick.fromIndex).map(c => ({ ...c }))

  if (!canDropStack(state.columns, targetCol, moving)) return state

  let s = pushHistory(state)

  const newColumns = s.columns.map((col, idx) => {
    if (idx === pick.fromCol) {
      const remain = col.slice(0, pick.fromIndex).map(c => ({ ...c }))
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
  s = autoClearCompleted(s)
  return s
}
