// Tiny first-party icon set; no HACS icon-pack dependency.
window.customIcons = window.customIcons || {};
window.customIcons.alfred = {
  getIcon: async () => ({
    viewBox: '0 0 128 128',
    path: 'M39 48c-5-26 46-35 50-7l-5 13-2-16c-12 6-27 2-35 8l-2 14zM46 50h7v15c0 10 5 17 11 17s11-7 11-17V50h7v15c0 14-8 24-18 24S46 79 46 65zM39 87l13 12 12 19H22v-12zM89 87l17 19v12H64l12-19zM49 91l12 6-12 7zM79 91l-12 6 12 7z',
  }),
  getIconList: async () => [{ name: 'butler', keywords: ['Alfred', 'assistant', 'butler'] }],
};
