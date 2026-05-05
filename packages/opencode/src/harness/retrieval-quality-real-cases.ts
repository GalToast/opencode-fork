// @ts-nocheck
export interface RetrievalQualityBenchmarkScenario {
  id: string
  query: string
  category?: string
  sharedContext?: string
  detail?: string
  expectedIntent?: string
}
export const REAL_RETRIEVAL_QUALITY_SCENARIOS: RetrievalQualityBenchmarkScenario[] = []
