/**
 * CII 사전관리 프로토타입 – 메인 앱
 * CIIEngine, NoonParser는 각 js 파일에서 전역으로 노출됨
 */

/* ===== 전역 상태 ===== */
const shipData = new Map(); // key: 선박명, value: { info, records, mapping, originalRecords }
let charts = {}; // Chart.js 인스턴스

/* ===== 탭 전환 ===== */
function switchTab(id) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === id));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + id));
  if (id === 'tab2') renderTab2();
  if (id === 'tab3') renderTab3();
  if (id === 'tab4') renderTab4();
  if (id === 'tab5') renderTab5();
  if (id === 'tab6') renderTab6();
}

/* ===== 유틸리티 ===== */
function fmt(v, digits = 1) {
  if (v === null || v === undefined || isNaN(v)) return '-';
  return Number(v).toFixed(digits);
}
function fmtCII(v) { return fmt(v, 2); }
function fmtEU(eur) { // 만 € 단위
  if (eur === null || eur === undefined || isNaN(eur)) return '-';
  if (eur === 0) return '0 €';
  return '약 ' + (eur / 10000).toFixed(1) + '만 €';
}
function fmtEUFull(eur) {
  if (!eur || isNaN(eur)) return '-';
  return Math.round(Number(eur)).toLocaleString('ko-KR') + ' €';
}
function gradeBadgeHTML(g) {
  if (!g) return '';
  return `<span class="grade-badge grade-${g}">${g}</span>`;
}
function gradeColor(g) {
  return { A: '#6dffb4', B: '#7dff9e', C: '#cbd5e0', D: '#fbd38d', E: '#feb2b2' }[g] || '#ccc';
}
function allShips() { return [...shipData.values()]; }
function shipNames() { return [...shipData.keys()]; }

/* ===== 파일 처리 ===== */
async function processFile(file) {
  const parsed = await NoonParser.parseFile(file);
  const name = parsed.info?.name || file.name.replace(/\.[^.]+$/, '');
  const existing = shipData.get(name) || {};
  const info = { ...parsed.info, ...(existing.info || {}) };
  if (!info.name) info.name = name;
  shipData.set(info.name, {
    info,
    records: [...parsed.records],
    originalRecords: JSON.parse(JSON.stringify(parsed.records)),
    mapping: parsed.mapping,
    fileName: file.name,
  });
  return info.name;
}

async function loadSamples() {
  const btn = document.getElementById('btn-load-samples');
  btn.disabled = true;
  btn.textContent = '불러오는 중…';
  try {
    // SAMPLE_DATA가 내장된 경우 (file:// 프로토콜 포함 어디서나 동작)
    if (typeof SAMPLE_DATA !== 'undefined' && SAMPLE_DATA.length) {
      for (const entry of SAMPLE_DATA) {
        const name = entry.info?.name || entry.label;
        shipData.set(name, {
          info: { ...entry.info },
          records: JSON.parse(JSON.stringify(entry.records)),
          originalRecords: JSON.parse(JSON.stringify(entry.records)),
          mapping: entry.mapping,
          fileName: entry.label,
        });
      }
    } else {
      // 서버 환경에서 fallback: fetch로 직접 읽기
      const resp = await fetch('samples/manifest.json');
      const manifest = await resp.json();
      for (const entry of manifest) {
        const fileResp = await fetch('samples/' + entry.file);
        const blob = await fileResp.blob();
        const file = new File([blob], entry.file, { type: blob.type });
        const parsed = await NoonParser.parseFile(file);
        const name = (entry.info?.name) || parsed.info?.name || entry.file.replace(/\.[^.]+$/, '');
        const info = { ...parsed.info, ...(entry.info || {}) };
        if (!info.name) info.name = name;
        shipData.set(info.name, {
          info,
          records: [...parsed.records],
          originalRecords: JSON.parse(JSON.stringify(parsed.records)),
          mapping: parsed.mapping,
          fileName: entry.file,
        });
      }
    }
    renderTab1();
    recomputeAll();
  } catch (e) {
    alert('샘플 불러오기 실패: ' + e.message);
  }
  btn.disabled = false;
  btn.textContent = '📂 샘플 4척 불러오기';
}

function recomputeAll() {
  // 열려 있는 탭 갱신
  const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab;
  if (activeTab === 'tab2') renderTab2();
  if (activeTab === 'tab3') renderTab3();
  if (activeTab === 'tab4') renderTab4();
  if (activeTab === 'tab5') renderTab5();
  if (activeTab === 'tab6') renderTab6();
}

