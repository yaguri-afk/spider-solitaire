import type { GameState } from './types'
import { moveStack, canPickStack, canDropStack } from './game'

export type Move = { fromCol: number; fromIndex: number; toCol: number }

/** 승리 확정 조건: 스톡 없음 + 모든 카드 앞면 */
export function isAutoCompleteReady(state: GameState): boolean {
  if (state.stock.length > 0) return false
  if (state.status !== 'playing') return false
  for (const col of state.columns) {
    for (const card of col) {
      if (!card.faceUp) return false
    }
  }
  return true
}

/** 패배 확정 조건: 유효한 이동이 전혀 없음 (스톡 포함) */
export function isDeadlock(state: GameState): boolean {
  if (state.status !== 'playing') return false
  if (state.stock.length > 0) return false  // 스톡 있으면 뽑기 가능
  return !hasAnyMove(state)
}

/** 유효한 이동이 하나라도 있는지 확인 */
export function hasAnyMove(state: GameState): boolean {
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

/** 무한루프 감지용 상태 시그니처 */
export function getStateSignature(state: GameState): string {
  return state.columns
    .map(col => col.map(c => `${c.rank}${c.suit}${c.faceUp ? 'u' : 'd'}`).join(','))
    .join('|')
}

/** 자동완성 이동 시퀀스 — 같은 무늬끼리만 */
export function buildAutoCompleteSequence(initialState: GameState): Move[] {
  const moves: Move[] = []
  let s = initialState

  for (let iter = 0; iter < 1000; iter++) {
    if (s.status === 'won') break
    const move = findSameSuitMove(s)
    if (!move) break
    const next = moveStack(s, { fromCol: move.fromCol, fromIndex: move.fromIndex }, move.toCol)
    if (next === s) break
    moves.push(move)
    s = next
  }
  return moves
}

function findSameSuitMove(s: GameState): Move | null {
  const cols = s.columns

  // 우선순위 1: 같은 무늬 스택을 같은 무늬 위에 직접 합치기
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

  // 우선순위 2: 빈 열 경유 — 합치기 위한 공간 확보
  const emptyColIdx = cols.findIndex(col => col.length === 0)
  if (emptyColIdx !== -1) {
    for (let fromCol = 0; fromCol < 10; fromCol++) {
      const from = cols[fromCol]
      if (from.length === 0) continue
      for (let fromIdx = 0; fromIdx < from.length; fromIdx++) {
        if (!canPickStack(cols, fromCol, fromIdx)) continue
        const stack = from.slice(fromIdx)
        const suit = stack[0].suit
        if (!stack.every(c => c.suit === suit)) continue
        const topRank = stack[0].rank
        const canMergeAfter = cols.some((col, ci) => {
          if (ci === fromCol || ci === emptyColIdx || col.length === 0) return false
          const top = col[col.length - 1]
          return top.suit === suit && top.rank === topRank + 1
        })
        if (canMergeAfter) {
          return { fromCol, fromIndex: fromIdx, toCol: emptyColIdx }
        }
      }
    }
  }

  return null
}
