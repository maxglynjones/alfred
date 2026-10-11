import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Static public modules are framework independent.
import { setupReadiness, featureGroups } from '../public/studio/setup-model.js';
// @ts-ignore Guide renderer executes no browser/runtime side effects on import.
import { renderGuide, guideLink } from '../scripts/build-guides.mjs';

test('empty installations do not claim speech, remote access or pairing is configured', () => {
  const checks = setupReadiness({ settings: {} });
  assert.equal(checks.find((x: any) => x.id === 'speech').ready, false);
  assert.equal(checks.find((x: any) => x.id === 'https').ready, false);
  assert.equal(checks.find((x: any) => x.id === 'paired').ready, false);
  assert.equal(checks.find((x: any) => x.id === 'package').manual, true);
  assert.ok(checks.find((x: any) => x.id === 'speech').detail.includes('optional'));
});
test('saved settings are labelled configuration, never inferred live account health', () => {
  const state = {
    settings: {
      publicOrigin: 'https://example.test',
      pairedDevices: [{}],
      haLists: { shopping: 'todo.shopping' },
      google: { connected: true },
    },
    connections: { speech: { configured: true } },
    experiences: {},
  };
  assert.equal(setupReadiness(state).find((x: any) => x.id === 'speech').state, 'Configured');
  const rows = featureGroups(state).flatMap((x: any) => x.items);
  assert.match(rows.find((x: any) => x.id === 'lists').summary, /1 selected/);
  assert.match(rows.find((x: any) => x.id === 'connections').summary, /Google/);
  assert.ok(rows.every((x: any) => !['Online', 'Available'].includes(x.state)));
});
test('bundled guides escape HTML and unsafe links, preserve external markdown URLs', () => {
  const html = renderGuide(
    '# Setup\n\n<script>alert(1)</script> [bad](javascript:alert)\n\n[Docs](https://github.com/example/docs/README.md) [Next](EVEN.md)\n\n```sh\n<danger>\n```',
  );
  assert.doesNotMatch(html, /<script|href="javascript/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /href="https:\/\/github.com\/example\/docs\/README.md"/);
  assert.match(html, /href="EVEN.html"/);
  assert.match(html, /&lt;danger&gt;/);
});
test('embedded guide links retain source context and do not expose unknown paths', () => {
  const outputs = new Map([
    ['docs/setup/README.md', 'README.html'],
    ['docs/development/README.md', 'docs-development-README.html'],
    ['SECURITY.md', 'SECURITY.html'],
  ]);
  assert.equal(guideLink('docs/setup/EVEN.md', 'README.md', outputs), 'README.html');
  assert.equal(
    guideLink('docs/setup/EVEN.md', '../development/README.md', outputs),
    'docs-development-README.html',
  );
  assert.equal(guideLink('docs/setup/PRIVACY.md', '../../SECURITY.md', outputs), 'SECURITY.html');
  assert.equal(guideLink('docs/setup/EVEN.md', '../../../private.md', outputs), undefined);
  const html = renderGuide('[Unavailable](../../private.md)', (link: string) =>
    guideLink('docs/setup/EVEN.md', link, outputs),
  );
  assert.doesNotMatch(html, /href=/);
});
// @ts-ignore Static model shared by HA and isolated tests.
import { providerVisibility } from '../public/studio/setup-model.js';
test('speech-only or research-only OpenAI retains key access without a conversation model', () => {
  assert.equal(
    providerVisibility({
      replyProvider: 'none',
      transcriptionProvider: 'openai',
      webSearchProvider: 'none',
    }).openaiKey,
    true,
  );
  assert.equal(
    providerVisibility({
      replyProvider: 'claude',
      transcriptionProvider: 'ha',
      webSearchProvider: 'openai',
    }).openaiKey,
    true,
  );
  const local = providerVisibility({
    replyProvider: 'none',
    transcriptionProvider: 'ha',
    webSearchProvider: 'none',
  });
  assert.equal(local.openaiKey, false);
  assert.equal(local.haSpeech, true);
  assert.equal(local.speechModel, false);
});
import { activityRows } from '../src/companion';
test('companion activity is chronological and distinguishes provider acceptance from delivery', () => {
  const rows = activityRows({
    history: [{ question: 'Lights?', reply: 'Off', created_at: '2026-10-11T10:00:00Z' }],
    actions: [{ kind: 'email_result', status: 'accepted', created_at: '2026-10-11T11:00:00Z' }],
  });
  assert.equal(rows[0].kind, 'receipt');
  assert.equal(rows[0].detail, 'Accepted by the service');
  assert.equal(rows[1].title, 'Lights?');
});
