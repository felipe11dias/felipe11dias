#!/usr/bin/env node
// Gera assets/experience.svg e o bloco de experiência do README a partir de data/experience.json.
//
// Uso: node scripts/generate-experience.mjs [--today=AAAA-MM]
//
// O tempo é contado como no LinkedIn: o mês inicial e o final entram na conta, e um mês
// coberto por dois cargos conta uma vez só no total. A saída não tem carimbo de data, então
// os arquivos só mudam quando o texto muda.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const START_MARK = '<!-- experience:start -->';
const END_MARK = '<!-- experience:end -->';

const parseMonth = value => {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value ?? '');
  if (!match) throw new Error(`Mês inválido: "${value}". Use o formato AAAA-MM.`);
  return Number(match[1]) * 12 + Number(match[2]) - 1;
};

const currentMonth = () => {
  const arg = process.argv.find(a => a.startsWith('--today='));
  if (arg) return parseMonth(arg.slice('--today='.length));
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Fortaleza', year: 'numeric', month: '2-digit' })
    .formatToParts(new Date());
  return parseMonth(`${parts.find(p => p.type === 'year').value}-${parts.find(p => p.type === 'month').value}`);
};

const formatDuration = months => {
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const y = years === 1 ? '1 ano' : `${years} anos`;
  const m = rest === 1 ? '1 mês' : `${rest} meses`;
  if (years === 0) return m;
  return rest === 0 ? y : `${y} e ${m}`;
};

const formatMonth = index => `${MONTHS[index % 12]}/${Math.floor(index / 12)}`;

