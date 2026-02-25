import type { GameState } from './types'
import { moveStack, canPickStack, canDropStack } from './game'

export type Move = { fromCol: number; fromIndex: number; toCol: number }

/** 유효한 이동이 하나라도 있는지 확인 */
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

/** 현재 상태의 컬럼 시그니처 (무한루프 감지용) */
export function getStateSignature(state: GameState): string {
  return state.columns
    .map(col => col.map(c => `${c.rank}${c.suit}`).join(','))
    .join('|')
}

/** 자동완성 이동 시퀀스 생성 — 같은 무늬끼리만 이동 */
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

/**
 * 같은 무늬끼리만 이동 — 우선순위:
 * 1. 빈 열로 K 이동 (공간 확보)
 * 2. 같은 무늬 스택을 더 긴 같은 무늬 스택 위에 합치기
 * 3. 같은 무늬끼리 붙일 수 있는 모든 이동
 */
function findSameSuitMove(s: GameState): Move | null {
  const cols = s.columns

  // 우선순위 1: 같은 무늬 스택을 같은 무늬 위에 합치기 (rank 연속)
  for (let fromCol = 0; fromCol < 10; fromCol++) {
    const from = cols[fromCol]
    if (from.length === 0) continue
    for (let fromIdx = 0; fromIdx < from.length; fromIdx++) {
      if (!canPickStack(cols, fromCol, fromIdx)) continue
      const stack = from.slice(fromIdx)
      const suit = stack[0].suit
      // 스택이 전부 같은 무늬여야 함
      if (!stack.every(c => c.suit === suit)) continue
      for (let toCol = 0; toCol < 10; toCol++) {
        if (toCol === fromCol) continue
        if (!canDropStack(cols, toCol, stack)) continue
        const toCol_ = cols[toCol]
        // 대상 열 맨 위 카드도 같은 무늬여야 함
        if (toCol_.length > 0 && toCol_[toCol_.length - 1].suit === suit) {
          return { fromCol, fromIndex: fromIdx, toCol }
        }
      }
    }
  }

  // 우선순위 2: 빈 열로 같은 무늬 스택 이동 (공간 확보용)
  const emptyCol = cols.findIndex(col => col.length === 0)
  if (emptyCol !== -1) {
    // K로 시작하는 같은 무늬 스택을 빈 열로
    for (let fromCol = 0; fromCol < 10; fromCol++) {
      const from = cols[fromCol]
      if (from.length === 0) continue
      for (let fromIdx = 0; fromIdx < from.length; fromIdx++) {
        if (!canPickStack(cols, fromCol, fromIdx)) continue
        const stack = from.slice(fromIdx)
        const suit = stack[0].suit
        if (!stack.every(c => c.suit === suit)) continue
        if (stack[0].rank === 13) { // K로 시작
          return { fromCol, fromIndex: fromIdx, toCol: emptyCol }
        }
      }
    }
    // K가 아니더라도 같은 무늬 스택을 빈 열로 이동해서 다른 곳에 붙일 준비
    for (let fromCol = 0; fromCol < 10; fromCol++) {
      const from = cols[fromCol]
      if (from.length === 0) continue
      for (let fromIdx = 0; fromIdx < from.length; fromIdx++) {
        if (!canPickStack(cols, fromCol, fromIdx)) continue
        const stack = from.slice(fromIdx)
        const suit = stack[0].suit
        if (!stack.every(c => c.suit === suit)) continue
        // 빈 열로 이동 후 다른 같은 무늬 열과 합칠 수 있는지 확인
        const topRank = stack[0].rank
        const hasSameSuitTarget = cols.some((col, ci) => {
          if (ci === fromCol || ci === emptyCol) return false
          if (col.length === 0) return false
          const top = col[col.length - 1]
          return top.suit === suit && top.rank === topRank + 1
        })
        if (hasSameSuitTarget) {
          return { fromCol, fromIndex: fromIdx, toCol: emptyCol }
        }
      }
    }
  }

  return null
}