/* ===== computeCtx: 선박 데이터 → 기준일 기반 요약+ctx ===== */
function computeCtx(shipKey, cutDate) {
  const ship = shipData.get(shipKey);
  if (!ship) return null;
  const recs = cutDate ? ship.records.filter(r => r.date <= cutDate) : ship.records;
  if (!recs.length) return null;
  const s = CIIEngine.summarize(recs);
  const info = ship.info;
  const ctx = { dwt: info.dwt, year: s.year || 2026, planAnnualDistance: info.planAnnualDistance };
  return { s, ctx, info, recs };
}

/* ================================================================
   탭 1: 정오보고 수신
================================================================ */
function renderTab1() {
  const container = document.getElementById('ship-cards-container');
  container.innerHTML = '';
  if (shipData.size === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">📋</div><p>파일을 업로드하거나 샘플을 불러오세요</p></div>`;
    return;
  }
  for (const [name, ship] of shipData) {
    const records = ship.records;
    const dates = records.map(r => r.date).sort();
    const firstDate = dates[0];
    const lastDate = dates[dates.length - 1];
    const reportDays = records.length;

    // 항목 연결표 – std별로 정리
    const mappingRows = ship.mapping
      .filter(m => m.std !== null)
      .map(m => {
        const stdLabel = m.std === 'fuel'
          ? `연료(${m.fuelType})`
          : { date: '날짜', distance: '거리', speed: '속력', status: '상태' }[m.std] || m.std;
        const cls = m.std === 'fuel' ? 'fuel' : '';
        return `<tr>
          <td>${m.original}</td>
          <td>→</td>
          <td><span class="std-badge ${cls}">${stdLabel}</span></td>
        </tr>`;
      }).join('');

    // 누락 info 입력 UI
    let missingInputs = '';
    if (!ship.info.dwt) {
      missingInputs += `<div class="info-input-row">
        <label>DWT (재화중량톤)</label>
        <input type="number" placeholder="예: 70000" data-ship="${name}" data-field="dwt"
          oninput="updateShipInfo('${name}','dwt',this.value)">
      </div>`;
    }
    if (!ship.info.planAnnualDistance) {
      missingInputs += `<div class="info-input-row">
        <label>연간 계획 항해거리 (nm)</label>
        <input type="number" placeholder="예: 90000" data-ship="${name}" data-field="planAnnualDistance"
          oninput="updateShipInfo('${name}','planAnnualDistance',this.value)">
      </div>`;
    }

    const card = document.createElement('div');
    card.className = 'ship-card';
    card.innerHTML = `
      <div class="ship-card-header">
        <div class="ship-name-badge">${name}</div>
        <div class="ship-meta">
          <span>📄 ${ship.fileName}</span>
          <span>⚓ ${ship.info.type || '벌크선'}</span>
          <span>DWT ${ship.info.dwt ? Number(ship.info.dwt).toLocaleString() : '미입력'}</span>
          <span>계획항해거리 ${ship.info.planAnnualDistance ? Number(ship.info.planAnnualDistance).toLocaleString() + ' nm' : '미입력'}</span>
        </div>
      </div>
      <div class="ship-meta" style="margin-bottom:10px">
        <span>📅 기간: ${firstDate} ~ ${lastDate}</span>
        <span>보고 일수: ${reportDays}일</span>
      </div>
      <div class="card-title" style="font-size:12px;color:var(--text-3);margin-bottom:6px">항목 연결표</div>
      <div class="data-table-wrapper">
        <table class="mapping-table">
          <thead><tr><th>원래 항목명</th><th></th><th>표준 항목</th></tr></thead>
          <tbody>${mappingRows}</tbody>
        </table>
      </div>
      ${missingInputs ? `<hr class="divider"><div class="card-title" style="font-size:12px;color:var(--warn-text)">⚠ 아래 정보를 입력해주세요</div>${missingInputs}` : ''}
      <div class="demo-note">데모: 규칙 기반 항목 연결 · 실서비스는 생성형 AI가 연결하고 담당자가 확인</div>
    `;
    container.appendChild(card);
  }
}

function updateShipInfo(name, field, value) {
  const ship = shipData.get(name);
  if (!ship) return;
  ship.info[field] = Number(value);
  recomputeAll();
}

/* ================================================================
   탭 2: 표준화·검증
================================================================ */
let tab2ShowAll = false;
let tab2Ship = null;

function renderTab2() {
  const container = document.getElementById('tab2-content');
  container.innerHTML = '';
  if (shipData.size === 0) {
    container.innerHTML = emptyStateHTML();
    return;
  }
  const names = shipNames();
  if (!tab2Ship || !shipData.has(tab2Ship)) tab2Ship = names[0];

  // 선박 선택 버튼
  const selHTML = names.map(n =>
    `<button class="ship-selector-btn ${n === tab2Ship ? 'active' : ''}" onclick="tab2Ship='${n}';renderTab2()">${n}</button>`
  ).join('');
  container.innerHTML = `<div class="ship-selector">${selHTML}</div><div id="tab2-ship-content"></div>`;
  renderTab2Ship();
}

