/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans CJK SC', 'system-ui', 'sans-serif'],
        display: ['Avenir Next', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'sans-serif'],
        mono: ['JetBrains Mono', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      colors: {
        brand: {
          blue: '#5f837a',
          gold: '#c89445',
        },
        accent: {
          primary: '#5f837a',
          strong: '#78a69a',
          premium: '#c89445',
        },
        surface: {
          0: '#11110f',
          1: '#191917',
          2: '#24231f',
          3: '#2f2d27',
          paper: '#f2eee4',
        },
      },
      boxShadow: {
        panel: '0 14px 36px rgba(0,0,0,0.18)',
        soft: '0 20px 48px rgba(0,0,0,0.22)',
      },
      borderRadius: {
        panel: '0.75rem',
      },
    },
  },
  plugins: [],
}
