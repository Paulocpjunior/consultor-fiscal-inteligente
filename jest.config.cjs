// jest.config.cjs
//
// ts-jest transforma .ts/.tsx normalmente (tsconfig.json),
// e tambem .js — necessario pra testar modulos backend puros (.js ESM em
// sefaz-backend/*) sem dual-config babel. Para o .js a gente passa um
// tsconfig inline com allowJs:true e module:commonjs (o tsconfig.json
// principal mantém allowJs:false pra nao mudar build/typecheck do app).
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  moduleNameMapper: {
    '\\.(css|less|scss)$': 'identity-obj-proxy',
    // O main do lamejs é um IIFE sem exports; o shim avalia e expõe (o
    // encoder dos testes é o real — ver __tests__/shims/lamejs.cjs).
    '^@breezystack/lamejs$': '<rootDir>/__tests__/shims/lamejs.cjs',
    // ts-jest CJS resolve '../foo.js' como ESM e quebra. Mapeia o sufixo
    // .js explicito pro mesmo arquivo sem ele — ts-jest entao acha o .ts
    // OU transforma o .js via a regra de transform abaixo.
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  // Varreduras de fonte leem centenas de arquivos; 5s (default) já derrubou
  // suíte verde em runner lento. 30s é teto, não meta.
  testTimeout: 30000,
  // Metade dos núcleos: o gate do deploy roda `npx jest --ci` no runner
  // compartilhado e a suíte inteira com todos os workers estourava memória.
  maxWorkers: '50%',
  setupFilesAfterEnv: ['<rootDir>/__tests__/setupTests.ts'],
  testPathIgnorePatterns: ['<rootDir>/__tests__/setupTests.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: 'tsconfig.json',
      useESM: false,
    }],
    '^.+\\.jsx?$': ['ts-jest', {
      // Config inline pra .js (testes de modulos backend puros).
      tsconfig: {
        allowJs: true,
        esModuleInterop: true,
        target: 'ES2020',
        module: 'CommonJS',
        moduleResolution: 'node',
      },
      useESM: false,
    }],
  },
  transformIgnorePatterns: [
    'node_modules/(?!(lucide-react|motion)/)',
  ],
};
