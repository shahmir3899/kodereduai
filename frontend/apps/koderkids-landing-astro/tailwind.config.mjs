/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,ts,tsx,svelte}'],
  theme: {
    extend: {
      colors: {
        brand: {
          blue: '#2B6AFF',
          dark: '#0B0F19',
          gray: '#5A6270',
          light: '#F6F8FC',
          white: '#FFFFFF',
        },
        primary: {
          DEFAULT: '#2B6AFF',
          foreground: '#FFFFFF',
          50: '#E8F0FF',
          100: '#D1E1FF',
          200: '#A3C3FF',
          300: '#75A5FF',
          400: '#4787FF',
          500: '#2B6AFF',
          600: '#1A52D8',
          700: '#123DAA',
          800: '#0C2977',
          900: '#061544',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Space Grotesk', 'Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        '2xl': '1.5rem',
        '3xl': '1.75rem',
      },
      boxShadow: {
        dashboard: '0 28px 80px rgba(11, 15, 25, 0.14)',
        card: '0 4px 24px rgba(11, 15, 25, 0.08)',
        hover: '0 8px 40px rgba(11, 15, 25, 0.12)',
      },
    },
  },
  plugins: [],
};
