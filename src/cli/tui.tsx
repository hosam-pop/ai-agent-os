import React, { useEffect, useState } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import type { AgentLoop } from '../core/agent-loop.js';
import { hooks } from '../hooks/lifecycle-hooks.js';
import { listFeatures } from '../config/feature-flags.js';

/**
 * Interactive TUI built with Ink.
 *
 * Shows a running log of tool calls as the agent works on a goal, plus a
 * summary panel with final output. Mirrors the "interactive REPL" surface
 * from Claude-Code but stripped to the essentials.
 */

interface Props {
  agent: AgentLoop;
  goal: string;
}

interface LogLine {
  kind: 'tool' | 'status' | 'error' | 'final';
  text: string;
  ts: number;
}

export function AgentTUI({ agent, goal }: Props): React.ReactElement {
  const { exit } = useApp();
  const [lines, setLines] = useState<LogLine[]>([]);
  const [done, setDone] = useState(false);
  const [final, setFinal] = useState<string>('');
  const [iter, setIter] = useState(0);

  useEffect(() => {
    const offPre = hooks.on('preToolCall', (p) => {
      setLines((cur) => [
        ...cur,
        { kind: 'tool', text: `→ ${p.tool} ${truncate(JSON.stringify(p.args), 80)}`, ts: Date.now() },
      ]);
    });
    const offPost = hooks.on('postToolCall', (p) => {
      setLines((cur) => [
        ...cur,
        {
          kind: p.ok ? 'status' : 'error',
          text: `← ${p.tool} ${p.ok ? 'ok' : 'ERR'} ${truncate(p.output ?? p.error ?? '', 120)}`,
          ts: Date.now(),
        },
      ]);
    });
    const offPre2 = hooks.on('preTask', () => setIter(0));
    let cancelled = false;

    agent
      .run(goal)
      .then((r) => {
        if (cancelled) return;
        setFinal(r.finalText);
        setIter(r.iterations);
        setDone(true);
      })
      .catch((err) => {
        if (cancelled) return;
        setLines((cur) => [...cur, { kind: 'error', text: `Error: ${String(err)}`, ts: Date.now() }]);
        setDone(true);
      });

    return () => {
      cancelled = true;
      offPre();
      offPost();
      offPre2();
    };
  }, [agent, goal]);

  useInput((_input, key) => {
    if (done && (key.return || _input === 'q')) exit();
  });

  const features = listFeatures();

  return (
    <Box flexDirection="column">
      <Box borderStyle="round" paddingX={1} flexDirection="column">
        <Text color="cyan" bold>AI Agent OS</Text>
        <Text dimColor>
          features: {features.map((f) => `${f.name}=${f.enabled ? 'on' : 'off'}`).join('  ')}
        </Text>
        <Text>
          <Text color="yellow">goal:</Text> {goal}
        </Text>
      </Box>
      <Box flexDirection="column" paddingX={1}>
        {lines.slice(-40).map((l) => (
          <Text key={l.ts + l.text} color={colorFor(l.kind)}>
            {l.text}
          </Text>
        ))}
      </Box>
      {done ? (
        <Box borderStyle="round" paddingX={1} flexDirection="column" marginTop={1}>
          <Text color="green" bold>completed in {iter} iterations</Text>
          <Text>{final}</Text>
          <Text dimColor>press enter or q to exit</Text>
        </Box>
      ) : (
        <Text color="gray">working…</Text>
      )}
    </Box>
  );
}

function colorFor(kind: LogLine['kind']): string {
  switch (kind) {
    case 'tool':
      return 'cyan';
    case 'status':
      return 'green';
    case 'error':
      return 'red';
    case 'final':
      return 'white';
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}
