import { ErrorCategory } from './types.js';

export class ErrorAnalyzer {
  static analyze(error: unknown): ErrorCategory {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

    if (message.includes('rate limit') || message.includes('429') || message.includes('too many requests')) {
      return 'rate_limit';
    }

    if (
      message.includes('context length') ||
      message.includes('token limit') ||
      message.includes('context_length_exceeded') ||
      message.includes('maximum context length')
    ) {
      return 'context_overflow';
    }

    if (
      message.includes('invalid response') ||
      message.includes('failed to parse') ||
      message.includes('unexpected token') ||
      message.includes('json')
    ) {
      return 'invalid_response';
    }

    if (message.includes('timeout') || message.includes('deadline') || message.includes('timed out')) {
      return 'timeout';
    }

    if (
      message.includes('api error') ||
      message.includes('internal server error') ||
      message.includes('500') ||
      message.includes('502') ||
      message.includes('503') ||
      message.includes('bad gateway')
    ) {
      return 'api_error';
    }

    return 'unknown';
  }
}