function loadRoles(today) {
  const { company, roles } = JSON.parse(readFileSync(join(ROOT, 'data/experience.json'), 'utf8'));
  if (!roles?.length) throw new Error('data/experience.json não tem cargos.');
  const parsed = roles
    .map(role => {
      const start = parseMonth(role.start);
      const end = role.end === null ? today : parseMonth(role.end);
      if (end < start) throw new Error(`"${role.title}" termina antes de começar.`);
      return { ...role, startIndex: start, endIndex: end, current: role.end === null, months: end - start + 1 };
    })
    .sort((a, b) => a.startIndex - b.startIndex);
  const covered = new Set();
  for (const role of parsed) for (let m = role.startIndex; m <= role.endIndex; m++) covered.add(m);
  return { company, roles: parsed, totalMonths: covered.size };
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pct = n => `${Number(n.toFixed(2))}%`;

function buildSvg({ company, roles, totalMonths }) {
  const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,'DejaVu Sans Mono','Liberation Mono',monospace";
  const [BG, PANEL, LINE, TXT, SOFT, DIM, ACCENT] = ['#0b1020', '#121a30', '#2a3654', '#e8eefb', '#c2cde2', '#8a97b4', '#5eead4'];
  const n = roles.length;
  const levels = Math.max(n, 3);
  const W = 1000, H = 440 + (levels - 3) * 95, RISE = 95, LEFT = 30, RIGHT = 950;
  const base = H - 40;
  const step = (RIGHT - LEFT) / n;

  // A escada: cada cargo é um patamar, e a ponta final é o cargo atual.
  const landings = roles.map((_, i) => ({ x: LEFT + i * step, y: base - i * RISE }));
  let d = `M${LEFT} ${base}`;
  landings.forEach((l, i) => {
    d += `H${(l.x + step).toFixed(1)}`;
    if (i < n - 1) d += `V${landings[i + 1].y}`;
  });

  // Distância até o fim de cada patamar e até o início do seguinte, em % do caminho.
  const length = step * n + RISE * (n - 1);
  const stops = landings.map((_, i) => ((i + 1) * step + i * RISE) / length * 100);
  const arrivals = landings.map((_, i) => (i * step + i * RISE) / length * 100);

  // Linha do tempo: 0-75% sobe, pausando em cada patamar; 75-95% fica no topo; 95-100% some.
  const CLIMB_END = 75, HOLD_END = 95, LOOP = 14;
  const slice = CLIMB_END / n;
  const moveEnd = i => (i + 0.72) * slice;
  const pauseEnd = i => (i + 1) * slice;
  const arrivalTime = i => (i === 0 ? 0 : pauseEnd(i - 1) + (moveEnd(i) - pauseEnd(i - 1)) * (arrivals[i] - stops[i - 1]) / (stops[i] - stops[i - 1]));

  const frames = render => {
    const out = [`0%{${render(0)}}`];
    stops.forEach((stop, i) => {
      out.push(`${pct(moveEnd(i))}{${render(stop)}}`);
      if (i < n - 1) out.push(`${pct(pauseEnd(i))}{${render(stop)}}`);
    });
    out.push(`100%{${render(100)}}`);
    return out.join('');
  };

  // Contador que sobe junto com a escada e termina no valor real.
  const reelSteps = Math.min(Math.max(Math.floor(totalMonths / 12), 1), 30);
  const LH = 64;
  const reelLines = [...Array(reelSteps + 1)].map((_, i) => formatDuration(Math.round(totalMonths * i / reelSteps)));
  const reelY = -reelSteps * LH;

  const roleKeyframes = roles.map((_, i) => {
    if (i === 0) return '';
    const on = arrivalTime(i);
    return `@keyframes c${i}{0%,${pct(Math.max(on - 0.01, 0))}{opacity:.28}${pct(on + 2)},${HOLD_END}%{opacity:1}100%{opacity:.28}}`;
  }).join('');

  const css = `
.fade{animation:fade ${LOOP}s linear infinite}
@keyframes fade{0%,${HOLD_END}%{opacity:1}100%{opacity:0}}
.prog{stroke-dasharray:100;stroke-dashoffset:0;animation:prog ${LOOP}s linear infinite}
@keyframes prog{${frames(p => `stroke-dashoffset:${Number((100 - p).toFixed(2))}`)}}
.climber{offset-path:path('${d}');offset-rotate:0deg;offset-distance:100%;animation:climb ${LOOP}s linear infinite}
@keyframes climb{${frames(p => `offset-distance:${Number(p.toFixed(2))}%`)}}
.reel{transform:translateY(${reelY}px);animation:reel ${LOOP}s infinite}
@keyframes reel{0%{transform:translateY(0);animation-timing-function:steps(${reelSteps},end)}${CLIMB_END}%,100%{transform:translateY(${reelY}px)}}
.pulse{animation:pulse 2.4s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:.25}50%{opacity:1}}
${roleKeyframes}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}`;

  const cardW = step - 36;
  const cards = roles.map((role, i) => {
    const { x, y } = landings[i];
    const cx = x + 18, top = y - 106, h = 94;
    const dates = `${formatMonth(role.startIndex)} – ${role.current ? 'atual' : formatMonth(role.endIndex)} · ${role.mode}`;
    const titleSize = Math.min(16, Math.floor((cardW - 26) / (role.title.length * 0.62)));
    const dateSize = Math.min(13, Math.floor((cardW - 26) / (dates.length * 0.62)));
    const color = role.current ? ACCENT : SOFT;
    const anim = i === 0 ? '' : ` style="animation:c${i} ${LOOP}s linear infinite"`;
    return `<g${anim}>
<rect x="${cx}" y="${top}" width="${cardW}" height="${h}" rx="10" fill="${PANEL}" stroke="${role.current ? ACCENT : LINE}" stroke-width="1.5"/>
<text x="${cx + 13}" y="${top + 28}" font-size="${titleSize}" font-weight="700" fill="${TXT}">${esc(role.title)}</text>
<text x="${cx + 13}" y="${top + 52}" font-size="${dateSize}" fill="${DIM}">${esc(dates)}</text>
<text x="${cx + 13}" y="${top + 77}" font-size="15" font-weight="700" fill="${color}">${esc(formatDuration(role.months))}</text>
</g>`;
  }).join('\n');

  const end = { x: RIGHT, y: landings[n - 1].y };
  const total = formatDuration(totalMonths);
  const trail = roles.map(r => r.title).join(', ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t d" font-family="${MONO}">
<title id="t">${esc(`${total} de experiência na ${company}`)}</title>
<desc id="d">${esc(`Escada animada com os cargos: ${trail}.`)}</desc>
<style>${css}</style>
<defs>
<pattern id="dots" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1" fill="#1d2743"/></pattern>
<radialGradient id="glow" cx="12%" cy="0%" r="75%"><stop offset="0" stop-color="${ACCENT}" stop-opacity=".16"/><stop offset="1" stop-color="${ACCENT}" stop-opacity="0"/></radialGradient>
<clipPath id="window"><rect x="30" y="66" width="640" height="${LH}"/></clipPath>
</defs>
<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="16" fill="${BG}"/>
<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="16" fill="url(#dots)"/>
<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="16" fill="url(#glow)"/>
<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="16" fill="none" stroke="${LINE}" stroke-width="1.5"/>
<text x="36" y="48" font-size="14" font-weight="700" fill="${ACCENT}" letter-spacing="1">${esc(`ESCALADA PROFISSIONAL · ${company}`)}</text>
<g clip-path="url(#window)"><g class="reel">
${reelLines.map((line, i) => `<text x="36" y="${116 + i * LH}" font-size="46" font-weight="700" fill="${TXT}">${esc(line)}</text>`).join('\n')}
</g></g>
<text x="36" y="158" font-size="18" fill="${SOFT}">de experiência, do estágio ao cargo atual</text>
<path d="${d}" fill="none" stroke="#46557a" stroke-width="2.5" stroke-dasharray="4 7"/>
${cards}
<path class="prog fade" d="${d}" pathLength="100" fill="none" stroke="${ACCENT}" stroke-width="3.5" stroke-linejoin="round"/>
<circle class="pulse" cx="${end.x}" cy="${end.y}" r="15" fill="none" stroke="${ACCENT}" stroke-width="2"/>
<circle class="climber" r="8" fill="${ACCENT}"/>
</svg>
`;
}

function updateReadme({ company, roles, totalMonths }) {
  const path = join(ROOT, 'README.md');
  const readme = readFileSync(path, 'utf8');
  const from = readme.indexOf(START_MARK);
  const to = readme.indexOf(END_MARK);
  if (from === -1 || to === -1 || to < from) throw new Error(`README.md precisa dos marcadores ${START_MARK} e ${END_MARK}.`);
  const total = formatDuration(totalMonths);
  const trail = roles.map(r => r.title).join(', depois ');
  const block = `${START_MARK}
<p align="center">
  <img src="assets/experience.svg" width="100%" alt="Escada animada da carreira na ${esc(company)}: ${esc(trail)}, com ${esc(total)} de experiência.">
</p>

<p align="center"><strong>${esc(total)} de experiência</strong>, do estágio ao cargo atual.</p>
`;
  writeFileSync(path, readme.slice(0, from) + block + readme.slice(to));
}

const data = loadRoles(currentMonth());
writeFileSync(join(ROOT, 'assets/experience.svg'), buildSvg(data));
updateReadme(data);
console.log(`Total: ${formatDuration(data.totalMonths)}`);
for (const role of data.roles) console.log(`- ${role.title}: ${formatDuration(role.months)}`);
