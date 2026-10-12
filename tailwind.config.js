/** @type {import('tailwindcss').Config} */

// Neutros da Apple (fundo #f5f5f7, texto #1c1c1e, preto puro no tema escuro).
const NEUTROS = {
  50: '#fbfbfd',
  100: '#f5f5f7',
  200: '#e8e8ed',
  300: '#d2d2d7',
  400: '#a1a1a6',
  500: '#6e6e73',
  600: '#515154',
  700: '#3a3a3c',
  800: '#2c2c2e',
  900: '#1c1c1e',
  950: '#000000',
};

// Azul da Apple: 600 (#0071e3) é o botão; 500 (#0a84ff) é o destaque no tema escuro.
const AZUL = {
  50: '#f0f7ff',
  100: '#e0efff',
  200: '#b8dcff',
  300: '#84c1ff',
  400: '#47a1ff',
  500: '#0a84ff',
  600: '#0071e3',
  700: '#0066cc',
  800: '#00509f',
  900: '#003e7a',
  950: '#00264d',
};

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
  // Visual no estilo dos sistemas da Apple (12/10/2026, pedido do Paulo: "letra, tipografia, símbolos, logo"):
  //  - fonte do sistema primeiro (no Mac, iPhone e iPad é a San Francisco, que já está no aparelho; nada da Apple
  //    é distribuído pelo app), com a Inter embutida (@fontsource-variable/inter, importada no index.tsx) de reserva;
  //  - cinzas neutros e um só azul de destaque, nos tons da Apple; o azul 600 (#0071e3) dá 4,6:1 com texto branco
  //    (AA) e o 500/400 é o do tema escuro;
  //  - cantos um pouco mais arredondados.
  // As classes das telas não mudam: o tema redefine as paletas abaixo e a escala de cantos. O CFI usa `slate` e
  // também `gray` como neutros, e `sky` (mais que `blue`) como destaque — os três azuis viram o mesmo azul.
  theme: {
    extend: {
      fontFamily: {
        sans: [
          '-apple-system', 'BlinkMacSystemFont', "'SF Pro Text'", "'SF Pro Display'", "'Inter Variable'", 'Inter',
          "'Segoe UI'", 'Roboto', "'Helvetica Neue'", 'Arial', 'sans-serif',
        ],
        mono: ['ui-monospace', "'SF Mono'", 'SFMono-Regular', 'Menlo', 'Consolas', "'Liberation Mono'", 'monospace'],
      },
      colors: {
        slate: NEUTROS,
        gray: NEUTROS,
        blue: AZUL,
        indigo: AZUL,
        sky: AZUL,
      },
      borderRadius: {
        sm: '0.375rem',
        DEFAULT: '0.375rem',
        md: '0.5rem',
        lg: '0.625rem',
        xl: '0.875rem',
        '2xl': '1.25rem',
        '3xl': '1.75rem',
      },
    },
  },
  plugins: [],
}
