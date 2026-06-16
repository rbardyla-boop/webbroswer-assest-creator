export default {
  appType: 'spa',
  build: {
    target: 'baseline-widely-available',
    sourcemap: true,
    rollupOptions: {
      input: 'index.html'
    }
  }
};