function renderTab2Ship() {
  const cont = document.getElementById('tab2-ship-content');
  if (!cont) return;
  const ship = shipData.get(tab2Ship);
  if (!ship) return;

  const validation = CIIEngine.validate(ship.records);
  const issues = validation.issues;
  const suspectRows = new Set(issues.map(i => i.row));

  // 전체/의심만 토글
  const showBtn = `<div class="toggle-row">
    <span style="font-size:12px;color:var(--text-3)">
      의심 항목 ${issues.length}건
      ${issues.length > 0 ? `<span class="text-warn">(${issues.map(i => `${i.date} ${i.msg}`).join(' / ')})</span>` : ''}
    </span>
    <button class="toggle-btn ${tab2ShowAll ? 'active' : ''}" onclick="tab2ShowAll=!tab2ShowAll;renderTab2Ship()">
      ${tab2ShowAll ? '의심 값만' : '전체 보기'}
    </button>
  </div>`;

  // 연말 CII (현재 값 기준)
  const c = computeCtx(tab2Ship, null);
  let beforeAfterHTML = '';
  if (c && c.ctx.dwt && c.ctx.planAnnualDistance) {
    const proj = CIIEngine.projectYearEnd(c.s, c.ctx, c.s.v0);
    beforeAfterHTML = `<div class="cii-compare">
      <span class="label">현재 데이터 기준 연말 예상 CII:</span>
      <span class="val">${fmtCII(proj.cii)}</span>
      ${gradeBadgeHTML(proj.grade)}
    </div>`;
  }

  // 데이터 표
  const fuelTypes = [...new Set(ship.records.flatMap(r => Object.keys(r.fuel || {})))];
  // 최신 보고가 위로 오도록 날짜 내림차순 (원본 순서는 그대로, 화면 표시만 정렬)
  const showRecords = (tab2ShowAll ? ship.records : ship.records.filter((_, i) => suspectRows.has(i)))
    .slice().sort((a, b) => b.date.localeCompare(a.date));

  if (showRecords.length === 0) {
    cont.innerHTML = `${showBtn}
      <div class="card" style="text-align:center;color:var(--text-3);padding:24px">의심 값이 없습니다 ✓</div>
      ${beforeAfterHTML}`;
    return;
  }

  const fuelCols = fuelTypes.map(t => `<th>${t} (t)</th>`).join('');
  const rows = showRecords.map((r, localIdx) => {
    const globalIdx = ship.records.indexOf(r);
    const isSuspect = suspectRows.has(globalIdx);
    const issuesForRow = issues.filter(i => i.row === globalIdx);
    const totalFuel = Object.values(r.fuel || {}).reduce((a, b) => a + (Number(b) || 0), 0);
    const fuelCells = fuelTypes.map(t => {
      const v = r.fuel?.[t] || 0;
      const isWarnFuel = isSuspect && issuesForRow.some(i => i.type === 'fuel');
      if (isWarnFuel) {
        return `<td><input class="editable-cell" type="number" step="0.1"
          value="${v.toFixed(1)}"
          onchange="editFuel('${tab2Ship}',${globalIdx},'${t}',this.value)"
          ></td>`;
      }
      return `<td>${v > 0 ? fmt(v, 1) : '-'}</td>`;
    }).join('');
    const suspectClass = isSuspect ? 'suspect' : '';
    let rowHTML = `<tr class="${suspectClass}">
      <td>${r.date}</td>
      <td>${r.distance > 0 ? fmt(r.distance, 0) : '정박'}</td>
      <td>${r.speed > 0 ? fmt(r.speed, 1) : '-'}</td>
      ${fuelCells}
      <td>${totalFuel > 0 ? fmt(totalFuel, 1) : '-'}</td>
    </tr>`;
    if (isSuspect && issuesForRow.length) {
      rowHTML += `<tr class="suspect"><td colspan="${4 + fuelTypes.length}" class="suspect-msg">
        ⚠ ${issuesForRow.map(i => i.msg).join(' / ')}
      </td></tr>`;
    }
    return rowHTML;
  }).join('');

  cont.innerHTML = `${showBtn}
    <div class="data-table-wrapper">
      <table class="data-table">
        <thead><tr>
          <th>날짜 ↓ 최신순</th><th>거리 (nm)</th><th>속력 (kt)</th>
          ${fuelCols}<th>합계 (t)</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${beforeAfterHTML}`;
}

