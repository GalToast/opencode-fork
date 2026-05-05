export namespace NegativeIndex {
  export async function query(input: { projectID: string; query: string; limit: number }): Promise<{
    candidates: Array<{ path: string; score: number; snippet: string }>
  }> {
    return { candidates: [] }
  }
}
