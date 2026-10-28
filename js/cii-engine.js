/*
 * CII 계산 엔진 (프로토타입용)
 * 계수 출처 (IMO 원문으로 확인)
 *  - 배출계수 CF: MEPC.364(79) (MEPC 79/15/Add.1, 4쪽) HFO 3.114, LFO 3.151, MDO/MGO 3.206
 *  - 벌크선 기준선: MEPC.353(78) Table 1  a=4745, c=0.622, 279,000 DWT 이상은 용량 279,000
 *  - 벌크선 등급 경계(dd 벡터): MEPC.354(78) Table 1  0.86 / 0.94 / 1.06 / 1.18
 *  - 감축률 Z: MEPC.400(83) Table 1
 * 모델 가정 (기획서 2.4와 동일)
 *  - 하루 연료는 속력의 세제곱에 비례 (근사)
 *  - 남은 기간: 남은 항해거리를 속력 v로 가고, 남은 날은 정박·대기(하루 정박 연료)로 본다
 *  - 권장값은 목표 등급 경계보다 0.5% 아래(MARGIN)
 */
(function (root) {
  const CF = { HFO: 3.114, LFO: 3.151, MDO: 3.206, MGO: 3.206 };
  const REF = { bulk: { a: 4745, c: 0.622, capMax: 279000 } };
  const DD = { bulk: [0.86, 0.94, 1.06, 1.18] };
  const Z = { 2023: 5, 2024: 7, 2025: 9, 2026: 11, 2027: 13.625, 2028: 16.25, 2029: 18.875, 2030: 21.5 };
  const GRADES = ['A', 'B', 'C', 'D', 'E'];
  const MARGIN = 0.005;

  function capacity(dwt, type = 'bulk') { return Math.min(dwt, REF[type].capMax); }
  function referenceCII(dwt, type = 'bulk') { const r = REF[type]; return r.a * Math.pow(capacity(dwt, type), -r.c); }
  function requiredCII(dwt, year, type = 'bulk') {
    if (!(year in Z)) throw new Error('감축률 표에 없는 연도: ' + year);
    return referenceCII(dwt, type) * (1 - Z[year] / 100);
  }
  // [A/B, B/C, C/D, D/E] 경계값
  function boundaries(dwt, year, type = 'bulk') { const req = requiredCII(dwt, year, type); return DD[type].map(d => req * d); }
  function grade(cii, dwt, year, type = 'bulk') {
    const b = boundaries(dwt, year, type);
    let i = 0; while (i < 4 && cii > b[i]) i++;
    return GRADES[i];
  }
  // 목표 등급의 상한(예: C → C/D 경계)
  function gradeUpperBound(target, dwt, year, type = 'bulk') {
    const idx = GRADES.indexOf(target); if (idx < 0 || idx > 3) throw new Error('목표 등급은 A~D');
    return boundaries(dwt, year, type)[idx];
  }
  function attainedCII(co2Tonnes, dwt, distanceNm, type = 'bulk') {
    if (distanceNm <= 0) return NaN;
    return co2Tonnes * 1e6 / (capacity(dwt, type) * distanceNm);
  }
  function dayOfYear(iso) { const d = new Date(iso + 'T00:00:00Z'); return Math.round((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000) + 1; }
  function daysInYear(year) { return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365; }

  /* records: [{date:'2026-01-01', distance:300, speed:12.5, fuel:{HFO:25}}] (표준화된 정오보고, 하루 1행)
     distance > 0 이면 항해일, 0 이면 정박·대기일 */
  function summarize(records) {
    let distance = 0, seaDays = 0, portDays = 0, seaFuel = 0, portFuel = 0, seaSpeedSum = 0, co2 = 0, fuelTotal = 0;
    const fuelByType = {};
    for (const r of records) {
      let f = 0;
      for (const [t, q] of Object.entries(r.fuel || {})) {
        const v = Number(q) || 0; f += v; fuelByType[t] = (fuelByType[t] || 0) + v;
        co2 += v * (CF[t] ?? CF.HFO);
      }
      fuelTotal += f;
      if ((Number(r.distance) || 0) > 0) { seaDays++; distance += Number(r.distance); seaFuel += f; seaSpeedSum += Number(r.speed) || 0; }
      else { portDays++; portFuel += f; }
    }
    const lastDate = records.length ? records[records.length - 1].date : null;
    const elapsed = lastDate ? dayOfYear(lastDate) : 0;   // 1월 1일부터 마지막 보고일까지 일수
    return {
      elapsedDays: elapsed, reportDays: records.length, missingDays: Math.max(elapsed - records.length, 0),
      year: lastDate ? Number(lastDate.slice(0, 4)) : null, seaDays, portDays, distance, fuelTotal, fuelByType, co2,
      cfMix: fuelTotal > 0 ? co2 / fuelTotal : CF.HFO,          // 이 배의 평균 배출계수
      v0: seaDays ? seaSpeedSum / seaDays : 0,                  // 평균 항해 속력
      f0: seaDays ? seaFuel / seaDays : 0,                      // 항해일 하루 평균 연료
      pf: portDays ? portFuel / portDays : 0,                   // 정박일 하루 평균 연료
      lastDate,
    };
  }

  /* 남은 기간을 속력 v로 갈 때 연말 값
     ctx: {dwt, year, planAnnualDistance}  (planAnnualDistance: 연간 계획 항해거리 nm) */
  function projectYearEnd(s, ctx, v, extraLegs = []) {
    const remDays = daysInYear(ctx.year) - s.elapsedDays;
    const remDist = Math.max(ctx.planAnnualDistance - s.distance, 0);
    const legs = [{ distance: remDist - extraLegs.reduce((a, l) => a + l.distance, 0), speed: v }, ...extraLegs];
    let seaDays = 0, seaFuel = 0;
    for (const l of legs) {
      if (l.distance <= 0) continue;
      const d = l.distance / (24 * l.speed);
      seaDays += d; seaFuel += d * s.f0 * Math.pow(l.speed / s.v0, 3);
    }
    const portDays = Math.max(remDays - seaDays, 0);
    const remFuel = seaFuel + portDays * s.pf;
    const co2 = s.co2 + remFuel * s.cfMix;
    const dist = s.distance + remDist;
    const cii = attainedCII(co2, ctx.dwt, dist);
    return { cii, grade: grade(cii, ctx.dwt, ctx.year), remDays, remDist, seaDays, portDays, remFuel, co2, dist };
  }

  function solveSpeed(fn, target, lo, hi) { // fn(v) 단조 증가, fn(v) <= target 인 최대 v
    if (fn(hi) <= target) return hi;
    if (fn(lo) > target) return null;
    for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (fn(m) > target) hi = m; else lo = m; }
    return lo;
  }

  /* ② 오늘의 연료 한도·권장 속력 */
  function dailyLimit(s, ctx, targetGrade = 'C', minSpeed = 6) {
    const base = projectYearEnd(s, ctx, s.v0);
    const limit = gradeUpperBound(targetGrade, ctx.dwt, ctx.year) * (1 - MARGIN);
    const v = solveSpeed(x => projectYearEnd(s, ctx, x).cii, limit, minSpeed, s.v0);
    if (v === null) return { base, limit, feasible: false };
    const p = projectYearEnd(s, ctx, v);
    return {
      base, limit, feasible: true, alreadyOk: v >= s.v0,
      speed: v, reductionPct: (1 - v / s.v0) * 100,
      dailyFuel: s.f0 * Math.pow(v / s.v0, 3),
      extraSeaDays: p.seaDays - base.seaDays, projected: p,
    };
  }

  /* 연도별 전망 (연말 CII를 그대로 둔다고 가정) */
  function outlook(cii, dwt, years = [2026, 2027, 2028, 2029, 2030]) {
    return years.map(y => ({ year: y, z: Z[y], bounds: boundaries(dwt, y), grade: grade(cii, dwt, y) }));
  }

  /* ③ 항차 미리보기
     voy: {distance, speed, euShare(0 | 0.5 | 1), euaPrice(€/t)}  나머지 남은 거리는 평소 속력 v0 */
  function voyagePreview(s, ctx, voy, targetGrade = 'C', speeds) {
    const one = sp => {
      const p = projectYearEnd(s, ctx, s.v0, [{ distance: voy.distance, speed: sp }]);
      const days = voy.distance / (24 * sp);
      const fuel = days * s.f0 * Math.pow(sp / s.v0, 3);
      const co2 = fuel * s.cfMix;
      return { speed: sp, days, fuel, co2, euCost: co2 * voy.euShare * voy.euaPrice, cii: p.cii, grade: p.grade };
    };
    const limit = gradeUpperBound(targetGrade, ctx.dwt, ctx.year) * (1 - MARGIN);
    const rec = solveSpeed(sp => one(sp).cii, limit, 6, voy.speed);
    const list = (speeds || [voy.speed, voy.speed - 1, voy.speed - 1.5]).map(one);
    return { proposed: one(voy.speed), table: list, limit, recommended: rec === null ? null : one(rec) };
  }

  /* 데이터 검증: 의심 값만 표시 */
  function validate(records) {
    const sea = records.filter(r => (Number(r.distance) || 0) > 0);
    const fuels = sea.map(r => Object.values(r.fuel || {}).reduce((a, b) => a + (Number(b) || 0), 0)).sort((a, b) => a - b);
    const median = fuels.length ? fuels[Math.floor(fuels.length / 2)] : 0;
    const issues = [];
    records.forEach((r, i) => {
      const f = Object.values(r.fuel || {}).reduce((a, b) => a + (Number(b) || 0), 0);
      const d = Number(r.distance) || 0, sp = Number(r.speed) || 0;
      if (d > 0 && median > 0 && (f > median * 3 || f < median * 0.3))
        issues.push({ row: i, date: r.date, type: 'fuel', msg: `연료 ${f.toFixed(1)} t → 평소 ${median.toFixed(0)} t의 ${(f / median).toFixed(1)}배, 입력 오기 의심` });
      if (d > 0 && sp > 0 && Math.abs(sp * 24 - d) / d > 0.15)
        issues.push({ row: i, date: r.date, type: 'distance', msg: `속력×24h(${(sp * 24).toFixed(0)} nm)와 거리(${d} nm) 차이 큼` });
      if (d < 0 || f < 0) issues.push({ row: i, date: r.date, type: 'negative', msg: '음수 값' });
      if (i > 0) { const gap = dayOfYear(r.date) - dayOfYear(records[i - 1].date) - 1;
        if (gap > 0) issues.push({ row: i, date: r.date, type: 'missing', msg: `직전 보고와 ${gap}일 비어 있음` }); }
    });
    return { medianSeaFuel: median, issues };
  }

  const api = { CF, REF, DD, Z, MARGIN, GRADES, referenceCII, requiredCII, boundaries, grade, gradeUpperBound,
    attainedCII, summarize, projectYearEnd, dailyLimit, outlook, voyagePreview, validate, daysInYear, dayOfYear };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.CIIEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