function editFuel(shipName, rowIdx, fuelType, newVal) {
  const ship = shipData.get(shipName);
  if (!ship) return;
  const orig = ship.originalRecords[rowIdx];
  const origVal = orig?.fuel?.[fuelType] ?? 0;
  ship.records[rowIdx].fuel[fuelType] = Number(newVal) || 0;

  // before/after 비교
  const c = computeCtx(shipName, null);
  if (!c || !c.ctx.dwt || !c.ctx.planAnnualDistance) { recomputeAll(); renderTab2Ship(); return; }

  // 원본 records로 before 계산
  const origRecs = ship.originalRecords;
  const sOrig = CIIEngine.summarize(origRecs);
  const projOrig = CIIEngine.projectYearEnd(sOrig, c.ctx, sOrig.v0);

  const projNew = CIIEngine.projectYearEnd(c.s, c.ctx, c.s.v0);

  // compare 표시 업데이트
  const comp = document.querySelector('.cii-compare');
  if (comp) {
    comp.innerHTML = `
      <span class="label">수정 전:</span>
      <span class="val">${fmtCII(projOrig.cii)}</span>${gradeBadgeHTML(projOrig.grade)}
      <span class="arrow">→</span>
      <span class="label">수정 후:</span>
      <span class="val" style="color:var(--accent)">${fmtCII(projNew.cii)}</span>${gradeBadgeHTML(projNew.grade)}
    `;
  }
  recomputeAll();
}

/* ================================================================
   탭 3: 선상 패드
================================================================ */
let tab3Ship = null;
let tab3Date = null;

function renderTab3() {
  const container = document.getElementById('tab3-content');
  container.innerHTML = '';
  if (shipData.size === 0) { container.innerHTML = emptyStateHTML(); return; }

  const names = shipNames();
  if (!tab3Ship || !shipData.has(tab3Ship)) tab3Ship = names[0];

  const ship = shipData.get(tab3Ship);
  const lastDate = ship.records[ship.records.length - 1]?.date || '';
  if (!tab3Date) tab3Date = lastDate;

  const selOptions = names.map(n => `<option value="${n}" ${n === tab3Ship ? 'selected' : ''}>${n}</option>`).join('');
  container.innerHTML = `
    <div class="pad-select-row">
      <label>선박 선택</label>
      <select id="pad-ship-sel" onchange="tab3Ship=this.value;tab3Date=null;renderTab3()">${selOptions}</select>
      <label>기준일</label>
      <input type="date" id="pad-date" value="${tab3Date}"
        min="${ship.records[0]?.date}" max="${lastDate}"
        onchange="tab3Date=this.value;renderTab3()">
    </div>
    <div id="pad-body"></div>
  `;
  renderPadBody();
}

