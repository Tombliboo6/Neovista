/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['DM Sans', 'system-ui', 'sans-serif'],
        display: ['Syne', 'sans-serif'],
      },
      colors: {
        brand: {
          blue: '#2563eb',
          gold: '#f59e0b',
        },
        surface: {
          0: '#0f1117',
          1: '#1a1f2e',
          2: '#242938',
        },
      },
      boxShadow: {
        'glow-blue': '0 0 20px rgba(37,99,235,0.3)',
        'glow-sm': '0 0 10px rgba(37,99,235,0.15)',
      },
    },
  },
  plugins: [],
}
