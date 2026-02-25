import type { GameState } from './types'
import { moveStack, canPickStack, canDropStack } from './game'

export type Move = { fromCol: number; fromIndex: number; toCol: number }

export function canAutoComplete(state: GameState): boolean {
  if (state.stock.length > 0) return false
  if (state.status !== 'playing') return false
  for (const col of state.columns) {
    for (const card of col) {
      if (!card.faceUp) return false
    }
    for (let i = 0; i < col.length - 1; i++) {
      if (col[i].suit !== col[i + 1].suit) return false
      if (col[i].rank !== col[i + 1].rank + 1) return false
    }
  }
  return true
}

export function hasAnyMove(state: GameState): boolean {
  if (state.stock.length > 0) return true
  const cols = state.columns
  for (let fromCol = 0; fromCol < 10; fromCol++) {
    const from = cols[fromCol]
    if (from.length === 0) continue
    for (let fromIdx = 0; fromIdx < from.length; fromIdx++) {
      if (!canPickStack(cols, fromCol, fromIdx)) continue
      const stack = from.slice(fromIdx)
      for (let toCol = 0; toCol < 10; toCol++) {
        if (toCol === fromCol) continue
        if (canDropStack(cols, toCol, stack)) return true
      }
    }
  }
  return false
}

export function getStateSignature(state: GameState): string {
  return state.columns
    .map(col => col.map(c => `${c.rank}${c.suit}`).join(','))
    .join('|')
}

export function buildAutoCompleteSequence(initialState: GameState): Move[] {
  const moves: Move[] = []
  let s = initialState
  for (let iter = 0; iter < 500; iter++) {
    if (s.status === 'won') break
    const move = findBestMove(s)
    if (!move) break
    const next = moveStack(s, { fromCol: move.fromCol, fromIndex: move.fromIndex }, move.toCol)
    if (next === s) break
    moves.push(move)
    s = next
  }
  return moves
}

function findBestMove(s: GameState): Move | null {
  const cols = s.columns
  for (let fromCol = 0; fromCol < 10; fromCol++) {
    const from = cols[fromCol]
    if (from.length === 0) continue
    for (let fromIdx = 0; fromIdx < from.length; fromIdx++) {
      if (!canPickStack(cols, fromCol, fromIdx)) continue
      const stack = from.slice(fromIdx)
      const suit = stack[0].suit
      if (!stack.every(c => c.suit === suit)) continue
      for (let toCol = 0; toCol < 10; toCol++) {
        if (toCol === fromCol) continue
        if (!canDropStack(cols, toCol, stack)) continue
        const toTop = cols[toCol]
        if (toTop.length > 0 && toTop[toTop.length - 1].suit === suit) {
          return { fromCol, fromIndex: fromIdx, toCol }
        }
      }
    }
  }
  for (let fromCol = 0; fromCol < 10; fromCol++) {
    const from = cols[fromCol]
    if (from.length === 0) continue
    for (let fromIdx = 0; fromIdx < from.length; fromIdx++) {
      if (!canPickStack(cols, fromCol, fromIdx)) continue
      for (let toCol = 0; toCol < 10; toCol++) {
        if (toCol === fromCol) continue
        if (canDropStack(cols, toCol, from.slice(fromIdx))) {
          return { fromCol, fromIndex: fromIdx, toCol }
        }
      }
    }
  }
  return null
}