function renderPadBody() {
  const body = document.getElementById('pad-body');
  if (!body) return;
  const c = computeCtx(tab3Ship, tab3Date);
  if (!c || !c.ctx.dwt || !c.ctx.planAnnualDistance) {
    body.innerHTML = `<div class="card" style="color:var(--warn-text)">⚠ DWT와 연간 계획 항해거리를 먼저 입력하세요 (탭 ①)</div>`;
    return;
  }
  const { s, ctx } = c;

  const proj = CIIEngine.projectYearEnd(s, ctx, s.v0);
  const dl = CIIEngine.dailyLimit(s, ctx, 'C');

  // 큰 카드 4개
  const gradeClass = `grade-${proj.grade}`;
  const noRec = dl.alreadyOk || !dl.feasible;   // 감속 불필요 또는 권장값을 낼 수 없음
  let bc2 = noRec ? '-' : fmt(dl.speed, 1);
  let bc3 = noRec ? '-' : fmt(dl.dailyFuel, 1);
  let bc4 = noRec ? '-' : fmt(dl.extraSeaDays, 1);

  const bigCards = `<div class="big-cards">
    <div class="big-card grade-card">
      <div class="bc-label">연말 예상 등급</div>
      <div class="bc-value ${gradeClass}">${proj.grade}</div>
      <div class="bc-unit">CII ${fmtCII(proj.cii)}</div>
    </div>
    <div class="big-card">
      <div class="bc-label">권장 속력 (노트)</div>
      <div class="bc-value">${bc2}</div>
      <div class="bc-unit">현재 평균 ${fmt(s.v0, 1)} kt</div>
    </div>
    <div class="big-card">
      <div class="bc-label">오늘 연료 한도 (톤)</div>
      <div class="bc-value">${bc3}</div>
      <div class="bc-unit">현재 평균 ${fmt(s.f0, 1)} t/일</div>
    </div>
    <div class="big-card">
      <div class="bc-label">항해 일수 증가</div>
      <div class="bc-value">${bc4}</div>
      <div class="bc-unit">일</div>
    </div>
  </div>`;

  // 확인되지 않은 의심 값이 있으면 경고 (검증 실패 대응)
  const pending = CIIEngine.validate(shipData.get(tab3Ship).records).issues.filter(i => !tab3Date || i.date <= tab3Date);
  const pendingHTML = pending.length
    ? `<div class="pad-message" style="border-left-color:#d97706;background:#fff7ed">⚠ 확인되지 않은 의심 값 ${pending.length}건이 있습니다(② 표준화·검증). 확인 전 결과는 달라질 수 있습니다.</div>`
    : '';

  // 메시지
  let message;
  if (dl.alreadyOk) {
    message = `<div class="pad-message ok">현재 속력을 유지해도 연말 C등급 이상입니다.</div>`;
  } else if (!dl.feasible) {
    message = `<div class="pad-message">
      연말 예상 등급 <strong>${proj.grade}</strong> (CII ${fmtCII(proj.cii)}).
      남은 기간에 6노트 이상의 속력으로는 C등급을 맞추기 어려워 권장 속력을 제시하지 않습니다.
      운항 계획을 운항팀과 다시 검토하세요.
    </div>`;
  } else {
    const cdBound = CIIEngine.boundaries(ctx.dwt, ctx.year)[2];
    const diffPct = ((proj.cii - cdBound) / cdBound * 100).toFixed(1);
    message = `<div class="pad-message">
      연말 예상 등급 <strong>${proj.grade}</strong> (CII ${fmtCII(proj.cii)}).
      C등급을 경계보다 0.5% 여유를 두고 지키려면
      오늘 권장 속력 <strong>${fmt(dl.speed, 1)}노트</strong> 이하 (현재 ${fmt(s.v0, 1)}),
      감속률 <strong>${fmt(dl.reductionPct, 1)}%</strong>,
      연료 한도 <strong>${fmt(dl.dailyFuel, 1)}톤</strong> (현재 ${fmt(s.f0, 1)}).
      남은 항해 일수 약 <strong>${fmt(dl.extraSeaDays, 1)}일</strong> 증가.
    </div>`;
  }

  // "7월 1일에 알았다면" 비교 (같은 ctx 사용 - dwt, planAnnualDistance는 동일)
  const earlyDate = `${ctx.year}-06-30`;
  const cEarly = computeCtx(tab3Ship, earlyDate);
  let earlyHTML = '';
  // 기준일이 7월 1일 이후이고, 6/30까지의 데이터가 있을 때만 비교를 보여준다
  if (cEarly && cEarly.s.elapsedDays > 0 && s.lastDate > earlyDate && CIIEngine.dailyLimit(cEarly.s, ctx, 'C').feasible) {
    const dlEarly = CIIEngine.dailyLimit(cEarly.s, ctx, 'C');
    earlyHTML = `<div class="early-compare">
      <h4>📌 7월 1일에 알았다면 (기준일: ${earlyDate})</h4>
      <table>
        <tr><td>권장 속력</td><td>${dlEarly.alreadyOk ? '현재 유지 가능' : fmt(dlEarly.speed, 1) + ' 노트'}</td></tr>
        <tr><td>감속률</td><td>${dlEarly.alreadyOk ? '-' : fmt(dlEarly.reductionPct, 1) + '%'}</td></tr>
        <tr><td>연료 한도</td><td>${dlEarly.alreadyOk ? '-' : fmt(dlEarly.dailyFuel, 1) + ' t/일'}</td></tr>
        <tr><td>항해 일수 증가</td><td>${dlEarly.alreadyOk ? '-' : fmt(dlEarly.extraSeaDays, 1) + ' 일'}</td></tr>
      </table>
      <div style="font-size:11px;color:var(--text-3);margin-top:6px">※ 조기 인지 시 감속 여유가 더 큽니다</div>
    </div>`;
  }

  body.innerHTML = pendingHTML + bigCards + message + earlyHTML;
}

/* ================================================================
   탭 4: 선단 대시보드
================================================================ */
let tab4Ship = null;

