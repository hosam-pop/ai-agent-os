#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { bootstrap } from '../setup.js';
import { listFeatures } from '../config/feature-flags.js';
import { snapshotTrace } from '../utils/debug.js';
import { logger } from '../utils/logger.js';
import { activateBuddy, buddyCard } from '../features/buddy.js';
import { ultraplan } from '../features/ultraplan.js';
import { consolidate } from '../features/kairos.js';
import { buildProvider, resolveDefaultModel } from '../api/provider-factory.js';
import { LongTermMemory } from '../memory/long-term.js';

/**
 * CLI surface.
 *
 * Commands:
 *   run <goal>       — run the main agent loop on a goal
 *   plan <goal>      — decompose and run as an orchestrated DAG
 *   inspect          — print tools, features, last trace
 *   list             — list long-term memories
 *   debug <goal>     — run with verbose tracing
 *   features         — show feature gate status
 *   ultraplan <goal> — heavy planning (DOGE_FEATURE_ULTRAPLAN=true)
 *   buddy <id>       — roll the deterministic buddy (DOGE_FEATURE_BUDDY=true)
 *   kairos:consolidate — run the KAIROS consolidation pipeline once
 *   tui <goal>       — interactive Ink TUI
 */

const program = new Command();

program
  .name('ai-agent-os')
  .description('Unified autonomous agent runtime (ai-agent-os)')
  .version('1.0.0');

program
  .command('run')
  .description('Run the main agent loop on a goal')
  .argument('<goal...>', 'the goal to execute')
  .action(async (goalParts: string[]) => {
    const goal = goalParts.join(' ');
    const rt = await bootstrap();
    const result = await rt.agent.run(goal);
    console.log(chalk.green('\n=== Agent final output ==='));
    console.log(result.finalText);
    console.log(chalk.gray(`\n(${result.iterations} iterations, in=${result.usage.inputTokens} out=${result.usage.outputTokens})`));
  });

program
  .command('plan')
  .description('Decompose a goal and run it as an orchestrated DAG')
  .argument('<goal...>', 'the goal to decompose')
  .action(async (goalParts: string[]) => {
    const goal = goalParts.join(' ');
    const rt = await bootstrap();
    const result = await rt.orchestrator.run(goal);
    console.log(chalk.green('\n=== Orchestration result ==='));
    console.log(result.finalSummary);
    for (const r of result.subtaskResults) {
      console.log(chalk.cyan(`\n[${r.id}] ${r.title}  ${r.success ? 'ok' : 'FAILED'}`));
      console.log(r.output);
    }
  });

program
  .command('inspect')
  .description('Print tools, features, and latest trace')
  .action(async () => {
    const rt = await bootstrap();
    console.log(chalk.cyan('tools:'));
    for (const t of rt.tools.list()) console.log(`  - ${t.name}${t.dangerous ? ' (dangerous)' : ''} — ${t.description}`);
    console.log(chalk.cyan('\nfeatures:'));
    for (const f of listFeatures()) console.log(`  - ${f.name}: ${f.enabled ? 'on' : 'off'}`);
    console.log(chalk.cyan('\nlast trace:'));
    for (const s of snapshotTrace()) {
      console.log(`  - ${s.name} ${s.durationMs ?? '?'}ms ${s.error ? 'err=' + s.error : ''}`);
    }
  });

program
  .command('list')
  .description('List stored long-term memory records')
  .option('-n, --limit <n>', 'how many records to show', '20')
  .action(async (opts: { limit: string }) => {
    const mem = new LongTermMemory();
    const records = mem.list(Number.parseInt(opts.limit, 10) || 20);
    if (records.length === 0) {
      console.log(chalk.gray('(no records)'));
      return;
    }
    for (const r of records) {
      console.log(`${chalk.yellow(r.id)}  ${chalk.dim(r.createdAt)}  ${r.title}`);
      console.log(`  tags: ${r.tags.join(', ') || '-'}`);
    }
  });

program
  .command('debug')
  .description('Run a goal with verbose tracing')
  .argument('<goal...>', 'the goal to execute')
  .action(async (goalParts: string[]) => {
    process.env.DOGE_LOG_LEVEL = 'debug';
    const rt = await bootstrap();
    const result = await rt.agent.run(goalParts.join(' '));
    console.log(chalk.green('\n=== Final ==='));
    console.log(result.finalText);
    console.log(chalk.cyan('\n=== Trace ==='));
    for (const s of snapshotTrace()) {
      console.log(`- ${s.name} ${s.durationMs ?? '?'}ms meta=${JSON.stringify(s.meta ?? {})}`);
    }
  });

program
  .command('features')
  .description('Show feature gate status')
  .action(() => {
    for (const f of listFeatures()) {
      console.log(`${f.name}: ${f.enabled ? chalk.green('on') : chalk.gray('off')}`);
    }
  });

program
  .command('ultraplan')
  .description('Run the ULTRAPLAN heavy planner (feature-gated)')
  .argument('<goal...>', 'goal to plan')
  .action(async (goalParts: string[]) => {
    const result = await ultraplan(buildProvider(), { goal: goalParts.join(' '), heavyModel: resolveDefaultModel() });
    if (!result) {
      console.log(chalk.yellow('ULTRAPLAN is disabled (set DOGE_FEATURE_ULTRAPLAN=true)'));
      return;
    }
    console.log(chalk.cyan('STRATEGY:'));
    console.log(result.strategy);
    console.log(chalk.cyan('\nMILESTONES:'));
    for (const m of result.milestones) console.log(`- ${m}`);
    console.log(chalk.cyan('\nRISKS:'));
    for (const r of result.risks) console.log(`- ${r}`);
    console.log(chalk.cyan('\nNEXT ACTION:'));
    console.log(result.nextAction);
  });

program
  .command('buddy')
  .description('Roll the deterministic virtual buddy for a user id (feature-gated)')
  .argument('<userId>', 'a stable identifier — email, UUID, anything')
  .action((userId: string) => {
    const b = activateBuddy(userId);
    if (!b) {
      console.log(chalk.yellow('BUDDY is disabled (set DOGE_FEATURE_BUDDY=true)'));
      return;
    }
    console.log(buddyCard(b));
  });

program
  .command('kairos:consolidate')
  .description('Run the KAIROS consolidation pipeline once (feature-gated)')
  .action(async () => {
    const mem = new LongTermMemory();
    const result = await consolidate(buildProvider(), resolveDefaultModel(), mem);
    if (!result.consolidated) {
      console.log(chalk.gray('nothing to consolidate (or gate is off)'));
    } else {
      console.log(chalk.green('consolidated'));
      console.log(result.summary);
    }
  });

program
  .command('tui')
  .description('Interactive TUI for a single goal')
  .argument('<goal...>', 'the goal to execute')
  .action(async (goalParts: string[]) => {
    const [{ render }, { AgentTUI }, { default: React }] = await Promise.all([
      import('ink'),
      import('./tui.js'),
      import('react'),
    ]);
    const rt = await bootstrap();
    const { waitUntilExit } = render(React.createElement(AgentTUI, { agent: rt.agent, goal: goalParts.join(' ') }));
    await waitUntilExit();
  });

program.exitOverride((err) => {
  if (err.code === 'commander.helpDisplayed') process.exit(0);
  if (err.code === 'commander.version') process.exit(0);
  if (err.exitCode !== 0) {
    logger.error('cli.error', { message: err.message });
  }
  process.exit(err.exitCode ?? 1);
});

program.parseAsync(process.argv).catch((err) => {
  logger.error('cli.uncaught', { message: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
