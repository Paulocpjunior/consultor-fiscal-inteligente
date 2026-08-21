// Shim do @breezystack/lamejs PARA O JEST — o `main` do pacote é um IIFE
// (`var lamejs = ...`) que não exporta nada via require; o build ESM (que o
// Vite usa no navegador) o jest não transforma. Aqui o IIFE é avaliado e a
// var interna vira o module.exports — o ENCODER que roda no teste é o REAL,
// não um mock (o teste confere frame sync de MP3 de verdade).
//
// ⚠️ O caminho é montado à mão DE PROPÓSITO: `require.resolve('@breezystack/
// lamejs')` passaria pelo moduleNameMapper e voltaria PRA ESTE shim — o
// arquivo se avaliaria a si mesmo em recursão.
const fs = require('fs');
const path = require('path');
const arquivo = path.join(__dirname, '..', '..', 'node_modules', '@breezystack', 'lamejs', 'dist', 'lamejs.iife.js');
const src = fs.readFileSync(arquivo, 'utf8');
// eslint-disable-next-line no-new-func
module.exports = new Function(`${src}; return lamejs;`)();
