/**
 * tabelas-cst-entrada.js — só as LISTAS (Guia Prático EFD-Contribuições 1.35):
 * Tabela 4.3.4 (CST de aquisição) e Tabela 4.3.7 (natureza da base do crédito).
 *
 * Módulo sem importações, de propósito: `ncm-parametros.js` (valida o cadastro)
 * e `cst-pis-cofins-entrada.js` (decide a CST) leem daqui, e um não precisa
 * importar o outro na avaliação do módulo.
 */
export const CST_ENTRADA_COM_CREDITO = Object.freeze(['50', '51', '52', '53', '54', '55', '56']);
export const CST_ENTRADA_PRESUMIDO = Object.freeze(['60', '61', '62', '63', '64', '65', '66']);
export const CST_ENTRADA_SEM_CREDITO = Object.freeze(['70', '71', '72', '73', '74', '75', '98', '99']);
export const CST_ENTRADA_VALIDOS = Object.freeze([...CST_ENTRADA_COM_CREDITO, ...CST_ENTRADA_PRESUMIDO, ...CST_ENTRADA_SEM_CREDITO]);
export const CODIGOS_NAT_BC_CRED = Object.freeze(['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18']);
