/*
 * 정오보고 표준화 (프로토타입용, 규칙 기반)
 * 실제 서비스에서는 생성형 AI가 항목명을 찾아 연결한다(기획서 2.4). 프로토타입은 같은 결과를
 * 규칙(열 이름 사전)으로 흉내 내며, 화면에 "데모: 규칙 기반 매핑"이라고 표시한다.
 * 브라우저에서는 SheetJS(XLSX 전역 객체)가 필요하다.
 */
(function (root) {
  const RULES = [
    { std: 'date', re: /^(일자|날짜|일시)|date/i },
    { std: 'status', re: /status|상태/i },
    { std: 'distance', re: /dist|거리/i },
    { std: 'speed', re: /speed|spd|속력|속도/i },
  ];
  const FUEL_RE = /(\bME\b|\bAE\b|\bGE\b|boiler|FOC|\bFO\b|HFO|MGO|MDO|LFO|주기관|발전기|보일러|중유|경유|연료)/i;
  function fuelType(h) {
    if (/MGO|MDO|경유|DMA|gas ?oil/i.test(h)) return 'MGO';
    if (/LFO/i.test(h)) return 'LFO';
    return 'HFO';
  }
  function mapHeaders(headers) {
    const map = [];
    headers.forEach((h, i) => {
      const name = String(h ?? '').trim(); if (!name) return;
      const rule = RULES.find(r => r.re.test(name) && !map.some(m => m.std === r.std));
      if (rule) map.push({ col: i, original: name, std: rule.std });
      else if (FUEL_RE.test(name)) map.push({ col: i, original: name, std: 'fuel', fuelType: fuelType(name) });
      else map.push({ col: i, original: name, std: null });
    });
    return map;
  }
  function toISO(v) {
    if (typeof v === 'number') { // 엑셀 날짜 일련번호 (시간대 영향 없이 변환)
      const d = new Date(Math.round(v - 25569) * 86400000); return d.toISOString().slice(0, 10);
    }
    if (v instanceof Date) { const d = new Date(v.getTime() + 12 * 3600000); return d.toISOString().slice(0, 10); }
    const m = String(v ?? '').trim().match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
    return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null;
  }
  function readInfo(rows) {
    const info = {};
    for (const [k, v] of rows) {
      const key = String(k ?? '');
      if (/DWT|재화중량/i.test(key)) info.dwt = Number(v);
      else if (/plan|계획/i.test(key)) info.planAnnualDistance = Number(v);
      else if (/name|선박명|^vessel$/i.test(key)) info.name = String(v);
      else if (/type|선종/i.test(key)) info.type = String(v);
    }
    return info;
  }
  /* aoa: 첫 시트를 2차원 배열로 (첫 행 = 헤더). infoAoa: 선박정보 시트(없으면 null) */
  function standardize(aoa, infoAoa) {
    const map = mapHeaders(aoa[0]);
    const get = std => map.find(m => m.std === std);
    const fuels = map.filter(m => m.std === 'fuel');
    const records = [];
    for (const row of aoa.slice(1)) {
      if (!row || row.every(c => c === null || c === undefined || c === '')) continue;
      const date = toISO(row[get('date')?.col]); if (!date) continue;
      const fuel = {};
      for (const f of fuels) fuel[f.fuelType] = (fuel[f.fuelType] || 0) + (Number(row[f.col]) || 0);
      records.push({ date, distance: Number(row[get('distance')?.col]) || 0, speed: Number(row[get('speed')?.col]) || 0, fuel });
    }
    records.sort((a, b) => a.date.localeCompare(b.date));
    return { mapping: map, records, info: infoAoa ? readInfo(infoAoa.slice(1)) : {} };
  }
  /* 브라우저: File → Promise<{mapping, records, info}> */
  async function parseFile(file) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' }); // cellDates 끔: 날짜를 일련번호로 받아 시간대 밀림 방지
    const toAoa = ws => XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    const first = toAoa(wb.Sheets[wb.SheetNames[0]]);
    const info = wb.SheetNames[1] ? toAoa(wb.Sheets[wb.SheetNames[1]]) : null;
    return standardize(first, info);
  }
  const api = { mapHeaders, standardize, parseFile, toISO };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.NoonParser = api;
})(typeof window !== 'undefined' ? window : globalThis);
