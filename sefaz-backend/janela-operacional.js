// ========================================================================================
// sefaz-backend/janela-operacional.js  (ESM)
// Janela operacional para captura SEFAZ MANUAL: seg-sex 07:00-20:00 BRT.
// =========================================================================================

const TZ = 'America/Sao_Paulo';
const HORA_INICIO = 7;
const HORA_FIM = 20;

export function statusJanelaOperacional(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
    weekday: 'short',
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map(p => [p.type, p.value]));
  const hora = parseInt(parts.hour, 10);
  const wdMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const diaSemana = wdMap[parts.weekday];
  const agoraBRT = `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
  // 23/05: removida restricao seg-sex. SEFAZ aceita 24/7. Restricao
  // diaria 07h-20h mantida pra evitar abuso. Sandra/Alex podem disparar
  // manual em fim de semana se precisar.
  if (hora < HORA_INICIO || hora >= HORA_FIM) {
    return { dentro: false, agoraBRT, diaSemana,
      motivo: `Captura manual disponível apenas das ${String(HORA_INICIO).padStart(2, '0')}:00 às ${String(HORA_FIM).padStart(2, '0')}:00 BRT. Agora são ${parts.hour}:${parts.minute}. O cron noturno (02:00) cuida das empresas ativas fora desse horário.` };
  }
  return { dentro: true, agoraBRT, diaSemana };
}

export function dentroDeJanela() { return statusJanelaOperacional().dentro; }
