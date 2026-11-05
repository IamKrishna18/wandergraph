/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // neutral night base, one warm signal colour
        ink: '#09090B',
        river: { DEFAULT: '#111114', 2: '#18181C', 3: '#232329' },
        sand: { DEFAULT: '#EDEDEF', dim: '#A1A1AA', faint: '#80808A' },
        accent: '#FF6A3D',
        accent2: '#FFC2A8',
        jal: { DEFAULT: '#3DD68C', deep: '#1F8F5B' },
        saffron: '#F5B941',
        ember: '#FF5F57',
      },
      fontFamily: {
        display: ['"Geist Variable"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        body: ['"Geist Variable"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"Geist Mono Variable"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      keyframes: {
        rise: { from: { opacity: '0', transform: 'translateY(14px)' }, to: { opacity: '1', transform: 'none' } },
        shimmer: { '0%': { backgroundPosition: '-400px 0' }, '100%': { backgroundPosition: '400px 0' } },
        marquee: { from: { transform: 'translateX(0)' }, to: { transform: 'translateX(-50%)' } },
        blink: { '0%,100%': { opacity: '1' }, '50%': { opacity: '0' } },
        pulseDot: { '0%': { boxShadow: '0 0 0 0 rgba(61,214,140,.55)' }, '100%': { boxShadow: '0 0 0 8px rgba(61,214,140,0)' } },
        draw: { from: { strokeDashoffset: '1' }, to: { strokeDashoffset: '0' } },
        pop: { from: { opacity: '0', transform: 'scale(.6)' }, to: { opacity: '1', transform: 'scale(1)' } },
      },
      animation: {
        rise: 'rise .7s cubic-bezier(.2,.8,.2,1) both',
        shimmer: 'shimmer 1.4s linear infinite',
        marquee: 'marquee 48s linear infinite',
        blink: 'blink 1s steps(1) infinite',
        pulseDot: 'pulseDot 1.6s ease-out infinite',
        draw: 'draw .6s ease-out both',
        pop: 'pop .35s cubic-bezier(.2,.8,.2,1.2) both',
      },
    },
  },
  plugins: [],
};
