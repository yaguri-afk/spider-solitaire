export type Suit = 'S' | 'H' | 'D' | 'C'
export type Difficulty = 1 | 2 | 4

export type Card = {
  id: string
  suit: Suit
  rank: number // 1(A) ~ 13(K)
  faceUp: boolean
}

export type GameStatus = 'playing' | 'won'

export type GameSnapshot = {
  difficulty: Difficulty
  columns: Card[][]
  stock: Card[]
  foundation: Card[][]
  undoUsed: number
  status: GameStatus
}

export type GameState = GameSnapshot & {
  history: GameSnapshot[]
}
