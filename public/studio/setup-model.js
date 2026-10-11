/** Configuration readiness is not a claim of remote reachability or delivery. */
export function setupReadiness(state) {
  const c = state.settings || {};
  const speech = state.connections?.speech;
  return [
    {
      id: 'server',
      title: 'Home Assistant',
      state: 'Connected',
      detail: 'This administrator session reached Alfred.',
      view: 'devices',
      ready: true,
    },
    {
      id: 'https',
      title: 'Private HTTPS',
      state: c.publicOrigin ? 'Configured' : 'Not configured',
      detail: c.publicOrigin
        ? 'Check this address from iPhone on cellular.'
        : 'Add a private HTTPS address reachable by your iPhone.',
      view: 'devices',
      ready: !!c.publicOrigin,
    },
    {
      id: 'speech',
      title: 'Speech recognition',
      state: speech?.configured ? 'Configured' : 'Not configured',
      detail: speech?.message || 'Choose a speech recogniser. General AI is optional.',
      view: 'connections',
      ready: !!speech?.configured,
    },
    {
      id: 'package',
      title: 'Even package',
      state: 'Check on iPhone',
      detail:
        'Build for your HTTPS address, upload in your own Hub app, and install the test/beta build.',
      view: 'help',
      ready: false,
      manual: true,
    },
    {
      id: 'paired',
      title: 'Phone pairing',
      state: c.pairedDevices?.length ? 'Paired' : 'Not paired',
      detail: c.pairedDevices?.length
        ? 'A credential is registered. Verify a request on your glasses.'
        : 'Create a code and enter it in the installed Alfred app.',
      view: 'devices',
      ready: !!c.pairedDevices?.length,
    },
  ];
}
export function featureGroups(state) {
  const c = state.settings || {},
    x = state.experiences || {};
  const account = ['google', 'outlook'].filter((p) => c[p]?.connected);
  const listCount = Object.values(c.haLists || {}).filter(Boolean).length;
  const paired = c.pairedDevices?.length || 0;
  const row = (id, title, summary, configured = true) => ({
    id,
    title,
    summary,
    state: configured ? 'Configured' : 'Not configured',
  });
  return [
    {
      title: 'Connections',
      items: [
        row(
          'connections',
          'Intelligence & accounts',
          `${state.connections?.speech?.configured ? 'Speech configured' : 'Choose speech'} · ${state.features?.some((f) => f.id === 'conversation' && f.configured) ? { openai: 'OpenAI', claude: 'Claude', ollama: 'Ollama' }[c.replyProvider] || 'AI configured' : 'AI optional'} · ${account.length ? account.map((p) => (p === 'google' ? 'Google' : 'Outlook')).join(' + ') : 'Mail optional'}`,
          !!state.connections?.speech?.configured,
        ),
        row(
          'devices',
          'Glasses & access',
          `${paired} paired device${paired === 1 ? '' : 's'} · ${c.publicOrigin ? 'HTTPS configured' : 'Add HTTPS address'}`,
          !!c.publicOrigin && paired > 0,
        ),
      ],
    },
    {
      title: 'Everyday',
      items: [
        row(
          'home',
          'Connected home',
          `${(c.homeEntities || []).length} permitted devices`,
          !!c.homeEntities?.length,
        ),
        row(
          'lists',
          'Lists & reminders',
          `${listCount} selected lists · ${state.reminders?.phone ? 'iPhone push selected' : 'Inbox reminders'}`,
          listCount > 0,
        ),
        row(
          'routines',
          'Routines & scenes',
          `${x.routines?.length || 0} routines · ${x.schedules?.length || 0} schedules`,
          !!x.routines?.length,
        ),
        row(
          'news',
          'News sources',
          `${c.newsSources?.length || 0} source${c.newsSources?.length === 1 ? '' : 's'} · ${c.newsDigest?.enabled ? 'Digest enabled' : 'On request'}`,
          !!c.newsSources?.length,
        ),
        row(
          'briefings',
          'Briefings',
          c.proactive?.briefing ? 'Daily briefing enabled' : 'On request',
        ),
      ],
    },
    {
      title: 'Personalisation',
      items: [
        row(
          'profile',
          'Profile & behaviour',
          `${c.profile?.addressAs && c.profile.addressAs !== 'none' ? 'Personal address enabled' : 'Neutral address'} · ${c.weatherCity ? 'Weather set' : 'Weather optional'}`,
        ),
        row('memory', 'Personal memory', `${x.memories?.length || 0} saved preferences`),
      ],
    },
  ];
}

/** Speech/search credentials are independent of the selected conversation provider. */
export function providerVisibility(c) {
  return {
    openaiKey: [c.replyProvider, c.transcriptionProvider, c.webSearchProvider].includes('openai'),
    speechModel: ['openai', 'local'].includes(c.transcriptionProvider),
    haSpeech: c.transcriptionProvider === 'ha',
    localSpeech: c.transcriptionProvider === 'local',
  };
}
