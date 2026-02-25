import type { GameState, Card } from './types'
import { moveStack, canPickStack, canDropStack } from './game'

export type Move = { fromCol: number; fromIndex: number; toCol: number }

/**
 * 자동완성 가능 여부 판단:
 * - 스톡이 없고
 * - 모든 카드가 앞면이고
 * - 각 열의 카드가 같은 무늬로 연속된 순서 (rank가 1씩 감소)
 */
export function canAutoComplete(state: GameState): boolean {
  if (state.stock.length > 0) return false
  if (state.status !== 'playing') return false

  for (const col of state.columns) {
    for (const card of col) {
      if (!card.faceUp) return false
    }
    // 각 열 내부가 같은 무늬, 연속 순서인지 확인
    for (let i = 0; i < col.length - 1; i++) {
      if (col[i].suit !== col[i + 1].suit) return false
      if (col[i].rank !== col[i + 1].rank + 1) return false
    }
  }
  return true
}

/**
 * 자동완성 이동 시퀀스 생성
 * 전략: 같은 무늬 카드를 한 열에 모아서 K~A 완성 반복
 */
export function buildAutoCompleteSequence(initialState: GameState): Move[] {
  const moves: Move[] = []
  let s = initialState
  const maxIterations = 500 // 무한루프 방지

  for (let iter = 0; iter < maxIterations; iter++) {
    if (s.status === 'won') break

    const move = findBestMove(s)
    if (!move) break

    moves.push(move)
    s = moveStack(s, { fromCol: move.fromCol, fromIndex: move.fromIndex }, move.toCol)
    if (s === initialState) break // 이동 실패
  }

  return moves
}

function findBestMove(s: GameState): Move | null {
  const cols = s.columns

  // 우선순위 1: 완성 가능한 열(K~A 같은 무늬 13장)로 합치기
  for (let toCol = 0; toCol < 10; toCol++) {
    const col = cols[toCol]
    if (col.length === 0) continue
    // 이 열의 bottom 카드 suit
    const bottomSuit = col[0].suit
    const neededRank = col[0].rank // top이 아니라 bottom의 rank (정렬된 상태)

    for (let fromCol = 0; fromCol < 10; fromCol++) {
      if (fromCol === toCol) continue
      const from = cols[fromCol]
      if (from.length === 0) continue

      // fromCol 전체 스택을 toCol에 붙일 수 있는지
      const topCard = from[from.length - 1]
      if (topCard.suit !== bottomSuit) continue

      // fromCol 맨 위부터 이어붙이면 완성되는지 확인
      for (let fromIdx = 0; fromIdx < from.length; fromIdx++) {
        if (!canPickStack(cols, fromCol, fromIdx)) continue
        const stack = from.slice(fromIdx)
        if (stack[0].suit !== bottomSuit) continue
        if (!canDropStack(cols, toCol, stack)) continue

        // 이 이동이 같은 무늬 합치기인지 확인
        if (stack.every(c => c.suit === bottomSuit)) {
          return { fromCol, fromIndex: fromIdx, toCol }
        }
      }
    }
  }

  // 우선순위 2: 같은 무늬끼리 합치기 (아무 이동이나)
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

  // 우선순위 3: 유효한 아무 이동
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
