/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx,js,jsx}'],
  theme: {
    extend: {
      colors: {
        'bc-black': '#050505',
        'bc-gold': '#facc15',
        'bc-gold-soft': '#fbbf24',
        'bc-card': '#facc15',
        'bc-editor': '#020617',
        'bc-table-header': '#111827',
        'bc-row-even': '#020617',
        'bc-row-odd': '#030712',
        'bc-red': '#f97373',
        'bc-black-soft': '#111827',
      },
      boxShadow: {
        'bc-gold': '0 0 45px rgba(250, 204, 21, 0.45)',
      },
      fontFamily: {
        display: ['"Anton"', 'system-ui', 'sans-serif'],
        sans: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
