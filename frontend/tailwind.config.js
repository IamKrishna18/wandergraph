/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#08111F',
        river: { DEFAULT: '#0F1D33', 2: '#162A47', 3: '#1E3659' },
        sand: { DEFAULT: '#F1E6CC', dim: '#D3C7AB', faint: '#A89E88' },
        ember: '#D2381E',
        saffron: '#F5A623',
        jal: { DEFAULT: '#23A5A0', deep: '#16706D' },
        accent: 'rgb(var(--accent) / <alpha-value>)',
        accent2: 'rgb(var(--accent-2) / <alpha-value>)',
      },
      fontFamily: {
        display: ['"Rozha One"', 'Georgia', 'serif'],
        body: ['"Hind Guntur"', 'system-ui', 'sans-serif'],
        native: ['"Noto Sans Kannada"', '"Noto Serif JP"', '"Hind Guntur"', 'serif'],
      },
      borderRadius: { blob: '28px 10px 28px 10px' },
      keyframes: {
        rise: { from: { opacity: '0', transform: 'translateY(24px)' }, to: { opacity: '1', transform: 'none' } },
        rays: { from: { transform: 'rotate(-12deg) scale(.85)', opacity: '0' }, to: { transform: 'rotate(0) scale(1)', opacity: '1' } },
        shimmer: { '0%': { backgroundPosition: '-400px 0' }, '100%': { backgroundPosition: '400px 0' } },
      },
      animation: {
        rise: 'rise .9s cubic-bezier(.2,.8,.2,1) both',
        rays: 'rays 1.4s cubic-bezier(.2,.8,.2,1) both',
        shimmer: 'shimmer 1.4s linear infinite',
      },
    },
  },
  plugins: [],
};
