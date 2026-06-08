/**
 * Folhamatic Fiscal — Layout de Importação v2.0.06
 * Gerado a partir do PDF oficial (216 páginas).
 *
 * Inclui os 8 registros mais usados em integração:
 *   E001, E010, E020, E200, E201, E221, E222, E342
 *
 * Tipos de campo:
 *   A — Alfabético (espaços à direita)
 *   X — Alfanumérico (espaços à direita)
 *   N — Numérico (zeros à esquerda)
 *   D — Data formato AAAAMMDD
 *
 * Encoding: ANSI (Windows-1252 / CP1252)
 * Terminador de linha: CRLF (0x0D 0x0A)
 * EOF: 0x1A (opcional)
 * Extensão do arquivo: .FML
 */

export type FieldType = 'A' | 'X' | 'N' | 'D';

export interface FieldSpec {
  ordem: number;
  nome: string;
  descricao: string;
  tipo: FieldType;
  tamanho: number;
  decimais: number | null;
  posicao_inicial: number;
  posicao_final: number;
  obrigatorio: boolean;
  valor_fixo: string | null;
  observacoes: string;
}

export interface RecordSpec {
  registro: string;
  descricao: string;
  obrigatorio: boolean;
  ocorrencia: string;
  descricao_geral: string;
  campos: FieldSpec[];
}

/**
 * Formata um valor para um campo de largura fixa de acordo com sua spec.
 */
export function formatField(value: unknown, spec: FieldSpec): string {
  if (spec.valor_fixo !== null) {
    value = spec.valor_fixo;
  }
  if (value === null || value === undefined) {
    if (spec.tipo === 'N') return '0'.repeat(spec.tamanho);
    return ' '.repeat(spec.tamanho);
  }

  let formatted: string;

  switch (spec.tipo) {
    case 'A':
    case 'X': {
      formatted = String(value)
        .substring(0, spec.tamanho)
        .padEnd(spec.tamanho, ' ');
      break;
    }
    case 'N': {
      let numeric: number;
      if (typeof value === 'number') {
        numeric = value;
      } else {
        const parsed = Number(String(value).replace(',', '.'));
        numeric = Number.isFinite(parsed) ? parsed : 0;
      }
      if (spec.decimais !== null && spec.decimais > 0) {
        const scaled = Math.round(numeric * Math.pow(10, spec.decimais));
        formatted = String(Math.abs(scaled)).padStart(spec.tamanho, '0');
      } else {
        formatted = String(Math.trunc(Math.abs(numeric))).padStart(spec.tamanho, '0');
      }
      if (formatted.length > spec.tamanho) {
        formatted = formatted.slice(-spec.tamanho);
      }
      break;
    }
    case 'D': {
      if (value instanceof Date) {
        const y = value.getFullYear().toString().padStart(4, '0');
        const m = (value.getMonth() + 1).toString().padStart(2, '0');
        const d = value.getDate().toString().padStart(2, '0');
        formatted = `${y}${m}${d}`;
      } else {
        const digits = String(value).replace(/\D/g, '');
        formatted = digits.length === 0
          ? ' '.repeat(8)
          : digits.substring(0, 8).padStart(8, '0');
      }
      break;
    }
    default:
      formatted = ' '.repeat(spec.tamanho);
  }

  return formatted;
}

/**
 * Monta uma linha completa de um registro a partir de um objeto com os valores.
 */
export function buildRecord(spec: RecordSpec, values: Record<string, unknown>): string {
  const normalized: Record<string, unknown> = {};
  for (const k of Object.keys(values)) {
    normalized[k.toUpperCase()] = values[k];
  }

  const parts: string[] = [];
  for (const campo of spec.campos) {
    const v = normalized[campo.nome.toUpperCase()];
    parts.push(formatField(v, campo));
  }

  const line = parts.join('');
  const expected = spec.campos[spec.campos.length - 1]?.posicao_final ?? 0;
  if (line.length !== expected) {
    throw new Error(
      `[Folhamatic] Linha ${spec.registro} com tamanho inválido: ` +
      `esperado=${expected}, obtido=${line.length}`,
    );
  }

  return line;
}

/**
 * Monta o conteúdo completo do arquivo .FML com terminador CRLF.
 */
export function buildFile(lines: string[], appendEOF = false): string {
  const CRLF = '\r\n';
  let out = lines.join(CRLF) + CRLF;
  if (appendEOF) out += '\x1A';
  return out;
}

export const LAYOUT_VERSION = '2.0.06';
