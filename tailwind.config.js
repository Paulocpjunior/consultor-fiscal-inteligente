/** @type {import('tailwindcss').Config} */
export default {
  // darkMode 'class' — mantém o comportamento do CDN (classe 'dark' no <html>)
  darkMode: 'class',
  // content: TODOS os arquivos com className. Critico — arquivo de fora = classe purgada.
  content: [
    './index.html',
    './App.tsx',
    './index.tsx',
    './components/**/*.{ts,tsx,js,jsx}',
    './src/**/*.{ts,tsx,js,jsx}',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
