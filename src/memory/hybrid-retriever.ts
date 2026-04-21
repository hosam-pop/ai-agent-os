/**
 * HybridRetriever — BM25 + vector score fusion.
 *
 * Rationale: pure vector search recalls concepts but misses exact
 * tokens (error codes, filenames, acronyms). BM25 does the opposite.
 * Merging them with a weighted sum typically improves precision by
 * 5-15 % on agent-memory benchmarks.
 *
 * The retriever is deliberately stateless about *where* the
 * documents live. Callers supply a `vectorSearch` function
 * (typically backed by Chroma / Qdrant) and a corpus for BM25.
 * That keeps the existing `Mem0 + Chroma` wiring untouched.
 */

import { logger } from '../utils/logger.js';

export interface HybridDoc {
  readonly id: string;
  readonly text: string;
  readonly metadata?: Record<string, unknown>;
}

export interface HybridScoredDoc extends HybridDoc {
  readonly bm25Score: number;
  readonly vectorScore: number;
  readonly score: number;
}

export interface HybridRetrieverOptions {
  readonly bm25Weight?: number;
  readonly vectorWeight?: number;
  readonly k1?: number;
  readonly b?: number;
}

export interface VectorMatch {
  readonly id: string;
  readonly score: number;
}

export class HybridRetriever {
  private readonly corpus = new Map<string, HybridDoc>();
  private readonly termFreq = new Map<string, Map<string, number>>();
  private readonly docLen = new Map<string, number>();
  private docCountByTerm = new Map<string, number>();
  private totalLen = 0;
  private readonly bm25Weight: number;
  private readonly vectorWeight: number;
  private readonly k1: number;
  private readonly b: number;

  constructor(opts: HybridRetrieverOptions = {}) {
    this.bm25Weight = opts.bm25Weight ?? 0.5;
    this.vectorWeight = opts.vectorWeight ?? 0.5;
    this.k1 = opts.k1 ?? 1.5;
    this.b = opts.b ?? 0.75;
  }

  addDocument(doc: HybridDoc): void {
    if (this.corpus.has(doc.id)) this.removeDocument(doc.id);
    this.corpus.set(doc.id, doc);
    const tokens = tokenize(doc.text);
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    this.termFreq.set(doc.id, tf);
    this.docLen.set(doc.id, tokens.length);
    this.totalLen += tokens.length;
    for (const term of tf.keys()) {
      this.docCountByTerm.set(term, (this.docCountByTerm.get(term) ?? 0) + 1);
    }
  }

  removeDocument(id: string): void {
    const tf = this.termFreq.get(id);
    if (!tf) return;
    for (const term of tf.keys()) {
      const c = (this.docCountByTerm.get(term) ?? 1) - 1;
      if (c <= 0) this.docCountByTerm.delete(term);
      else this.docCountByTerm.set(term, c);
    }
    this.totalLen -= this.docLen.get(id) ?? 0;
    this.termFreq.delete(id);
    this.docLen.delete(id);
    this.corpus.delete(id);
  }

  size(): number {
    return this.corpus.size;
  }

  /**
   * Score `query` with BM25 over every indexed document.
   * Documents not in the corpus are not returned.
   */
  bm25(query: string): Array<{ id: string; score: number }> {
    const tokens = tokenize(query);
    if (tokens.length === 0 || this.corpus.size === 0) return [];
    const avgdl = this.totalLen / this.corpus.size;
    const out: Array<{ id: string; score: number }> = [];
    for (const [id, tf] of this.termFreq) {
      const dl = this.docLen.get(id) ?? 0;
      let score = 0;
      for (const term of tokens) {
        const f = tf.get(term) ?? 0;
        if (f === 0) continue;
        const df = this.docCountByTerm.get(term) ?? 0;
        const idf = Math.log(1 + (this.corpus.size - df + 0.5) / (df + 0.5));
        const denom = f + this.k1 * (1 - this.b + this.b * (dl / (avgdl || 1)));
        score += idf * ((f * (this.k1 + 1)) / (denom || 1));
      }
      if (score > 0) out.push({ id, score });
    }
    out.sort((a, b) => b.score - a.score);
    return out;
  }

  /**
   * Merge BM25 and vector scores into one ranking. Scores are
   * normalised into [0, 1] before the weighted sum, so the weights
   * really do control the balance.
   */
  async retrieve(
    query: string,
    vectorSearch: (q: string) => Promise<readonly VectorMatch[]>,
    topK = 10,
  ): Promise<HybridScoredDoc[]> {
    const bm25Raw = this.bm25(query);
    let vectorRaw: readonly VectorMatch[] = [];
    try {
      vectorRaw = await vectorSearch(query);
    } catch (err) {
      logger.warn('hybrid-retriever.vector-search.error', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const bm25Norm = normalise(bm25Raw.map((r) => ({ id: r.id, score: r.score })));
    const vecNorm = normalise(vectorRaw.map((r) => ({ id: r.id, score: r.score })));

    const ids = new Set<string>();
    bm25Norm.forEach((r) => ids.add(r.id));
    vecNorm.forEach((r) => ids.add(r.id));

    const out: HybridScoredDoc[] = [];
    for (const id of ids) {
      const doc = this.corpus.get(id);
      if (!doc) continue;
      const bm = bm25Norm.find((r) => r.id === id)?.score ?? 0;
      const vec = vecNorm.find((r) => r.id === id)?.score ?? 0;
      const combined = this.bm25Weight * bm + this.vectorWeight * vec;
      out.push({ ...doc, bm25Score: bm, vectorScore: vec, score: combined });
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, topK);
  }
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

function normalise(
  scored: ReadonlyArray<{ id: string; score: number }>,
): Array<{ id: string; score: number }> {
  if (scored.length === 0) return [];
  const max = Math.max(...scored.map((s) => s.score));
  const min = Math.min(...scored.map((s) => s.score));
  const range = max - min;
  if (range <= 0) return scored.map((s) => ({ id: s.id, score: s.score === 0 ? 0 : 1 }));
  return scored.map((s) => ({ id: s.id, score: (s.score - min) / range }));
}
