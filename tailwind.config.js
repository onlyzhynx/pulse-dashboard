/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        mono: ['"Share Tech Mono"', 'Courier New', 'monospace'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        cyber: {
          bg: '#000000',
          card: '#0a0a0a',
          border: 'rgba(255,255,255,0.6)',
          text: '#ffffff',
          muted: '#666666',
          dim: '#333333',
        },
        clean: {
          bg: '#111111',
          card: '#1a1a1a',
          border: 'rgba(255,255,255,0.08)',
          text: '#f0f0f0',
          muted: '#777777',
          dim: '#2a2a2a',
        }
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'flicker': 'flicker 0.15s infinite',
        'scan': 'scan 8s linear infinite',
      },
      keyframes: {
        flicker: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.8' },
        },
        scan: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100vh)' },
        }
      }
    },
  },
  plugins: [],
}
