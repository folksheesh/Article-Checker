/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#07121f',
          900: '#0b1f33',
          800: '#14324d',
          700: '#1e4666',
          100: '#e8eef4',
          50: '#f3f6f9',
        },
        seal: {
          700: '#8b1e2d',
          600: '#a32638',
          100: '#f8e8eb',
          50: '#fdf5f6',
        },
      },
      fontFamily: {
        display: ['"Newsreader"', 'Georgia', 'serif'],
        sans: ['"Source Sans 3"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        panel: '0 1px 2px rgba(11, 31, 51, 0.04), 0 8px 24px rgba(11, 31, 51, 0.06)',
      },
    },
  },
  plugins: [],
}
