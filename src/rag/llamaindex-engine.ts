/**
 * LlamaIndex-backed RAG engine (https://github.com/run-llama/LlamaIndexTS).
 *
 * We load `llamaindex` dynamically so the build doesn't require the
 * dependency to be installed. Tests inject a tiny in-memory fake through
 * the `moduleLoader` override and never pull the real package.
 *
 * The engine exposes three operations:
 *   - `indexDocuments`: chunk + embed documents into a named index.
 *   - `query`: retrieve the top-K most relevant chunks for a question.
 *   - `answer`: same as `query` but returns a synthesised answer string.
 */

export interface RagDocument {
  readonly id: string;
  readonly text: string;
  readonly metadata?: Record<string, unknown>;
}

export interface RagRetrievedChunk {
  readonly id: string;
  readonly text: string;
  readonly score: number;
  readonly metadata?: Record<string, unknown>;
}

export interface RagQueryResponse {
  readonly ok: boolean;
  readonly chunks: RagRetrievedChunk[];
  readonly answer?: string;
  readonly error?: string;
}

export interface RagIndexResponse {
  readonly ok: boolean;
  readonly indexed: number;
  readonly error?: string;
}

export interface LlamaIndexDocumentLike {
  id_?: string;
  text: string;
  metadata?: Record<string, unknown>;
}

export interface LlamaIndexRetrieverLike {
  retrieve(query: string): Promise<Array<{ node: { id_?: string; getText?: () => string; metadata?: Record<string, unknown> }; score?: number }>>;
}

export interface LlamaIndexQueryEngineLike {
  query(args: { query: string }): Promise<{ response?: string; toString?: () => string } | string>;
}

export interface LlamaIndexInstanceLike {
  asRetriever(args?: { similarityTopK?: number }): LlamaIndexRetrieverLike;
  asQueryEngine(): LlamaIndexQueryEngineLike;
}

export interface LlamaIndexModuleLike {
  Document: new (init: LlamaIndexDocumentLike) => LlamaIndexDocumentLike;
  VectorStoreIndex: {
    fromDocuments(documents: LlamaIndexDocumentLike[]): Promise<LlamaIndexInstanceLike>;
  };
}

export interface LlamaIndexEngineOptions {
  readonly moduleLoader?: () => Promise<LlamaIndexModuleLike>;
  readonly topK?: number;
}

export class LlamaIndexEngine {
  private readonly moduleLoader: () => Promise<LlamaIndexModuleLike>;
  private readonly topK: number;
  private readonly indices = new Map<string, LlamaIndexInstanceLike>();

  constructor(options: LlamaIndexEngineOptions = {}) {
    this.moduleLoader =
      options.moduleLoader ??
      (async () => {
        const spec = 'llamaindex';
        return (await import(spec)) as unknown as LlamaIndexModuleLike;
      });
    this.topK = options.topK ?? 5;
  }

  async indexDocuments(name: string, documents: readonly RagDocument[]): Promise<RagIndexResponse> {
    if (!name) return { ok: false, indexed: 0, error: 'index name is required' };
    if (documents.length === 0) return { ok: true, indexed: 0 };
    try {
      const mod = await this.moduleLoader();
      const nodes = documents.map(
        (doc) => new mod.Document({ id_: doc.id, text: doc.text, metadata: doc.metadata }),
      );
      const index = await mod.VectorStoreIndex.fromDocuments(nodes);
      this.indices.set(name, index);
      return { ok: true, indexed: documents.length };
    } catch (err) {
      return { ok: false, indexed: 0, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async query(name: string, question: string, topK?: number): Promise<RagQueryResponse> {
    const index = this.indices.get(name);
    if (!index) return { ok: false, chunks: [], error: `index "${name}" does not exist (call indexDocuments first)` };
    try {
      const retriever = index.asRetriever({ similarityTopK: topK ?? this.topK });
      const raw = await retriever.retrieve(question);
      const chunks = raw.map(parseRetrievedNode);
      return { ok: true, chunks };
    } catch (err) {
      return { ok: false, chunks: [], error: err instanceof Error ? err.message : String(err) };
    }
  }

  async answer(name: string, question: string): Promise<RagQueryResponse> {
    const index = this.indices.get(name);
    if (!index) return { ok: false, chunks: [], error: `index "${name}" does not exist (call indexDocuments first)` };
    try {
      const engine = index.asQueryEngine();
      const retriever = index.asRetriever({ similarityTopK: this.topK });
      const [rawAnswer, rawChunks] = await Promise.all([
        engine.query({ query: question }),
        retriever.retrieve(question),
      ]);
      return {
        ok: true,
        chunks: rawChunks.map(parseRetrievedNode),
        answer: stringifyAnswer(rawAnswer),
      };
    } catch (err) {
      return { ok: false, chunks: [], error: err instanceof Error ? err.message : String(err) };
    }
  }
}

export function parseRetrievedNode(raw: {
  node: { id_?: string; getText?: () => string; metadata?: Record<string, unknown> };
  score?: number;
}): RagRetrievedChunk {
  const node = raw.node ?? {};
  const id = typeof node.id_ === 'string' ? node.id_ : 'unknown';
  const text = typeof node.getText === 'function' ? node.getText() : '';
  return {
    id,
    text,
    score: typeof raw.score === 'number' ? raw.score : 0,
    metadata: node.metadata,
  };
}

function stringifyAnswer(raw: { response?: string; toString?: () => string } | string): string {
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw.response === 'string') return raw.response;
  if (raw && typeof raw.toString === 'function') {
    const s = raw.toString();
    return s === '[object Object]' ? '' : s;
  }
  return '';
}
