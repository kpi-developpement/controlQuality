const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeReport } = require('../utils/powerbi');
const { dateRange } = require('../utils/dateRange');
test('Power BI: secure embed with specific page', () => {
  const r = normalizeReport({title:' Qualité ',url:'https://app.powerbi.com/reportEmbed?reportId=123&ctid=abc',pageName:'ReportSection2'});
  assert.equal(r.title,'Qualité'); assert.equal(new URL(r.url).searchParams.get('pageName'),'ReportSection2'); assert.equal(new URL(r.url).searchParams.get('ctid'),'abc');
});
test('Power BI: preserve pageName and accept existing public embed', () => {
  assert.equal(normalizeReport({title:'QA',url:'https://app.powerbi.com/reportEmbed?reportId=1&pageName=PageX'}).pageName,'PageX');
  assert.match(normalizeReport({title:'QA',url:'https://app.powerbi.com/view?r=token'}).url,/view\?r=token/);
});
test('Power BI: reject untrusted hosts, scripts, credentials and non-embed paths', () => {
  for (const url of ['javascript:alert(1)','http://app.powerbi.com/view?r=x','https://app.powerbi.com.evil.test/view?r=x','https://app.powerbi.com@evil.test/view?r=x','https://a:b@app.powerbi.com/view?r=x','https://app.powerbi.com/groups/me/reports/123','https://app.powerbi.com/reportEmbed','https://app.powerbi.com:444/view?r=x']) assert.throws(() => normalizeReport({title:'QA',url}));
});
test('Power BI: reject empty/oversized titles', () => {
  for (const title of ['', ' '.repeat(5),'x'.repeat(121)]) assert.throws(() => normalizeReport({title,url:'https://app.powerbi.com/view?r=x'}));
});
test('Date range: include the whole last calendar day', () => {
  const range = dateRange('2026-09-01','2026-09-30');
  assert.equal(range.$gte.toISOString(),'2026-09-01T00:00:00.000Z');
  assert.equal(range.$lte.toISOString(),'2026-09-30T23:59:59.999Z');
});
test('Date range: preserve timezone-aware instants and reject invalid/reversed input', () => {
  assert.equal(dateRange('2026-09-28T00:00:00+02:00',null).$gte.toISOString(),'2026-09-27T22:00:00.000Z');
  assert.equal(dateRange(null,null),null);
  assert.throws(() => dateRange('invalid',null)); assert.throws(() => dateRange('2026-10-01','2026-09-01'));
});
