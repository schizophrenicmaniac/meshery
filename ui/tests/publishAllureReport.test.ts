import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import * as yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';

/**
 * `publish-allure-report` in build-and-test.yml is what puts master's E2E
 * results on qa.meshery.io. Its `if:` used to carry no status function, so
 * GitHub put an implicit `success()` in front of it and skipped the job on
 * every failing suite - the one run whose report somebody actually needs.
 *
 * As in playwrightWorkers.test.ts, this asserts what the condition resolves to
 * rather than how it is spelled: it reads the real workflow, evaluates the
 * job's `if:` against the runs that matter, and checks which of them publish.
 */

// vitest runs from `ui/` for `npm test` and from the repository root otherwise;
// `import.meta.url` is no help under jsdom (see huskyCommitMsgHook.test.ts).
const ROOT = [path.resolve(process.cwd(), '..'), process.cwd()].find((candidate) =>
  existsSync(path.join(candidate, '.github/workflows/build-and-test.yml')),
) as string;

const load = (file: string): any => yaml.load(readFileSync(path.join(ROOT, file), 'utf8'));

type Need = { result: string; outputs: Record<string, string> };
type Run = {
  cancelled: boolean;
  github: { event_name: string; ref: string };
  needs: Record<string, Need>;
};

/**
 * Enough of the GitHub Actions expression language for a job condition:
 * string literals, context paths, the status functions, `!`, `==`, `!=`, `&&`,
 * `||` and parentheses. Anything else throws, so a condition that outgrows
 * this fails the test instead of being half-evaluated.
 */
function evaluate(condition: string, run: Run): boolean {
  const source = condition.replace(/^\s*\$\{\{([\s\S]*)\}\}\s*$/, '$1').trim();
  const pattern = /\s*('[^']*'|&&|\|\||[!=]=|[!()]|[A-Za-z_][\w.-]*)/y;
  const tokens: string[] = [];
  while (pattern.lastIndex < source.length) {
    const start = pattern.lastIndex;
    const match = pattern.exec(source);
    if (!match) throw new Error(`Unsupported expression syntax: ${source.slice(start)}`);
    tokens.push(match[1] as string);
  }

  const results = Object.values(run.needs).map((need) => need.result);
  const status: Record<string, boolean> = {
    always: true,
    cancelled: run.cancelled,
    failure: results.includes('failure'),
    success: !run.cancelled && results.every((result) => result === 'success'),
  };
  let hasStatusCheck = false;

  let at = 0;
  const take = (expected?: string) => {
    const token = tokens[at++];
    if (token === undefined || (expected !== undefined && token !== expected)) {
      throw new Error(`Expected ${expected ?? 'an operand'} at token ${at - 1} of: ${source}`);
    }
    return token;
  };
  const operand = (): unknown => {
    const token = take();
    if (token === '!') return !operand();
    if (token === '(') {
      const value = or();
      take(')');
      return value;
    }
    if (token.startsWith("'")) return token.slice(1, -1);
    if (tokens[at] === '(') {
      take('(');
      take(')');
      if (!(token in status)) throw new Error(`Unsupported function: ${token}()`);
      hasStatusCheck = true;
      return status[token];
    }
    const value = token.split('.').reduce<any>((object, key) => object?.[key], run);
    if (value === undefined) throw new Error(`The run under test does not model ${token}`);
    return value;
  };
  const comparison = (): unknown => {
    const left = operand();
    if (tokens[at] !== '==' && tokens[at] !== '!=') return left;
    const negated = take() === '!=';
    return (left === operand()) !== negated;
  };
  const and = (): unknown => {
    let value = comparison();
    while (tokens[at] === '&&') {
      take();
      const right = comparison();
      value = value && right;
    }
    return value;
  };
  const or = (): unknown => {
    let value = and();
    while (tokens[at] === '||') {
      take();
      const right = and();
      value = value || right;
    }
    return value;
  };

  const value = or();
  if (at !== tokens.length) throw new Error(`Unexpected ${tokens[at]} in: ${source}`);
  // GitHub only drops the implicit success() when the condition names a status function.
  return Boolean(value) && (hasStatusCheck || status.success);
}

const masterPush = (
  overrides: { cancelled?: boolean; build?: string; e2e?: Partial<Need> } = {},
) => ({
  cancelled: overrides.cancelled ?? false,
  github: { event_name: 'push', ref: 'refs/heads/master' },
  needs: {
    'build-meshery': { result: overrides.build ?? 'success', outputs: {} },
    'tests-e2e': {
      result: 'success',
      outputs: { 'allure-results-artifact-id': '4242' },
      ...overrides.e2e,
    },
  },
});

const publishes = (run: Run) =>
  evaluate(load('.github/workflows/build-and-test.yml').jobs['publish-allure-report'].if, run);

describe('publish-allure-report condition', () => {
  it('publishes a master push whose E2E suite passed', () => {
    expect(publishes(masterPush())).toBe(true);
  });

  it('publishes a master push whose E2E suite failed', () => {
    expect(publishes(masterPush({ e2e: { result: 'failure' } }))).toBe(true);
  });

  it('skips a failed E2E job that uploaded no Allure results', () => {
    const run = masterPush({
      e2e: { result: 'failure', outputs: { 'allure-results-artifact-id': '' } },
    });

    expect(publishes(run)).toBe(false);
  });

  it('skips a cancelled run', () => {
    expect(publishes(masterPush({ cancelled: true, e2e: { result: 'cancelled' } }))).toBe(false);
  });

  it('skips a run whose image build failed', () => {
    const run = masterPush({
      build: 'failure',
      e2e: { result: 'skipped', outputs: { 'allure-results-artifact-id': '' } },
    });

    expect(publishes(run)).toBe(false);
  });

  it('skips pull requests', () => {
    const run = masterPush();
    run.github = { event_name: 'pull_request', ref: 'refs/pull/1/merge' };

    expect(publishes(run)).toBe(false);
  });

  // The condition keys on this id being non-empty, so a break anywhere along
  // the chain would not fail a build - it would quietly stop every publish.
  it('receives the Allure upload artifact id from test-e2e.yml', () => {
    const action = load('.github/actions/upload-test-artifacts/action.yml');
    const upload = action.runs.steps.find((step: any) => step.name === 'Upload Allure Results');
    expect(action.outputs['allure-results-artifact-id'].value).toBe(
      `\${{ steps.${upload.id}.outputs.artifact-id }}`,
    );

    const e2e = load('.github/workflows/test-e2e.yml');
    const job = e2e.jobs['test-e2e'];
    const step = job.steps.find((s: any) => s.uses === './.github/actions/upload-test-artifacts');
    expect(job.outputs['allure-results-artifact-id']).toBe(
      `\${{ steps.${step.id}.outputs.allure-results-artifact-id }}`,
    );
    expect(e2e.on.workflow_call.outputs['allure-results-artifact-id'].value).toBe(
      '${{ jobs.test-e2e.outputs.allure-results-artifact-id }}',
    );
  });
});
