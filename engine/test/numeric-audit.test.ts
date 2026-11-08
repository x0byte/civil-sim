import { readFileSync, readdirSync } from 'node:fs';
import ts from 'typescript';
import { expect, it } from 'vitest';

/** Exact expression + occurrence allow-list: even adding a familiar literal such
 * as 1.3 in a new context fails. Strings (citations, IDs, prose) are not numbers.
 * New physical/behavioural values belong in parameters.ts; mathematical changes
 * require reviewing and updating the documented exception, never a blanket regex.
 */
it('keeps all behavioural numbers in the registry, with explicit maths exceptions', () => {
  const root = new URL('../../', import.meta.url);
  const files = (directory: string): string[] => readdirSync(new URL(directory, root), { withFileTypes: true })
    .flatMap(entry => entry.isDirectory() ? files(`${directory}/${entry.name}`) : entry.name.endsWith('.ts') ? [`${directory}/${entry.name}`] : []);
  const actual: Record<string, { expressions: Record<string, number> }> = {};
  for (const file of files('engine/src').filter(f => !f.endsWith('/parameters.ts')).sort()) {
    const source = readFileSync(new URL(file, root), 'utf8');
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const expressions: Record<string, number> = {};
    const visit = (node: ts.Node) => {
      if (ts.isNumericLiteral(node)) {
        const expression = node.parent.getText(tree).replace(/\s+/g, ' ');
        const key = `${node.getText(tree)} in ${expression}`;
        expressions[key] = (expressions[key] ?? 0) + 1;
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
    if (Object.keys(expressions).length) actual[file] = { expressions };
  }
  const approved = JSON.parse(readFileSync(new URL('data/numeric-allowlist.json', import.meta.url), 'utf8')) as Record<string, { reason: string; expressions: Record<string, number> }>;
  for (const entry of Object.values(approved)) expect(entry.reason.trim()).not.toBe('');
  expect(actual).toEqual(Object.fromEntries(Object.entries(approved).map(([file, { expressions }]) => [file, { expressions }])));
});
