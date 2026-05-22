/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#00D4E8',  // cyan Inunda
        accent:  '#008A99',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        'mono-inunda': ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};
