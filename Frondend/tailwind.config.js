export default {content: [
  './index.html',
  './src/**/*.{js,ts,jsx,tsx}'
],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Be Vietnam Pro"', 'system-ui', 'sans-serif'],
      },
      colors: {
        canvas: '#F6F3EC',
        surface: '#FFFFFF',
        ink: '#1C2B22',
        muted: '#5F6B63',
        line: '#E3DED2',
        brand: {
          DEFAULT: '#1F5136',
          strong: '#163C28',
          soft: '#E4EDE6',
        },
        accent: {
          DEFAULT: '#C4521F',
          soft: '#F8E6DA',
        },
        protein: '#C0512F',
        carbs: '#C98F12',
        fat: '#3F7CAC',
        fiber: '#4E8B5F',
      },
      transitionTimingFunction: {
        out: 'cubic-bezier(0.23, 1, 0.32, 1)',
      },
    },
  },
}
