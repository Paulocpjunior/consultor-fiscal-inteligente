/**
 * validadorDocumento — PORTA do núcleo, não a régua.
 *
 * O algoritmo do DV mora em `sefaz-backend/documento-dv.js`, e a razão é o
 * caso do `cpfTitular` do produtor rural: enquanto ele vivia só aqui (TypeScript,
 * frontend), o BACKEND — que é quem grava no banco e monta o R-2055 — só sabia
 * conferir COMPRIMENTO. Um dígito trocado passava, e o evento saía declarando
 * em nome de outra pessoa. Declaração ao Reinf não se desfaz.
 *
 * Este arquivo continua existindo porque as telas importam daqui há tempo, e
 * porque `import` de `.js` no meio de componente TSX é ruído. Mas ele NÃO pode
 * voltar a ter cálculo próprio: duas cópias do DV divergem em silêncio, e a
 * divergência só apareceria numa declaração já entregue.
 *
 * CNPJ alfanumérico (IN RFB 2.229/2024, vigência 07/2026) é tratado no núcleo.
 */
export {
    limparCnpj,
    limparCpf,
    validarCnpj,
    validarCpf,
    formatarCnpj,
    formatarCpf,
} from '../sefaz-backend/documento-dv.js';