function renderTab4() {
  const container = document.getElementById('tab4-content');
  container.innerHTML = '';
  if (shipData.size === 0) { container.innerHTML = emptyStateHTML(); return; }
  if (!tab4Ship || !shipData.has(tab4Ship)) tab4Ship = shipNames()[0];

  // 선단 표
  const rows = shipNames().map(name => {
    const c = computeCtx(name, null);
    if (!c || !c.ctx.dwt || !c.ctx.planAnnualDistance) {
      return `<tr onclick="selectTab4Ship('${name}')" class="${name===tab4Ship?'selected':''}">
        <td>${name}</td><td colspan="7" style="color:var(--text-3)">정보 미입력</td></tr>`;
    }
    const { s, ctx } = c;
    const currCII = CIIEngine.attainedCII(s.co2, ctx.dwt, s.distance);
    const proj = CIIEngine.projectYearEnd(s, ctx, s.v0);
    const dl = CIIEngine.dailyLimit(s, ctx, 'C');
    const outl = CIIEngine.outlook(proj.cii, ctx.dwt);
    const outlBadges = outl.map(o => gradeBadgeHTML(o.grade)).join('');
    const action = dl.alreadyOk
      ? `<span style="color:var(--grade-B-text)">✓ 유지</span>`
      : `<span style="color:var(--warn-text)">↓ 감속 필요</span>`;
    return `<tr onclick="selectTab4Ship('${name}')" class="${name===tab4Ship?'selected':''}">
      <td>${name}</td>
      <td>${Number(ctx.dwt).toLocaleString()}</td>
      <td>${fmtCII(currCII)}</td>
      <td>${fmtCII(proj.cii)}</td>
      <td>${gradeBadgeHTML(proj.grade)}</td>
      <td>${action}</td>
      <td><div class="outlook-badges">${outlBadges}</div></td>
    </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="fleet-table-wrapper">
      <table class="fleet-table">
        <thead><tr>
          <th>선박명</th><th>DWT</th><th>올해 누적 CII</th>
          <th>연말 예상 CII</th><th>연말 등급</th>
          <th>권장 조치</th><th>2026~2030 전망</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="chart-container"><canvas id="fleet-chart"></canvas></div>
  `;
  renderFleetChart();
}

function selectTab4Ship(name) {
  tab4Ship = name;
  renderTab4();
}

function renderFleetChart() {
  if (charts.fleet) { charts.fleet.destroy(); charts.fleet = null; }
  const c = computeCtx(tab4Ship, null);
  if (!c || !c.ctx.dwt || !c.ctx.planAnnualDistance) return;
  const { s, ctx } = c;
  const proj = CIIEngine.projectYearEnd(s, ctx, s.v0);
  const years = [2026, 2027, 2028, 2029, 2030];
  const cdBounds = years.map(y => CIIEngine.boundaries(ctx.dwt, y)[2]);
  const deBounds = years.map(y => CIIEngine.boundaries(ctx.dwt, y)[3]);
  const projCIIs = years.map(_ => proj.cii);

  const canvas = document.getElementById('fleet-chart');
  if (!canvas) return;
  charts.fleet = new Chart(canvas, {
    type: 'line',
    data: {
      labels: years,
      datasets: [
        {
          label: 'C/D 경계',
          data: cdBounds,
          borderColor: '#fbd38d',
          backgroundColor: 'rgba(251,211,141,0.08)',
          borderDash: [5, 4],
          pointRadius: 3,
          tension: 0.3,
        },
        {
          label: 'D/E 경계',
          data: deBounds,
          borderColor: '#feb2b2',
          backgroundColor: 'rgba(254,178,178,0.08)',
          borderDash: [3, 3],
          pointRadius: 3,
          tension: 0.3,
        },
        {
          label: tab4Ship + ' 연말 예상 CII',
          data: projCIIs,
          borderColor: '#6384ff',
          backgroundColor: 'rgba(99,132,255,0.12)',
          borderWidth: 2.5,
          pointRadius: 5,
          pointBackgroundColor: '#6384ff',
          fill: false,
          tension: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#4a5270', font: { family: 'Noto Sans KR', size: 12 } } },
        tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(2)}` } },
      },
      scales: {
        x: { ticks: { color: '#4a5270' }, grid: { color: 'rgba(99,132,255,0.1)' } },
        y: {
          ticks: { color: '#4a5270' },
          grid: { color: 'rgba(99,132,255,0.1)' },
          title: { display: true, text: 'CII', color: '#8892b0' },
        },
      },
    },
  });
}

/* ================================================================
   탭 5: 항차 미리보기
================================================================ */
let tab5Ship = null;

function renderTab5() {
  const container = document.getElementById('tab5-content');
  container.innerHTML = '';
  if (shipData.size === 0) { container.innerHTML = emptyStateHTML(); return; }

  const names = shipNames();
  if (!tab5Ship || !shipData.has(tab5Ship)) tab5Ship = names[0];

  const selOptions = names.map(n => `<option value="${n}" ${n === tab5Ship ? 'selected' : ''}>${n}</option>`).join('');
  container.innerHTML = `
    <div class="voyage-inputs">
      <div class="voyage-input-group">
        <label>선박</label>
        <select id="voy-ship" onchange="tab5Ship=this.value;calcVoyage()">${selOptions}</select>
      </div>
      <div class="voyage-input-group">
        <label>항차 거리 (nm)</label>
        <input type="number" id="voy-dist" value="9000" step="100" min="100" oninput="calcVoyage()">
      </div>
      <div class="voyage-input-group">
        <label>화주 조건 속력 (노트)</label>
        <input type="number" id="voy-speed" value="12.5" step="0.5" min="5" max="20" oninput="calcVoyage()">
      </div>
      <div class="voyage-input-group">
        <label>EU 구분</label>
        <select id="voy-eu" onchange="calcVoyage()">
          <option value="0.5">EU 밖↔EU (50%)</option>
          <option value="1">EU 역내 (100%)</option>
          <option value="0">해당 없음 (0%)</option>
        </select>
      </div>
      <div class="voyage-input-group">
        <label>배출권 가격 (€/t CO₂)</label>
        <input type="number" id="voy-eua" value="88" step="1" min="0" oninput="calcVoyage()">
      </div>
    </div>
    <div id="voy-result"></div>
  `;
  calcVoyage();
}

function calcVoyage() {
  const result = document.getElementById('voy-result');
  if (!result) return;
  const name = document.getElementById('voy-ship')?.value || tab5Ship;
  tab5Ship = name;
  const c = computeCtx(name, null);
  if (!c || !c.ctx.dwt || !c.ctx.planAnnualDistance) {
    result.innerHTML = `<div class="card" style="color:var(--warn-text)">⚠ DWT와 연간 계획 항해거리를 먼저 입력하세요</div>`;
    return;
  }
  const { s, ctx } = c;
  const dist = Number(document.getElementById('voy-dist')?.value) || 9000;
  const speed = Number(document.getElementById('voy-speed')?.value) || 12.5;
  const euShare = Number(document.getElementById('voy-eu')?.value) ?? 0.5;
  const euaPrice = Number(document.getElementById('voy-eua')?.value) || 88;

  const voy = { distance: dist, speed, euShare, euaPrice };
  const speeds = [speed, speed - 1, speed - 1.5, speed - 2];
  const prev = CIIEngine.voyagePreview(s, ctx, voy, 'C', speeds);

  const rows = prev.table.map((row, i) => {
    const isProposed = i === 0;
    const cls = isProposed ? 'proposed-row' : '';
    const label = i === 0 ? `화주 조건 (${fmt(speed, 1)} kt)` : `${fmt(row.speed, 1)} kt (-${fmt(speed - row.speed, 1)} kt)`;
    return `<tr class="${cls}">
      <td>${label}</td>
      <td>${fmt(row.days, 1)}</td>
      <td>${fmt(row.fuel, 0)}</td>
      <td>${fmtEUFull(row.euCost)}<br><small style="color:var(--text-3)">${fmtEU(row.euCost)}</small></td>
      <td>${fmtCII(row.cii)}</td>
      <td>${gradeBadgeHTML(row.grade)}</td>
    </tr>`;
  }).join('');

  let recRow = '';
  let conclusionText = '';
  if (prev.recommended) {
    const rec = prev.recommended;
    const prop = prev.proposed;
    const saving = prop.euCost - rec.euCost;
    recRow = `<tr class="rec-row">
      <td>🎯 권장 속력 (${fmt(rec.speed, 1)} kt)</td>
      <td>${fmt(rec.days, 1)}</td>
      <td>${fmt(rec.fuel, 0)}</td>
      <td>${fmtEUFull(rec.euCost)}<br><small style="color:var(--text-3)">${fmtEU(rec.euCost)}</small></td>
      <td>${fmtCII(rec.cii)}</td>
      <td>${gradeBadgeHTML(rec.grade)}</td>
    </tr>`;
    if (rec.grade !== prop.grade) {
      conclusionText = `이 항차를 ${fmt(prop.speed, 1)}노트(${fmt(prop.days, 1)}일)로 받으면 연말 ${prop.grade}등급, EU 탄소비용 ${fmtEU(prop.euCost)}. ` +
        `경계보다 0.5% 여유를 둔 ${fmt(rec.speed, 1)}노트(약 ${fmt(rec.days, 1)}일)로 도착일을 조정하면 ${rec.grade}등급 유지, EU 탄소비용 약 ${(saving / 10000).toFixed(1)}만 € 감소.`;
    } else {
      conclusionText = `이 항차를 ${fmt(prop.speed, 1)}노트(${fmt(prop.days, 1)}일)로 받으면 연말 ${prop.grade}등급, EU 탄소비용 ${fmtEU(prop.euCost)}. ` +
        `권장 속력(${fmt(rec.speed, 1)}노트)으로도 동일 ${rec.grade}등급을 유지할 수 있습니다.`;
    }
  } else {
    conclusionText = `현재 속도 범위에서는 C등급 달성이 어렵습니다. 선단 관리를 재검토하세요.`;
  }

  result.innerHTML = `
    <div class="voyage-table-wrapper">
      <table class="voyage-table">
        <thead><tr>
          <th>속력</th><th>소요일 (일)</th><th>항차 연료 (t)</th>
          <th>EU 탄소비용</th><th>연말 CII</th><th>연말 등급</th>
        </tr></thead>
        <tbody>${rows}${recRow}</tbody>
      </table>
    </div>
    <div class="voyage-conclusion">
      ${conclusionText}
      <div class="voyage-note">* CO₂만 계산 · 늦어지는 날의 용선료 제외 · 배출권 가격은 입력값</div>
    </div>
  `;
}

/* ================================================================
   탭 6: 보고서
================================================================ */
function renderTab6() {
  const container = document.getElementById('tab6-content');
  container.innerHTML = '';
  if (shipData.size === 0) { container.innerHTML = emptyStateHTML(); return; }

  const reportData = shipNames().map(name => {
    const ship = shipData.get(name);
    const recs = ship.records;
    const dates = recs.map(r => r.date).sort();
    const s = CIIEngine.summarize(recs);
    const fuelByType = s.fuelByType || {};
    const hfo = fuelByType.HFO || 0;
    const mgo = fuelByType.MGO || 0;
    const lfo = fuelByType.LFO || 0;
    const seaHours = s.seaDays * 24;
    return {
      name, from: dates[0], to: dates[dates.length - 1],
      hfo, mgo, lfo, total: s.fuelTotal,
      distance: s.distance, seaHours: seaHours.toFixed(0), co2: s.co2.toFixed(1)
    };
  });

  const rows = reportData.map(d => `<tr>
    <td>${d.name}</td>
    <td>${d.from} ~ ${d.to}</td>
    <td>${d.hfo > 0 ? fmt(d.hfo, 1) : '-'}</td>
    <td>${d.mgo > 0 ? fmt(d.mgo, 1) : '-'}</td>
    <td>${d.lfo > 0 ? fmt(d.lfo, 1) : '-'}</td>
    <td>${fmt(d.total, 1)}</td>
    <td>${Number(d.distance).toLocaleString()}</td>
    <td>${Number(d.seaHours).toLocaleString()}</td>
    <td>${Number(d.co2).toLocaleString()}</td>
  </tr>`).join('');

  container.innerHTML = `
    <div class="section-title">IMO DCS 보고 자료 초안 (데모)</div>
    <div class="section-desc">선박별 연료 소비량, 항해거리, CO₂ 배출량 요약. 실제 제출용 서식과 다를 수 있습니다.</div>
    <div style="margin-bottom:12px">
      <button class="btn btn-primary btn-sm" onclick="downloadCSV()">⬇ CSV 내려받기</button>
    </div>
    <div class="report-table-wrapper">
      <table class="report-table" id="report-table">
        <thead><tr>
          <th>선박명</th><th>기간</th>
          <th>HFO (t)</th><th>MGO (t)</th><th>LFO (t)</th><th>합계 (t)</th>
          <th>항해거리 (nm)</th><th>항해시간 (h)</th><th>CO₂ (t)</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div style="font-size:11px;color:var(--text-3);margin-top:12px">
      * CO₂ 계산: HFO×3.114, MGO×3.206, LFO×3.151 (MEPC.364(79))
    </div>
  `;
}

function downloadCSV() {
  const table = document.getElementById('report-table');
  if (!table) return;
  let csv = '';
  for (const row of table.rows) {
    const cells = [...row.cells].map(c => `"${c.innerText.replace(/"/g, '""')}"`);
    csv += cells.join(',') + '\r\n';
  }
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'IMO_DCS_draft.csv';
  a.click();
}

/* ===== 공통 유틸 ===== */
function emptyStateHTML() {
  return `<div class="empty-state"><div class="empty-icon">⚓</div><p>먼저 탭 ①에서 파일을 업로드하거나 샘플을 불러오세요</p></div>`;
}

/* ================================================================
   초기화
================================================================ */
document.addEventListener('DOMContentLoaded', () => {
  // 서비스명 설정
  document.getElementById('site-title').textContent = SERVICE_NAME;
  document.title = SERVICE_NAME + ' · CII 사전관리';

  // 탭 버튼 클릭
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // 드롭존
  const dropZone = document.getElementById('drop-zone');
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', async e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const files = [...e.dataTransfer.files].filter(f => /\.(xlsx|xls|csv)$/i.test(f.name));
    if (!files.length) return;
    for (const f of files) await processFile(f);
    renderTab1();
    recomputeAll();
  });

  // 파일 선택 버튼
  document.getElementById('btn-file').addEventListener('click', () => {
    document.getElementById('file-input').click();
  });
  document.getElementById('file-input').addEventListener('change', async e => {
    const files = [...e.target.files];
    for (const f of files) await processFile(f);
    e.target.value = '';
    renderTab1();
    recomputeAll();
  });

  // 샘플 불러오기
  document.getElementById('btn-load-samples').addEventListener('click', loadSamples);

  // 초기 렌더
  renderTab1();
});
