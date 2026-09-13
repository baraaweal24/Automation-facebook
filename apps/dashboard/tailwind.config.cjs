module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Tajawal', 'Segoe UI', 'sans-serif'] },
      colors: {
        ink: '#17231d',
        brand: { 50: '#eef8f2', 100: '#d8efe1', 500: '#2e8b57', 600: '#217247', 700: '#195c39' },
      },
    },
  },
  plugins: [],
};
