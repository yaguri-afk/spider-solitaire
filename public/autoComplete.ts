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

/** 패배 확정: 스톡 없음 + 이동 불가 */
export function isDeadlock(state: GameState): boolean {
  if (state.status !== 'playing') return false
  if (state.stock.length > 0) return false
  return !hasAnyMove(state)
}

/** 유효한 이동이 하나라도 있는지 */
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

export type DangerLevel = 'safe' | 'warning' | 'danger' | 'deadlock'

export type DangerInfo = {
  level: DangerLevel
  score: number       // 0~100, 높을수록 위험
  reasons: string[]   // 경고 이유 목록
}

/**
 * 현재 상태의 위험도 분석
 * score 0~40: safe / 41~65: warning / 66~85: danger / 86+: deadlock
 */
/**
 * noProgressCount: 같은무늬합치기/뒷면뒤집기/foundation 없이 이동한 횟수
 */
export function analyzeDanger(state: GameState, noProgressCount: number = 0): DangerInfo {
  if (state.status !== 'playing') return { level: 'safe', score: 0, reasons: [] }

  // 패배 확정
  if (isDeadlock(state)) {
    return { level: 'deadlock', score: 100, reasons: ['더 이상 유효한 이동이 없어'] }
  }

  let score = 0
  const reasons: string[] = []
  const cols = state.columns

  // 1. 이동 가능한 수 계산
  let moveCount = 0
  if (state.stock.length > 0) moveCount++ // 뽑기 가능
  for (let fromCol = 0; fromCol < 10; fromCol++) {
    const from = cols[fromCol]
    if (from.length === 0) continue
    for (let fromIdx = 0; fromIdx < from.length; fromIdx++) {
      if (!canPickStack(cols, fromCol, fromIdx)) continue
      const stack = from.slice(fromIdx)
      for (let toCol = 0; toCol < 10; toCol++) {
        if (toCol === fromCol) continue
        if (canDropStack(cols, toCol, stack)) { moveCount++; break }
      }
      break // 열당 최상위 스택만 체크
    }
  }
  if (moveCount <= 1) { score += 30; reasons.push('가능한 이동이 거의 없어') }
  else if (moveCount <= 3) { score += 8 }

  // 2. 빈 열 수
  const emptyCols = cols.filter(c => c.length === 0).length
  if (emptyCols === 0 && state.stock.length === 0) { score += 25; reasons.push('빈 열이 없어') }
  else if (emptyCols === 0) { score += 10 }

  // 3. 같은 무늬끼리 합칠 수 있는 기회
  let sameSuitMerge = 0
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
          sameSuitMerge++
        }
      }
    }
  }
  if (sameSuitMerge === 0 && state.stock.length === 0) {
    score += 20
    reasons.push('같은 무늬끼리 합칠 수 있는 수가 없어')
  }

  // 4. 뒷면 카드 비율 (스톡 제외)
  const totalCards = cols.reduce((s, c) => s + c.length, 0)
  const faceDownCards = cols.reduce((s, c) => s + c.filter(card => !card.faceUp).length, 0)
  const faceDownRatio = totalCards > 0 ? faceDownCards / totalCards : 0
  if (faceDownRatio > 0.5 && state.stock.length === 0) {
    score += 15
    reasons.push('뒤집힌 카드가 너무 많아')
  }

  // 5. 스톡 없음 패널티
  if (state.stock.length === 0) score += 5

  // 6. 진전 없는 이동 반복 감지
  if (noProgressCount >= 6)  { score += 15; reasons.push('계속 제자리를 맴돌고 있어') }
  if (noProgressCount >= 12) { score += 20 }  // 누적 가산

  // 레벨 판정
  let level: DangerLevel
  if (score >= 86) level = 'deadlock'
  else if (score >= 80) level = 'danger'
  else if (score >= 60) level = 'warning'
  else level = 'safe'

  return { level, score, reasons }
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
