export namespace RetrievalRerank {
  export function apply(input: {
    queryVector: number[]
    candidates: unknown[]
    candidateVectors: Map<string, number[]>
  }): unknown[] {
    const queryNorm = normalizeVector(input.queryVector)

    const scored = input.candidates.map((candidate: any) => {
      const chunkID = candidate.chunkID as string
      const candidateVector = input.candidateVectors.get(chunkID)
      let score = 0

      if (candidateVector) {
        const normCandidate = normalizeVector(candidateVector)
        score = dotProduct(queryNorm, normCandidate)
      }

      return {
        ...candidate,
        rerankScore: score,
      }
    })

    scored.sort((a: any, b: any) => (b.rerankScore ?? 0) - (a.rerankScore ?? 0))

    return scored
  }
}

function normalizeVector(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0)) || 1
  return vec.map((v) => v / norm)
}

function dotProduct(a: number[], b: number[]): number {
  let sum = 0
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    sum += a[i] * b[i]
  }
  return sum
}
