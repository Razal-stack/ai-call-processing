// Thin wrapper over pino (structured JSON logs, child loggers, levels). The
// small interface keeps call sites decoupled from pino and easy to fake in tests.
// PII discipline: never pass raw transcript content — use redactTranscript().

import { createHash } from "node:crypto";
import { pino } from "pino";

type PinoLogger = ReturnType<typeof pino>;

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  /** Return a logger that includes `bindings` on every line it emits. */
  child(bindings: LogFields): Logger;
}

export interface LoggerOptions {
  level: LogLevel;
  /** Test hook: capture lines instead of writing to stdout. */
  sink?: (record: object) => void;
}

function wrap(p: PinoLogger): Logger {
  return {
    debug: (msg, fields) => p.debug(fields ?? {}, msg),
    info: (msg, fields) => p.info(fields ?? {}, msg),
    warn: (msg, fields) => p.warn(fields ?? {}, msg),
    error: (msg, fields) => p.error(fields ?? {}, msg),
    child: (bindings) => wrap(p.child(bindings)),
  };
}

/** Create the root logger. A `sink` (tests) captures records instead of stdout. */
export function createLogger(options: LoggerOptions): Logger {
  if (options.sink) {
    return wrap(
      pino({ level: options.level }, { write: (line) => options.sink?.(JSON.parse(line)) }),
    );
  }
  return wrap(pino({ level: options.level }));
}

/** PII-safe transcript descriptor: length + short hash, never the content. */
export function redactTranscript(transcript: string): {
  transcript_length: number;
  transcript_hash: string;
} {
  return {
    transcript_length: transcript.length,
    transcript_hash: createHash("sha256").update(transcript).digest("hex").slice(0, 12),
  };
}
